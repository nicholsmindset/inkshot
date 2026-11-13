import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDatabase } from "../server/db";
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
