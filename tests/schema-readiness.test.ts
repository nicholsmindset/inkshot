import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

async function launchSafeguardsSql() {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name.endsWith('_launch_safeguards.sql'));
  assert.equal(names.length, 1, 'Expected exactly one launch safeguards migration');
  return sql('supabase/migrations/' + names[0]);
}

async function sharedSafeguardsFixture() {
  const db = await PGlite.create();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;');
  await db.exec(await sql('server/schema.sql'));
  await db.exec(await sql('supabase/migrations/20261114140000_deployment_environment.sql'));
  await db.exec(await sql('scripts/setup-shared-live.sql'));
  await db.exec(await sql('supabase/migrations/20261119210000_account_deletion.sql'));
  return db;
}

test('launch safeguards readiness rejects each missing or incompatible column in both namespaces without repairing it', async t => {
  const db = await sharedSafeguardsFixture(); t.after(() => db.close());
  const migration = await launchSafeguardsSql();
  const requirements = [
    ['billing_accounts','spend_blocked','text','boolean'],
    ['billing_accounts','spend_block_reason','varchar','text'],
    ['uploads','size_bytes','integer','bigint'],
    ['versions','review_fingerprint','varchar','text'],
    ['versions','reviewed_at','timestamp without time zone','timestamptz'],
  ];
  for (const scope of ['public','inkshot_live']) {
    await db.exec(`SET search_path=${scope},pg_catalog`);
    await verifySchemaReadiness(db,scope==='inkshot_live');
    for (const [table,column,wrongType,rightType] of requirements) {
      await db.exec(`ALTER TABLE ${scope}.${table} DROP COLUMN ${column}`);
      await assert.rejects(verifySchemaReadiness(db,scope==='inkshot_live'),isSchemaError('SCHEMA_LAUNCH_SAFEGUARDS_REQUIRED'));
      assert.equal((await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',[scope,table,column])).rows.length,0);
      await db.exec(migration);
      await verifySchemaReadiness(db,scope==='inkshot_live');
      // Additive migrations must not conceal an incompatible existing type.
      await db.exec(`ALTER TABLE ${scope}.${table} ALTER COLUMN ${column} DROP DEFAULT; ALTER TABLE ${scope}.${table} ALTER COLUMN ${column} TYPE ${wrongType} USING ${column}::${wrongType}`);
      await assert.rejects(verifySchemaReadiness(db,scope==='inkshot_live'),isSchemaError('SCHEMA_LAUNCH_SAFEGUARDS_REQUIRED'));
      await db.exec(migration);
      await assert.rejects(verifySchemaReadiness(db,scope==='inkshot_live'),isSchemaError('SCHEMA_LAUNCH_SAFEGUARDS_REQUIRED'));
      await db.exec(`ALTER TABLE ${scope}.${table} ALTER COLUMN ${column} TYPE ${rightType} USING ${column}::${rightType}`);
      await verifySchemaReadiness(db,scope==='inkshot_live');
    }
  }
});

test('launch safeguards migration preserves legacy customer data and is idempotent across sandbox and live schemas', async t => {
  const db = await sharedSafeguardsFixture(); t.after(() => db.close());
  const migration = await launchSafeguardsSql();
  for (const scope of ['public','inkshot_live']) {
    await db.exec(`INSERT INTO ${scope}.workspaces(id,credits,brand) VALUES('customer',37,'{"name":"Existing merchant"}');
      INSERT INTO ${scope}.users(id,workspace_id,name,email,password_hash) VALUES('user','customer','Existing merchant','customer@example.test','preserved-hash');
      INSERT INTO ${scope}.billing_accounts(workspace_id,customer_id,status) VALUES('customer','cus_existing','active');
      INSERT INTO ${scope}.uploads(id,workspace_id,file_path) VALUES('photo','customer','supabase://brand-uploads/customer/photo.png');
      INSERT INTO ${scope}.campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES('kit','customer','Existing kit','Sales','[]','{}',true);
      INSERT INTO ${scope}.assets(id,workspace_id,campaign_id,kind,title,format) VALUES('asset','customer','kit','image','Existing asset','4:5');
      INSERT INTO ${scope}.versions(id,asset_id,workspace_id,n,prompt,headline,cta,mock) VALUES('version','asset','customer',1,'Approved scene','Existing headline','Order now',true);
      ALTER TABLE ${scope}.billing_accounts DROP COLUMN spend_blocked, DROP COLUMN spend_block_reason;
      ALTER TABLE ${scope}.uploads DROP COLUMN size_bytes;
      ALTER TABLE ${scope}.versions DROP COLUMN review_fingerprint, DROP COLUMN reviewed_at;`);
  }
  const customerRows = async (scope:string) => (await db.query(`SELECT w.id,w.credits,w.brand,u.email,u.password_hash,b.customer_id,b.status,p.file_path,v.prompt,v.headline,v.cta FROM ${scope}.workspaces w JOIN ${scope}.users u ON u.workspace_id=w.id JOIN ${scope}.billing_accounts b ON b.workspace_id=w.id JOIN ${scope}.uploads p ON p.workspace_id=w.id JOIN ${scope}.versions v ON v.workspace_id=w.id`)).rows;
  const before = await Promise.all(['public','inkshot_live'].map(customerRows));
  await db.exec(migration); await db.exec(migration);
  for (const [i,scope] of ['public','inkshot_live'].entries()) {
    assert.deepEqual(await customerRows(scope),before[i]);
    assert.deepEqual((await db.query(`SELECT spend_blocked,spend_block_reason FROM ${scope}.billing_accounts`)).rows,[{spend_blocked:false,spend_block_reason:null}]);
    assert.equal(Number((await db.query<{size_bytes:string}>(`SELECT size_bytes FROM ${scope}.uploads`)).rows[0].size_bytes),10485760);
    assert.deepEqual((await db.query(`SELECT review_fingerprint,reviewed_at FROM ${scope}.versions`)).rows,[{review_fingerprint:null,reviewed_at:null}]);
    await assert.rejects(db.exec(`UPDATE ${scope}.uploads SET size_bytes=-1`),/check constraint/);
    await db.exec(`UPDATE ${scope}.billing_accounts SET spend_blocked=true,spend_block_reason='refund_review'; UPDATE ${scope}.uploads SET size_bytes=1234; UPDATE ${scope}.versions SET review_fingerprint='approved-fingerprint',reviewed_at='2026-11-21T00:00:00Z'`);
  }
  await db.exec(migration);
  for (const scope of ['public','inkshot_live']) {
    assert.deepEqual((await db.query(`SELECT spend_blocked,spend_block_reason FROM ${scope}.billing_accounts`)).rows,[{spend_blocked:true,spend_block_reason:'refund_review'}]);
    assert.equal(Number((await db.query<{size_bytes:string}>(`SELECT size_bytes FROM ${scope}.uploads`)).rows[0].size_bytes),1234);
    const review=(await db.query<{review_fingerprint:string;reviewed_at:Date}>(`SELECT review_fingerprint,reviewed_at FROM ${scope}.versions`)).rows[0];
    assert.equal(review.review_fingerprint,'approved-fingerprint'); assert.equal(new Date(review.reviewed_at).toISOString(),'2026-11-21T00:00:00.000Z');
    await db.exec(`SET search_path=${scope},pg_catalog`); await verifySchemaReadiness(db,scope==='inkshot_live');
  }
});

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
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const [table,code,migration] of [
      ['account_deletions','SCHEMA_ACCOUNT_DELETION_REQUIRED','20261119210000_account_deletion.sql'],
      ['provider_events','SCHEMA_PROVIDER_EVENTS_REQUIRED','20261119200000_provider_events.sql'],
      ['campaign_exports','SCHEMA_CAMPAIGN_EXPORTS_REQUIRED','20261119170000_campaign_exports.sql'],
    ]) {
      await db.exec(`DROP TABLE ${table}`);
      await assert.rejects(verifySchemaReadiness(db), isSchemaError(code));
      await db.exec(await sql('supabase/migrations/'+migration));
      await verifySchemaReadiness(db);
    }
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
