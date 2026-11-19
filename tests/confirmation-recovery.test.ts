import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("confirmation recovery hides account existence and limits resend and code guesses", async t => {
  let providerStatus = 200;
  let providerCalls = 0;
  const provider = createServer((_req, res) => {
    providerCalls++;
    res.setHeader("content-type", "application/json");
    res.statusCode = providerStatus;
    res.end(JSON.stringify(providerStatus === 200 ? {} : { code: "fixture_error", msg: "Private provider detail" }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  const providerAddress = provider.address();
  assert(providerAddress && typeof providerAddress !== "string");
  process.env.AUTH_PROVIDER = "supabase";
  process.env.SUPABASE_URL = `http://127.0.0.1:${providerAddress.port}`;
  process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-publishable-key";
  const { createDatabase } = await import("../server/db.js");
  const { createApp } = await import("../server/app.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-confirmation-"));
  const db = await createDatabase(dir, true);
  const app = createApp(db).listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(async () => {
    await Promise.all([new Promise<void>(resolve => app.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const address = app.address();
  assert(address && typeof address !== "string");
  const post = (route: string, body: object) => fetch(`http://127.0.0.1:${address.port}/api/auth/${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const first = await post("resend-confirmation", { email: "Waiting@Example.test" });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { ok: true });
  const callsBeforeRepeat = providerCalls;
  const repeated = await post("resend-confirmation", { email: " waiting@example.test " });
  assert.equal(repeated.status, 429);
  assert(repeated.headers.has("retry-after"));
  assert.equal(providerCalls, callsBeforeRepeat);
  for (const status of [400, 422, 429]) {
    providerStatus = status;
    const unknown = await post("resend-confirmation", { email: `unknown-${status}@example.test` });
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { ok: true });
  }
  providerStatus = 500;
  const unavailable = await post("resend-confirmation", { email: "outage@example.test" });
  assert.equal(unavailable.status, 503);
  assert(!JSON.stringify(await unavailable.json()).includes("Private provider detail"));
  providerStatus = 403;
  for (let i = 0; i < 10; i++) {
    const badCode = await post("verify-email", { email: "guess@example.test", token: "12345678" });
    assert.equal(badCode.status, 401);
  }
  const beforeBlocked = providerCalls;
  assert.equal((await post("verify-email", { email: " GUESS@EXAMPLE.TEST ", token: "12345678" })).status, 429);
  assert.equal(providerCalls, beforeBlocked);
  const invalid = await post("verify-email", { email: "another@example.test", token: "123xyz" });
  assert.equal(invalid.status, 400);
  assert.equal(providerCalls, beforeBlocked);
});
