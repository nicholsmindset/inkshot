import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDatabase } from "../server/db";
import { runWorkerOnce } from "../server/worker";
import { MODELS } from "../server/higgsfield";
import { submitBudgeted } from "../server/provider-budget";

test("provider receipts resume jobs without a second paid submission", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-receipts-"));
  const db = await createDatabase(dir, true);
  const oldCap = process.env.HF_DAILY_BUDGET_USD;
  process.env.HF_DAILY_BUDGET_USD = "3";
  let submissions = 0;
  const provider = {
    estimate: async () => ({ usd: "1", credits: "1" }),
    submit: async (_model: string, _input: unknown, key: string) => {
      submissions++;
      if (key === "lost") throw new Error("Lost acknowledgement");
      return { request_id: "receipt-1", status: "queued" };
    },
  };
  try {
    const send = (key: string, input = "draft") => submitBudgeted(db, "model", input, key, provider);
    const parallel = await Promise.allSettled([send("known"), send("known")]);
    assert(parallel.some(result => result.status === "fulfilled"));
    assert.equal(submissions, 1);
    assert.equal((await send("known")).request_id, "receipt-1");
    await assert.rejects(send("known", "changed"), /input changed/);
    assert.equal(submissions, 1);
    await assert.rejects(send("lost"), /Lost acknowledgement/);
    await assert.rejects(send("lost"), /awaiting confirmation/);
    assert.equal(submissions, 2);
    const reservations = (await db.query<{ request_key: string; provider_request_id: string | null }>(
      "SELECT request_key,provider_request_id FROM provider_spend ORDER BY request_key",
    )).rows;
    assert.deepEqual(reservations, [
      { request_key: "known", provider_request_id: "receipt-1" },
      { request_key: "lost", provider_request_id: null },
    ]);
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
  } finally {
    if (oldCap === undefined) delete process.env.HF_DAILY_BUDGET_USD;
    else process.env.HF_DAILY_BUDGET_USD = oldCap;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
