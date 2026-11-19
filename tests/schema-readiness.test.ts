import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { databaseFromPool } from "../server/db.js";
import { createHostedHandler } from "../server/hosted-handler.js";
import { SchemaReadinessError, verifySchemaReadiness } from "../server/schema-readiness.js";

const sql = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");
const planning = "supabase/migrations/20261119090000_campaign_planning.sql";
const limits = "supabase/migrations/20261119100000_shared_rate_limits.sql";
const isSchemaError = (code: string) => (error: unknown) =>
  error instanceof SchemaReadinessError && error.code === code;

test("readiness identifies missing columns, wrong types and rate-limit migrations without changing data", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await sql("server/schema.sql"));
    await db.exec("INSERT INTO workspaces(id,credits) VALUES ('existing-customer',37)");
    await verifySchemaReadiness(db);
    for (const [table, column] of [["campaigns", "draft"], ["versions", "motion_prompt"]]) {
      await db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      await assert.rejects(verifySchemaReadiness(db), isSchemaError("SCHEMA_CAMPAIGN_PLANNING_REQUIRED"));
      const present = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2", [table, column]);
      assert.equal(present.rows.length, 0, "the guard must not run a migration");
      await db.exec(await sql(planning));
      await verifySchemaReadiness(db);
    }
    await db.exec("ALTER TABLE campaigns ALTER COLUMN draft TYPE text USING draft::text");
    await assert.rejects(verifySchemaReadiness(db), isSchemaError("SCHEMA_CAMPAIGN_PLANNING_REQUIRED"));
    await db.exec("ALTER TABLE campaigns ALTER COLUMN draft TYPE jsonb USING draft::jsonb");
    await db.exec("DROP TABLE rate_limit_buckets");
    await assert.rejects(verifySchemaReadiness(db), isSchemaError("SCHEMA_SHARED_RATE_LIMITS_REQUIRED"));
    await db.exec(await sql(limits));
    await verifySchemaReadiness(db);
    await db.exec('ALTER TABLE versions DROP COLUMN first_frame_source');
    await assert.rejects(verifySchemaReadiness(db), isSchemaError('SCHEMA_PHOTO_VIDEO_REQUIRED'));
    await db.exec(await sql('supabase/migrations/20261119160000_photo_first_video.sql'));
    await verifySchemaReadiness(db);
    assert.deepEqual((await db.query("SELECT id,credits FROM workspaces")).rows, [{ id: "existing-customer", credits: 37 }]);
  } finally { await db.close(); }
});

test("shared live readiness uses the scoped runtime role and never falls back to the sandbox", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;");
    await db.exec(await sql("server/schema.sql"));
    await db.exec(await sql("supabase/migrations/20261114140000_deployment_environment.sql"));
    await db.exec(await sql("scripts/setup-shared-live.sql"));
    await db.exec(await sql("supabase/migrations/20261119210000_account_deletion.sql"));
    // Simulate an older live schema while the sandbox already has the columns.
    await db.exec("ALTER TABLE inkshot_live.campaigns DROP COLUMN draft; ALTER TABLE inkshot_live.versions DROP COLUMN motion_prompt; DROP TABLE IF EXISTS inkshot_live.rate_limit_buckets;");
    const liveRole = () => db.exec("SET SESSION AUTHORIZATION inkshot_live_app; SET search_path=pg_catalog,inkshot_live,pg_temp;");
    await liveRole();
    await assert.rejects(verifySchemaReadiness(db, true), isSchemaError("SCHEMA_CAMPAIGN_PLANNING_REQUIRED"));
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await db.exec(await sql(planning));
    await liveRole();
    await assert.rejects(verifySchemaReadiness(db, true), isSchemaError("SCHEMA_SHARED_RATE_LIMITS_REQUIRED"));
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await db.exec(await sql(limits));
    await liveRole();
    await verifySchemaReadiness(db, true);
    await assert.rejects(db.query("SELECT * FROM public.workspaces"), /permission denied/);
    await db.exec("SET SESSION AUTHORIZATION postgres; ALTER TABLE inkshot_live.versions DROP COLUMN video_duration_seconds; ALTER TABLE inkshot_live.versions DROP COLUMN first_frame_source;");
    await liveRole();
    await assert.rejects(verifySchemaReadiness(db, true), isSchemaError('SCHEMA_PHOTO_VIDEO_REQUIRED'));
    await db.exec('SET SESSION AUTHORIZATION postgres');
    await db.exec(await sql('supabase/migrations/20261119160000_photo_first_video.sql'));
    await db.exec(await sql('supabase/migrations/20261119160000_photo_first_video.sql'));
    await liveRole();
    await verifySchemaReadiness(db, true);
    // An administrator's permissive search path must not hide a missing live table.
    await db.exec("SET SESSION AUTHORIZATION postgres; DROP TABLE inkshot_live.rate_limit_buckets; SET search_path=inkshot_live,public;");
    await assert.rejects(verifySchemaReadiness(db, true), isSchemaError("SCHEMA_SHARED_RATE_LIMITS_REQUIRED"));
    await db.exec(await sql(limits));
    await db.exec("SET search_path=public,inkshot_live;");
    await assert.rejects(verifySchemaReadiness(db, true), isSchemaError("SCHEMA_CAMPAIGN_PLANNING_REQUIRED"));
  } finally { await db.close(); }
});

test("hosted initialization blocks an old schema, closes the pool, and recovers after migrations", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await sql("server/schema.sql"));
    await db.exec("CREATE TABLE inkshot_environment(singleton boolean,mode text,project_ref text); INSERT INTO inkshot_environment VALUES(true,'sandbox',NULL); ALTER TABLE campaigns DROP COLUMN draft;");
    let closed = 0, applications = 0;
    const diagnostics: { stage: string; code?: string; reference: string }[] = [];
    const pool = {
      query: (query: string, params?: unknown[]) => db.query(query, params),
      connect: async () => ({ query: (query: string, params?: unknown[]) => db.query(query, params), release: () => {} }),
      end: async () => { closed++; },
    } as unknown as pg.Pool;
    const handler = createHostedHandler({
      assertConfiguration: () => {},
      database: () => databaseFromPool(pool, false, "postgresql://localhost/inkshot", "http://localhost:54321", false),
      createApp: () => { applications++; return (_req, res) => res.end("ready"); },
      report: diagnostic => diagnostics.push(diagnostic),
    });
    const call = async () => {
      const res = { statusCode: 200, body: "", setHeader: () => {}, end(value: string) { this.body = value; } };
      await handler({} as IncomingMessage, res as unknown as ServerResponse);
      return res;
    };
    const failed = await call();
    assert.equal(failed.statusCode, 503);
    assert.equal(applications, 0);
    assert.equal(closed, 1);
    assert.equal(diagnostics[0].stage, "database");
    assert.equal(diagnostics[0].code, "SCHEMA_CAMPAIGN_PLANNING_REQUIRED");
    assert.equal(JSON.parse(failed.body).reference, diagnostics[0].reference);
    assert(!/SCHEMA_|draft|postgresql|campaigns/.test(failed.body));
    await db.exec(await sql(planning));
    assert.equal((await call()).body, "ready");
    assert.equal(applications, 1);
  } finally { await db.close(); }
});
