import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("failed website reads and invalid input return plain-language guidance; health exposes the support address", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-errors-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR", "SUPPORT_EMAIL"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER;
  Object.assign(process.env, { BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir, SUPPORT_EMAIL: "help@example.test" });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const db = await createDatabase(dir, true);
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
  });
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api`;
  const signup = await fetch(`${origin}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "M", email: "err@example.test", password: "a-long-test-password" }) });
  const cookie = signup.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const post = (route: string, body: object, method = "POST") => fetch(origin + route, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

  const read = await post("/brand/read", { url: "https://nonexistent.invalid" });
  assert.equal(read.status, 400, "an unknown domain is a user-fixable 400, not a server error");
  assert.match((await read.json() as { error: string }).error, /could not find that website/);

  const invalid = await post("/brand", { name: 5 }, "PUT");
  assert.equal(invalid.status, 400);
  const message = (await invalid.json() as { error: string }).error;
  assert.match(message, /^Please check .* and try again\.$/);
  assert(!/Invalid input|expected/i.test(message), "no raw validation jargon");

  const bad = await fetch(`${origin}/brand`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400, "malformed JSON is a client error, not a 500");
  const huge = await fetch(`${origin}/brand`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(200000) }) });
  assert.equal(huge.status, 413);
  assert.equal((await (await fetch(`${origin}/health`)).json() as { supportEmail: string }).supportEmail, "help@example.test");
});
