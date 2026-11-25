import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDatabase } from "../server/db.js";
import { runSmoke, type SmokeProvider } from "../scripts/smoke-live-image.js";

async function setup(t: { after: (fn: () => Promise<void>) => void }, quote = "0.40") {
  const db = await createDatabase(await mkdtemp(path.join(os.tmpdir(), "inkshot-smoke-test-")), true);
  t.after(async () => { await db.close(); });
  const calls = { estimate: 0, submit: 0, status: 0 };
  const provider: SmokeProvider = {
    estimate: async () => { calls.estimate++; return { usd: quote, credits: "0" }; },
    submit: async () => { calls.submit++; return { status: "queued", request_id: "req_smoke" }; },
    status: async () => { calls.status++; return calls.status < 2 ? { status: "in_progress", request_id: "req_smoke" } : { status: "completed", request_id: "req_smoke", images: [{ url: "https://cdn.example.test/a.png?sig=secret" }] }; },
  };
  return { db, provider, calls };
}

test("smoke test is a dry run by default and never submits", async t => {
  const { db, provider, calls } = await setup(t);
  const result = await runSmoke({ provider, db, model: "m", prompt: "p", maxUsd: 1, yes: false });
  assert.equal(result.outcome, "dry-run"); assert.equal(calls.submit, 0); assert.match(result.detail, /Re-run with --yes/);
});

test("smoke test refuses a quote above the cap or an unusable quote", async t => {
  const over = await setup(t, "1.50");
  assert.equal((await runSmoke({ ...over, model: "m", prompt: "p", maxUsd: 1, yes: true })).outcome, "refused");
  assert.equal(over.calls.submit, 0);
  const bad = await setup(t, "0");
  assert.equal((await runSmoke({ ...bad, model: "m", prompt: "p", maxUsd: 1, yes: true })).outcome, "refused");
});

test("with --yes it submits exactly one image, polls to completion and prints no signed URL", async t => {
  const { db, provider, calls } = await setup(t);
  const before = process.env.HF_DAILY_BUDGET_USD;
  t.after(async () => { if (before === undefined) delete process.env.HF_DAILY_BUDGET_USD; else process.env.HF_DAILY_BUDGET_USD = before; });
  const result = await runSmoke({ provider, db, model: "m", prompt: "p", maxUsd: 1, yes: true, pollMs: 1 });
  assert.equal(result.outcome, "completed"); assert.equal(calls.submit, 1); assert.equal(result.requestId, "req_smoke");
  assert(!result.detail.includes("sig=secret") && result.detail.includes("cdn.example.test"));
  assert.equal(Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM provider_spend")).rows[0].n), 1, "the spend is recorded against the cap");
});

test("smoke test reports a provider failure and a timeout instead of hanging", async t => {
  const { db, provider } = await setup(t);
  const failing = { ...provider, status: async () => ({ status: "failed", request_id: "req_smoke" }) };
  assert.equal((await runSmoke({ provider: failing, db, model: "m", prompt: "p", maxUsd: 1, yes: true, pollMs: 1 })).outcome, "failed");
  const slow = await setup(t);
  const stuck = { ...slow.provider, status: async () => ({ status: "in_progress", request_id: "req_smoke" }) };
  assert.equal((await runSmoke({ provider: stuck, db: slow.db, model: "m", prompt: "p", maxUsd: 1, yes: true, pollMs: 1, timeoutMs: 20 })).outcome, "timeout");
});
