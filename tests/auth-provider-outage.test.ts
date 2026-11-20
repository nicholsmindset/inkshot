import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("managed login and code verification distinguish provider outages without leaking details", async t => {
  let providerStatus = 400;
  const provider = createServer((_req, res) => {
    if (providerStatus === 0) { res.destroy(); return; }
    res.writeHead(providerStatus, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "fixture_error", msg: "Private provider detail" }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  const providerAddress = provider.address();
  assert(providerAddress && typeof providerAddress !== "string");
  process.env.AUTH_PROVIDER = "supabase";
  process.env.SUPABASE_URL = `http://127.0.0.1:${providerAddress.port}`;
  process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-publishable-key";
  const { createDatabase } = await import("../server/db.js");
  const { createApp } = await import("../server/app.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-auth-outage-"));
  const db = await createDatabase(dir, true);
  const app = createApp(db).listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(async () => {
    await Promise.all([
      new Promise<void>(resolve => app.close(() => resolve())),
      new Promise<void>(resolve => provider.close(() => resolve())),
    ]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const address = app.address();
  assert(address && typeof address !== "string");
  for (const route of ["login", "verify-email"]) {
    const invalidMessage = route === "login"
      ? "Unable to sign in. Check your email, password and email confirmation."
      : "That code is invalid or has expired. Request a new confirmation email.";
    const unavailableMessage = route === "login"
      ? "Sign-in is temporarily unavailable. Please try again."
      : "Email verification is temporarily unavailable. Please try again.";
    for (const status of [400, 401, 403, 422, 500, 503, 0]) {
      providerStatus = status;
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/auth/${route}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "merchant@example.test", password: "fixture-password", token: "12345678" }),
      });
      const unavailable = status === 0 || status >= 500;
      assert.equal(response.status, unavailable ? 503 : 401, `${route}: provider status ${status}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: unavailable ? unavailableMessage : invalidMessage });
      assert.equal(response.headers.get("set-cookie"), null, "rejected authentication must not create a session");
    }
  }
  assert.equal((await db.query("SELECT id FROM users")).rows.length, 0);
});
