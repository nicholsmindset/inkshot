import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verifyDeploymentEnvironment } from "../server/deployment-environment.js";

test("project and billing boundaries survive rollout, retries and runtime role access", async () => {
  const db = await PGlite.create();
  const ref = "abcdefghijklmnopqrst", legacy = "smpdzhxydnctiyjqojmp";
  const url = (id: string) => `https://${id}.supabase.co`;
  const conn = (id: string) => `postgresql://inkshot_app.${id}@aws-0-ap-southeast-1.pooler.supabase.com/postgres`;
  const verify = (live: boolean, id = ref, auth = url(id)) => verifyDeploymentEnvironment(db, live, conn(id), auth);
  try {
    await verify(false, legacy);
    await assert.rejects(verify(true, legacy));
    await assert.rejects(verify(false, ref));
    await assert.rejects(verify(false, legacy, url(ref)));
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id int);
      CREATE SCHEMA storage; CREATE TABLE storage.objects(id int);
      CREATE TABLE public.workspaces(id int); CREATE TABLE public.payment_events(id int); CREATE TABLE public.provider_spend(id int);`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261114140000_deployment_environment.sql", import.meta.url), "utf8"));
    await verify(false);
    await assert.rejects(verify(true));
    const bind = (project: string) => readFile(new URL("../scripts/bind-live-project.sql", import.meta.url), "utf8")
      .then(sql => db.exec(sql.replace(":'project_ref'", "'" + project + "'")));
    for (const table of ["workspaces","auth.users","storage.objects","payment_events","provider_spend"]) {
      await db.exec(`INSERT INTO ${table} VALUES(1)`);
      await assert.rejects(bind(ref), /populated project/);
      await db.exec("ROLLBACK");
      await db.exec(`DELETE FROM ${table}`);
    }
    await bind(ref);
    await db.exec("INSERT INTO workspaces VALUES(1)");
    await bind(ref);
    await verify(true);
    await assert.rejects(verify(false));
    await assert.rejects(verify(true, "uvwxyzabcdefghijklmn"));
    await assert.rejects(verify(true, ref, url(legacy)));
    await verifyDeploymentEnvironment(db,true,`postgresql://inkshot_app@db.${ref}.supabase.co/postgres`,url(ref));
    await db.exec("SET ROLE inkshot_app");
    await verify(true);
    assert.equal((await db.query<{ allowed: boolean }>("SELECT has_table_privilege(current_user,'inkshot_environment','UPDATE') AS allowed")).rows[0].allowed,false);
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(db.query("SELECT * FROM inkshot_environment"), /permission denied/);
  } finally { await db.close(); }
});
