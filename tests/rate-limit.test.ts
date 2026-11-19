import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PostgresRateLimitStore, clientRateLimitKey } from "../server/rate-limit.js";

const schema = () => readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
const migration = () => readFile(new URL("../supabase/migrations/20261119100000_shared_rate_limits.sql", import.meta.url), "utf8");

test("shared counters survive separate store instances and concurrent requests without raw identities", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await schema());
    const stores = [new PostgresRateLimitStore(db, "auth"), new PostgresRateLimitStore(db, "auth")];
    for (const store of stores) store.init({ windowMs: 60_000 });
    const responses = await Promise.all(Array.from({ length: 30 }, (_, i) => stores[i % 2].increment("owner@example.test")));
    assert.deepEqual(responses.map(r => r.totalHits).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.equal(new Set(responses.map(r => r.resetTime?.getTime())).size, 1);
    const restart = new PostgresRateLimitStore(db, "auth");
    restart.init({ windowMs: 60_000 });
    assert.equal((await restart.increment("owner@example.test")).totalHits, 31);
    const otherPurpose = new PostgresRateLimitStore(db, "resend");
    otherPurpose.init({ windowMs: 60_000 });
    assert.equal((await otherPurpose.increment("owner@example.test")).totalHits, 1);
    const stored = (await db.query<{bucket_key: string}>("SELECT bucket_key FROM rate_limit_buckets")).rows;
    assert.equal(stored.length, 2);
    assert(stored.every(row => /^[a-f0-9]{64}$/.test(row.bucket_key)));
    await restart.resetKey("owner@example.test");
    assert.equal((await otherPurpose.increment("owner@example.test")).totalHits, 2);
    assert.equal((await restart.increment("owner@example.test")).totalHits, 1);
  } finally { await db.close(); }
});

test("database expiration starts a new window and expired cleanup is bounded", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await schema());
    const store = new PostgresRateLimitStore(db, "api");
    store.init({ windowMs: 60_000 });
    const initial = await store.increment("192.0.2.1");
    await db.exec("UPDATE rate_limit_buckets SET expires_at = statement_timestamp() - interval '1 second'");
    assert.equal((await store.increment("192.0.2.1")).totalHits, 1);
    const databaseClock = (await db.query<{now: Date}>("SELECT statement_timestamp() AS now")).rows[0].now;
    const fresh = await store.increment("192.0.2.1");
    assert.equal(fresh.totalHits, 2);
    assert(fresh.resetTime && fresh.resetTime.getTime() >= databaseClock.getTime() + 59_000);
    assert(initial.resetTime);
    await db.exec(`INSERT INTO rate_limit_buckets(bucket_key,hits,expires_at)
      SELECT 'expired-' || n, 5, statement_timestamp() - interval '1 day' FROM generate_series(1,70) n`);
    await store.increment("192.0.2.1");
    assert.equal((await db.query("SELECT bucket_key FROM rate_limit_buckets WHERE bucket_key LIKE 'expired-%'")).rows.length, 6);
    await store.decrement("192.0.2.1");
    await store.decrement("192.0.2.1");
    await store.decrement("192.0.2.1");
    await store.decrement("192.0.2.1");
    assert.equal((await store.increment("192.0.2.1")).totalHits, 1);
  } finally { await db.close(); }
});

test("counter storage failures reject requests without an in-memory fallback", async () => {
  const store = new PostgresRateLimitStore({ query: async () => { throw new Error("database unavailable"); } }, "auth");
  store.init({ windowMs: 60_000 });
  await assert.rejects(store.increment("192.0.2.1"), /database unavailable/);
  await assert.rejects(store.increment("192.0.2.1"), /database unavailable/);
});

test("counter migration is repeatable and runtime grants stay inside the correct namespace", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app; CREATE ROLE inkshot_live_app; CREATE SCHEMA inkshot_live; CREATE TABLE inkshot_live.workspaces(id text);");
    await db.exec(await schema());
    await db.exec(await migration());
    await db.exec(await migration());
    await db.exec("GRANT USAGE ON SCHEMA inkshot_live TO inkshot_live_app; SET SESSION AUTHORIZATION inkshot_app;");
    const sandbox = new PostgresRateLimitStore(db, "auth");
    sandbox.init({ windowMs: 60_000 });
    assert.equal((await sandbox.increment("192.0.2.1")).totalHits, 1);
    await assert.rejects(db.query("SELECT * FROM inkshot_live.rate_limit_buckets"), /permission denied/);
    await db.exec("RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION inkshot_live_app; SET search_path = pg_catalog, inkshot_live, pg_temp;");
    const live = new PostgresRateLimitStore(db, "auth");
    live.init({ windowMs: 60_000 });
    assert.equal((await live.increment("192.0.2.1")).totalHits, 1);
    await assert.rejects(db.query("SELECT * FROM public.rate_limit_buckets"), /permission denied/);
    await db.exec("RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION anon;");
    await assert.rejects(db.query("SELECT * FROM public.rate_limit_buckets"), /permission denied/);
  } finally { await db.close(); }
});

test("client identity trusts only a valid single Vercel-overwritten address and groups IPv6 subnets", t => {
  const previous = process.env.VERCEL;
  t.after(() => { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; });
  const request = (value?: string | string[]) => ({ headers: { "x-vercel-forwarded-for": value, "x-forwarded-for": "198.51.100.99" }, socket: { remoteAddress: "192.0.2.1" } });
  delete process.env.VERCEL;
  assert.equal(clientRateLimitKey(request("198.51.100.1")), "192.0.2.1");
  process.env.VERCEL = "1";
  assert.equal(clientRateLimitKey(request("198.51.100.1")), "198.51.100.1");
  for (const value of [undefined, "garbage", "198.51.100.1, 192.0.2.1", ["198.51.100.1"]])
    assert.equal(clientRateLimitKey(request(value)), "192.0.2.1");
  assert.equal(clientRateLimitKey(request("2001:db8:1234:5600::1")), clientRateLimitKey(request("2001:db8:1234:56ff::2")));
});
