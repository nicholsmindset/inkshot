import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config, writingLimits } from "../server/config.js";
import { createDatabase } from "../server/db.js";
import { writeBrief, writeConcepts } from "../server/claude.js";
import { emptyBrand } from "../server/brand.js";

test("paid writing reserves global and workspace slots atomically, including a failed request", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-writing-"));
  const db = await createDatabase(dir, true);
  const oldLimits = [process.env.WRITING_DAILY_REQUEST_LIMIT, process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT];
  const oldMode = config.mode, oldKey = config.openrouterKey;
  t.after(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
    for (const [i, name] of ["WRITING_DAILY_REQUEST_LIMIT", "WRITING_WORKSPACE_DAILY_REQUEST_LIMIT"].entries()) {
      if (oldLimits[i] === undefined) delete process.env[name];
      else process.env[name] = oldLimits[i];
    }
    config.mode = oldMode;
    config.openrouterKey = oldKey;
  });
  config.mode = "live";
  config.openrouterKey = "test-fixture";
  const transport = t.mock.method(globalThis, "fetch", async () => new Response(null, {status: 502}));
  process.env.WRITING_DAILY_REQUEST_LIMIT = "2";
  process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT = "";
  assert.throws(writingLimits, /not configured/);
  process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT = "1";
  await assert.rejects(writeBrief(db, "a", [{ url: "", title: "", text: "x".repeat(131073) }]), /too long/);
  assert.equal(transport.mock.callCount(), 0);
  const req = () => writeConcepts(db, "a", emptyBrand, "Sales", "Offer");
  const both = await Promise.allSettled([req(), req()]);
  assert.equal(both.filter(r => r.status === "rejected" && /daily writing limit/.test(r.reason.message)).length, 1);
  assert.equal(transport.mock.callCount(), 1);
  await assert.rejects(writeBrief(db, "b", []), /provider status 502/);
  await assert.rejects(writeBrief(db, "c", []), /daily writing limit/);
  assert.equal(transport.mock.callCount(), 2);
  config.mode = "mock";
  assert.equal((await req()).length, 3);
  assert.equal(transport.mock.callCount(), 2);
  const usage = await db.query("SELECT scope,requests FROM writing_daily_usage ORDER BY scope");
  assert.deepEqual(usage.rows, [{ scope: "global", requests: 2 }, { scope: "workspace:a", requests: 1 }, { scope: "workspace:b", requests: 1 }]);
});
