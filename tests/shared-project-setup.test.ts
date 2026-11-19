import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifyDeploymentEnvironment } from "../server/deployment-environment.js";

const ref = "smpdzhxydnctiyjqojmp";
const project = `https://${ref}.supabase.co`;
const connection = `postgresql://inkshot_live_app.${ref}@aws-0-ap-southeast-1.pooler.supabase.com/postgres`;
const sql = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");

test("shared project creates a clean, independently constrained live schema and refuses mixed roles", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;");
    await db.exec(await sql("server/schema.sql"));
    await db.exec(await sql("supabase/migrations/20261114140000_deployment_environment.sql"));
    await db.exec("INSERT INTO public.workspaces(id,credits) VALUES ('test-fixture',300)");
    const setup = await sql("scripts/setup-shared-live.sql");
    await db.exec(setup);
    await db.exec(setup);
    await db.exec(await sql("supabase/migrations/20261119170000_campaign_exports.sql"));
    await db.exec(await sql("supabase/migrations/20261119170000_campaign_exports.sql"));
    assert.equal((await db.query<{credits:number}>("SELECT credits FROM public.workspaces WHERE id='test-fixture'")).rows[0].credits,300);
    await db.exec("SET SESSION AUTHORIZATION inkshot_live_app; SET search_path = pg_catalog, inkshot_live, pg_temp;");
    await verifyDeploymentEnvironment(db,true,connection,project,true);
    await assert.rejects(verifyDeploymentEnvironment(db,false,connection,project,true));
    await assert.rejects(verifyDeploymentEnvironment(db,false,connection,project));
    await assert.rejects(verifyDeploymentEnvironment(db,true,connection,project));
    assert.equal((await db.query("SELECT * FROM workspaces")).rows.length,0);
    await assert.rejects(db.query("SELECT * FROM public.workspaces"),/permission denied/);
    await assert.rejects(db.query("INSERT INTO billing_accounts(workspace_id) VALUES ('test-fixture')"),/foreign key/);
    await assert.rejects(db.query("UPDATE inkshot_environment SET mode='sandbox'"),/permission denied/);
    await db.exec("INSERT INTO workspaces(id) VALUES ('live-fixture'); INSERT INTO billing_accounts(workspace_id) VALUES ('live-fixture')");
    await db.exec("RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION inkshot_app; SET search_path = public;");
    await verifyDeploymentEnvironment(db,false,connection,project);
    await assert.rejects(db.query("SELECT * FROM inkshot_live.workspaces"), /permission denied/);
    await assert.rejects(verifyDeploymentEnvironment(db,true,connection,project,true));
    await db.exec("RESET SESSION AUTHORIZATION;");
    const badFKs = await db.query(`SELECT conname FROM pg_constraint c JOIN pg_class tbl ON tbl.oid=c.conrelid
      JOIN pg_class parent ON parent.oid=c.confrelid WHERE c.contype='f' AND tbl.relnamespace='inkshot_live'::regnamespace
      AND parent.relnamespace <> 'inkshot_live'::regnamespace`);
    assert.equal(badFKs.rows.length,0);
  } finally { await db.close(); }
});
