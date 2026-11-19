import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifySchemaReadiness } from "../server/schema-readiness.js";
import { verifyDeploymentEnvironment } from "../server/deployment-environment.js";

const sql = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");
test("fresh migrations provision private storage and scoped runtime access without enabling payments", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;`);
    const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) await db.exec(await sql("supabase/migrations/" + file));
    const provision = await sql("supabase/migrations/20261119143158_inkshot_runtime_access.sql");
    await db.exec(provision);
    await db.exec(provision);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM storage.buckets WHERE public")).rows[0].count, 0);
    const role = (await db.query("SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='inkshot_app'")).rows[0];
    assert.deepEqual(role, { rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
    for (const name of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${name}`);
      await assert.rejects(db.query("SELECT * FROM public.workspaces"), /permission denied/);
      await assert.rejects(db.query("SELECT * FROM public.campaign_exports"), /permission denied/);
      assert.equal((await db.query<{ allowed: boolean }>("SELECT has_function_privilege(current_user,'public.rls_auto_enable()','EXECUTE') AS allowed")).rows[0].allowed, false);
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE inkshot_app");
    await verifySchemaReadiness(db);
    assert.equal((await db.query("SELECT * FROM campaign_exports")).rows.length,0);
    const ref = "zdvniqffhiycyxxzchmi";
    await verifyDeploymentEnvironment(db, false, `postgresql://inkshot_app@db.${ref}.supabase.co/postgres`, `https://${ref}.supabase.co`);
    await assert.rejects(verifyDeploymentEnvironment(db, true, `postgresql://inkshot_app@db.${ref}.supabase.co/postgres`, `https://${ref}.supabase.co`));
    await db.exec("INSERT INTO workspaces(id) VALUES('runtime-test'); UPDATE workspaces SET credits=1 WHERE id='runtime-test'; DELETE FROM workspaces WHERE id='runtime-test'");
    await assert.rejects(db.query("UPDATE inkshot_environment SET mode='live'"), /permission denied/);
    await assert.rejects(db.query("TRUNCATE workspaces CASCADE"), /permission denied/);
    await db.exec("RESET ROLE");
    // Existing shared-schema installations use an independent runtime role.
    await db.exec(await sql("scripts/setup-shared-live.sql"));
    await db.exec(await sql("supabase/migrations/20261119100000_shared_rate_limits.sql"));
    await db.exec(provision);
    await db.exec("SET SESSION AUTHORIZATION inkshot_live_app; SET search_path=pg_catalog,inkshot_live,pg_temp;");
    await verifySchemaReadiness(db, true);
    assert.equal((await db.query("SELECT * FROM campaign_exports")).rows.length,0);
    await assert.rejects(db.query("SELECT * FROM public.campaign_exports"), /permission denied/);
    await db.exec("INSERT INTO workspaces(id) VALUES('live-runtime-test')");
    await assert.rejects(db.query("SELECT * FROM public.workspaces"), /permission denied/);
  } finally { await db.close(); }
});
