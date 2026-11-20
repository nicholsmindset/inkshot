import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("signup and returning login retain the workspace and sign-out clears access", async (t) => {
  process.env.GENERATION_MODE = "mock";
  const { createDatabase } = await import("../server/db.js");
  const { createApp } = await import("../server/app.js");
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkshot-auth-journey-"));
  const db = await createDatabase(directory, true);
  const server = createApp(db).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const post = (route: string, body: object, cookie = "") => fetch(base + route, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const getStudio = (cookie: string) => fetch(base + "/studio", { headers: { cookie } });
  const password = "a-valid-account-password";
  const signup = await post("/auth/signup", { name: "Merchant", email: " Owner@Example.test ", password, website: "example.test" });
  assert.equal(signup.status, 201);
  assert.equal(signup.headers.get("cache-control"), "no-store");
  const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const original = await (await getStudio(cookie)).json();
  assert.equal(original.user.email, "owner@example.test");
  assert.equal((await post("/auth/logout", {}, cookie)).status, 200);
  assert.equal((await getStudio(cookie)).status, 401);
  assert.equal((await post("/auth/login", { email: "owner@example.test", password: "wrong-password" })).status, 401);
  const login = await post("/auth/login", { email: " OWNER@EXAMPLE.TEST ", password });
  assert.equal(login.status, 200);
  const returnedCookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const returned = await (await getStudio(returnedCookie)).json();
  assert.equal(returned.user.id, original.user.id);
  assert.equal(returned.user.workspaceId, original.user.workspaceId);
  assert.equal(returned.balance, original.balance);
  assert.equal((await db.query("SELECT id FROM workspaces")).rows.length, 1);
  const callback = await fetch(base + "/auth/callback?code=invalid", { redirect: "manual" });
  assert.equal(callback.headers.get("location"), "/login?confirmation=failed");
  assert.equal(callback.headers.get("cache-control"), "no-store");
  assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
});
