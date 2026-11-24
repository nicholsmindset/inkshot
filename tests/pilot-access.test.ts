import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("invite-only signup needs a valid single-use code, releases it on failure, and the waitlist stores email and URL", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-pilot-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR", "PILOT_INVITE_ONLY"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER;
  Object.assign(process.env, { BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir, PILOT_INVITE_ONLY: "true" });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const { createInvite } = await import("../server/pilot-access.js");
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
  const post = (route: string, body: object) => fetch(origin + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const person = (email: string, inviteCode?: string) => ({ name: "Merchant", email, password: "a-long-test-password", ...(inviteCode ? { inviteCode } : {}) });

  assert.equal((await (await fetch(`${origin}/health`)).json() as { inviteOnly: boolean }).inviteOnly, true);
  assert.equal((await post("/auth/signup", person("a@example.test"))).status, 403, "no code");
  assert.equal((await post("/auth/signup", person("a@example.test", "INK-WRONG"))).status, 403, "unknown code");

  const code = await createInvite(db, "cohort 1");
  assert.match(code, /^INK-[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.equal((await db.query("SELECT id FROM invites WHERE code_hash=$1", [code])).rows.length, 0, "the plain code is never stored");
  assert.equal((await post("/auth/signup", person("a@example.test", code.toLowerCase()))).status, 201);
  assert.equal((await post("/auth/signup", person("b@example.test", code))).status, 403, "single use");
  assert.equal((await db.query("SELECT used_email FROM invites")).rows[0].used_email, "a@example.test");

  // A signup that fails after the claim gives the code back.
  const second = await createInvite(db);
  assert.equal((await post("/auth/signup", person("a@example.test", second))).status, 409, "email already registered");
  assert.equal((await db.query("SELECT used_at FROM invites WHERE used_at IS NULL")).rows.length, 1);
  assert.equal((await post("/auth/signup", person("c@example.test", second))).status, 201);

  // Expired codes are refused; concurrent use of one code succeeds once.
  const expired = await createInvite(db);
  await db.query("UPDATE invites SET expires_at=now()-interval '1 day' WHERE used_at IS NULL");
  assert.equal((await post("/auth/signup", person("d@example.test", expired))).status, 403);
  const racing = await createInvite(db);
  const statuses = (await Promise.all(["e", "f", "g"].map(n => post("/auth/signup", person(`${n}@example.test`, racing))))).map(r => r.status);
  assert.equal(statuses.filter(s => s === 201).length, 1);

  assert.equal((await post("/waitlist", { email: "Owner@Example.test", businessUrl: "https://bakery.example.test" })).status, 202);
  assert.equal((await post("/waitlist", { email: "owner@example.test", businessUrl: "https://other.example.test" })).status, 202);
  const list = (await db.query("SELECT email,business_url FROM waitlist")).rows;
  assert.deepEqual(list, [{ email: "owner@example.test", business_url: "https://bakery.example.test" }]);
  assert.equal((await post("/waitlist", { email: "nope", businessUrl: "x" })).status, 400);
});

test("without PILOT_INVITE_ONLY signup needs no code", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-open-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "DATA_DIR", "PILOT_INVITE_ONLY", "GENERATION_MODE", "BILLING_MODE"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER; delete process.env.PILOT_INVITE_ONLY;
  Object.assign(process.env, { DATA_DIR: dir, GENERATION_MODE: "mock", BILLING_MODE: "off" });
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
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "M", email: "open@example.test", password: "a-long-test-password" }) });
  assert.equal(response.status, 201);
});

test("pilot access migration is additive, idempotent and covers both namespaces without exposing the tables", async t => {
  const sql = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;");
  await db.exec(await sql("server/schema.sql"));
  await db.exec(await sql("supabase/migrations/20261114140000_deployment_environment.sql"));
  await db.exec(await sql("scripts/setup-shared-live.sql"));
  const migration = await sql("supabase/migrations/20261124090000_pilot_access.sql");
  await db.exec(migration); await db.exec(migration);
  const tables = (await db.query<{ table_schema: string; table_name: string }>(
    "SELECT table_schema,table_name FROM information_schema.tables WHERE table_name IN ('invites','waitlist') AND table_schema IN ('public','inkshot_live') ORDER BY 1,2")).rows;
  assert.deepEqual(tables.map(r => `${r.table_schema}.${r.table_name}`), ["inkshot_live.invites", "inkshot_live.waitlist", "public.invites", "public.waitlist"]);
  const exposed = await db.query("SELECT grantee,table_schema,table_name FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated','service_role') AND table_name IN ('invites','waitlist')");
  assert.equal(exposed.rows.length, 0);
});
