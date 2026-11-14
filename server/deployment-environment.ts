import type { Queryable } from "./db.js";

const legacySandbox = "smpdzhxydnctiyjqojmp";
const refuse = () => new Error("The Supabase project is not bound to this billing environment.");

export async function verifyDeploymentEnvironment(db: Queryable, live: boolean, databaseUrl: string, supabaseUrl: string) {
  const auth = new URL(supabaseUrl);
  const database = new URL(databaseUrl);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(database.hostname);
  const pooled = database.hostname.endsWith(".pooler.supabase.com")
    ? /^[^.]+\.([a-z0-9]{20})$/.exec(decodeURIComponent(database.username))
    : null;
  const ref = (direct || pooled)?.[1];
  const local = !live && [auth.hostname, database.hostname].every(host => host === "127.0.0.1" || host === "localhost");
  if (!local && (!ref || auth.origin !== `https://${ref}.supabase.co`)) throw refuse();
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
