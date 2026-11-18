import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDatabase } from "../server/db";
import { runWorkerOnce } from "../server/worker";
import { MODELS } from "../server/higgsfield";
import { submitBudgeted } from "../server/provider-budget";
import { config } from "../server/config";

test("lost acceptance receipts replay the same provider intent without duplicate spending", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-receipts-"));
  const db = await createDatabase(dir, true);
  const oldCap = process.env.HF_DAILY_BUDGET_USD;
  process.env.HF_DAILY_BUDGET_USD = "3";
  const accepted = new Map<string, string>();
  const attempts = new Map<string, number>();
  const provider = {
    estimate: async () => ({ usd: "1", credits: "1" }),
    submit: async (_model: string, _input: unknown, key: string) => {
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (!accepted.has(key)) {
        accepted.set(key, `receipt-${key}`);
        if (key === "lost" || key === "older") throw new Error("Lost acknowledgement");
      }
      return { request_id: accepted.get(key)!, status: "queued" };
    },
  };
  try {
    const send = (key: string, input = "draft") => submitBudgeted(db, "model", input, key, provider);
    const parallel = await Promise.all([send("known"), send("known")]);
    assert(parallel.every(result => result.request_id === "receipt-known"));
    assert.equal(accepted.size, 1);
    await assert.rejects(send("known", "changed"), /input changed/);
    await assert.rejects(send("lost"), /Lost acknowledgement/);
    await assert.rejects(send("lost", "changed"), /input changed/);
    assert.equal(attempts.get("lost"), 1);
    assert.equal((await send("lost")).request_id, "receipt-lost");
    assert.equal(attempts.get("lost"), 2);
    assert.equal((await send("lost")).request_id, "receipt-lost");
    assert.equal(attempts.get("lost"), 2, "known receipts resume without another HTTP submission");
    assert.equal(accepted.size, 2, "provider accepted only the two distinct intents");
    const reservations = (await db.query<{ request_key: string; provider_request_id: string | null; usd: string }>(
      "SELECT request_key,provider_request_id,usd::text FROM provider_spend ORDER BY request_key",
    )).rows;
    assert.deepEqual(reservations.map(row => ({ ...row, usd: Number(row.usd) })), [
      { request_key: "known", provider_request_id: "receipt-known", usd: 1 },
      { request_key: "lost", provider_request_id: "receipt-lost", usd: 1 },
    ]);
    await assert.rejects(send("older"), /Lost acknowledgement/);
    await db.query("UPDATE provider_spend SET created_at=now()-interval '2 days' WHERE request_key='older'");
    await assert.rejects(send("older"), /needs reconciliation/);
    assert.equal(attempts.get("older"), 1, "old ambiguous requests cannot bypass today's spending ceiling");
  } finally {
    if (oldCap === undefined) delete process.env.HF_DAILY_BUDGET_USD;
    else process.env.HF_DAILY_BUDGET_USD = oldCap;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an ambiguous live image submission exhausts retry budget and refunds the asset once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-worker-recovery-"));
  const db = await createDatabase(dir, true);
  const oldCap = process.env.HF_DAILY_BUDGET_USD;
  process.env.HF_DAILY_BUDGET_USD = "2";
  const originalFetch = globalThis.fetch;
  const originalConfig = { liveAllowed: config.liveAllowed, hfKey: config.hfKey, hfSecret: config.hfSecret };
  config.liveAllowed = true;
  config.hfKey = "test-key";
  config.hfSecret = "test-secret";
  let replayCalls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `https://api.higgsfield.ai/${MODELS.image}`);
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "v:image");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      prompt: "approved photo", resolution: "1080p", aspect_ratio: "3:4",
    });
    replayCalls++;
    throw new Error("Lost acknowledgement again");
  };
  try {
    await db.query("INSERT INTO workspaces(id,credits) VALUES('ws',90)");
    await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,status,concepts,brand,mock) VALUES('kit','ws','Campaign','Sales','generating','[]','{}',false)");
    await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,current_version_id) VALUES('asset','ws','kit','image','Image','4:5','v')");
    await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,credit_cost,mock) VALUES('v','asset','ws',1,'approved photo','Friday bakes','Order now',10,false)");
    await db.query("INSERT INTO jobs(id,version_id,workspace_id,attempts) VALUES('job','v','ws',4)");
    const input = { prompt: "approved photo", resolution: "1080p", aspect_ratio: "3:4" };
    let sent = 0;
    await assert.rejects(submitBudgeted(db, MODELS.image, input, "v:image", {
      estimate: async () => ({ usd: "1", credits: "1" }),
      submit: async () => { sent++; throw new Error("Lost acknowledgement"); },
    }), /Lost acknowledgement/);
    assert(await runWorkerOnce(db));
    assert.equal((await db.query("SELECT state FROM jobs")).rows[0].state, "queued");
    await db.query("UPDATE jobs SET available_at=now()");
    assert(await runWorkerOnce(db));
    assert.equal((await db.query("SELECT state FROM jobs")).rows[0].state, "failed");
    assert.equal((await db.query("SELECT status FROM campaigns")).rows[0].status, "partial");
    assert.equal((await db.query("SELECT status FROM versions")).rows[0].status, "failed");
    assert.equal((await db.query("SELECT credits FROM workspaces")).rows[0].credits, 100);
    assert.equal((await db.query("SELECT amount FROM ledger WHERE kind='refund'")).rows.length, 1);
    assert.equal(await runWorkerOnce(db), false);
    assert.equal(sent, 1);
    assert.equal(replayCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    if (oldCap === undefined) delete process.env.HF_DAILY_BUDGET_USD;
    else process.env.HF_DAILY_BUDGET_USD = oldCap;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
