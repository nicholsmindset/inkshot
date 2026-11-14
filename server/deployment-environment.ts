import type { Queryable } from "./db.js";

const legacySandbox = "smpdzhxydnctiyjqojmp";
const refuse = () => new Error("The Supabase project is not bound to this billing environment.");

export async function verifyDeploymentEnvironment(db: Queryable, live: boolean, databaseUrl: string, supabaseUrl: string, shared = false) {
  const auth = new URL(supabaseUrl);
  const database = new URL(databaseUrl);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(database.hostname);
  const pooled = database.hostname.endsWith(".pooler.supabase.com")
    ? /^[^.]+\.([a-z0-9]{20})$/.exec(decodeURIComponent(database.username))
    : null;
  const ref = (direct || pooled)?.[1];
  const local = !live && [auth.hostname, database.hostname].every(host => host === "127.0.0.1" || host === "localhost");
  if (!local && (!ref || auth.origin !== `https://${ref}.supabase.co`)) throw refuse();
  if (shared) {
    if (!live || ref !== legacySandbox) throw refuse();
    const result = await db.query<{ ok: boolean }>(
      `SELECT mode = 'live' AND project_ref = $1 AND current_user = 'inkshot_live_app'
        AND session_user = current_user
        AND to_regclass('workspaces') = 'inkshot_live.workspaces'::regclass
        AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('inkshot_live_app','inkshot_app')
          AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication))
        AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname='inkshot_live_app' AND rolbypassrls)
        AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member='inkshot_live_app'::regrole)
        AND NOT pg_has_role('inkshot_app','inkshot_live_app','MEMBER')
        AND NOT has_schema_privilege('inkshot_app','inkshot_live','USAGE')
        AND NOT has_schema_privilege(current_user,'inkshot_live','CREATE')
        AND NOT has_table_privilege(current_user,'inkshot_live.inkshot_environment','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
        AND NOT EXISTS (SELECT FROM pg_class l WHERE l.relnamespace='inkshot_live'::regnamespace AND l.relkind IN ('r','p')
          AND (NOT l.relrowsecurity OR has_table_privilege('inkshot_app',l.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
            OR has_table_privilege(current_user, format('public.%I',l.relname),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')))
        AS ok FROM inkshot_live.inkshot_environment WHERE singleton`, [ref],
    );
    if (result.rows.length !== 1 || result.rows[0].ok !== true) throw refuse();
    return;
  }
  if (!live && ref === legacySandbox) {
    const result = await db.query<{ ok: boolean }>(
      `SELECT current_user <> 'inkshot_live_app' AND (to_regnamespace('inkshot_live') IS NULL
        OR (current_user = 'inkshot_app' AND session_user = current_user)) AS ok`,
    );
    if (result.rows[0]?.ok !== true) throw refuse();
  }
  if (live && ref === legacySandbox) throw refuse();

  // Only the established sandbox may run during rollout before its migration.
  const exists = await db.query<{ present: boolean }>(
    "SELECT to_regclass('public.inkshot_environment') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) {
    if (!live && ref === legacySandbox) return;
    throw refuse();
  }
  const marker = (await db.query<{ mode: string; project_ref: string | null }>(
    "SELECT mode, project_ref FROM public.inkshot_environment WHERE singleton = true",
  )).rows[0];
  if (marker?.mode !== (live ? "live" : "sandbox") || (live && marker.project_ref !== ref)) throw refuse();
}
