-- Run as the project administrator in the existing Inkshot project after its
-- standard public schema migrations. Never pass a password through this script.
BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT pg_advisory_xact_lock(hashtext('inkshot_shared_live_setup'));
DO $setup$
DECLARE
  tables text[] := ARRAY['workspaces','users','sessions','campaigns','assets','versions','jobs',
    'ledger','uploads','billing_accounts','payment_events','provider_spend','writing_daily_usage'];
  tbl text;
  fk record;
  target text;
  already_bound boolean;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inkshot_app') THEN
    RAISE EXCEPTION 'Provision the existing scoped sandbox login before creating the live schema';
  END IF;
  IF NOT EXISTS (SELECT FROM public.inkshot_environment WHERE singleton AND mode='sandbox') THEN
    RAISE EXCEPTION 'Apply sandbox schema migrations and verify the sandbox marker first';
  END IF;
  IF to_regnamespace('inkshot_live') IS NOT NULL THEN
    SELECT EXISTS (SELECT FROM inkshot_live.inkshot_environment WHERE singleton AND mode='live'
       AND project_ref='smpdzhxydnctiyjqojmp') INTO already_bound;
    IF NOT already_bound THEN RAISE EXCEPTION 'Unexpected existing live schema'; END IF;
  ELSE
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='inkshot_live_app') THEN
      RAISE EXCEPTION 'Refusing to adopt a pre-existing live role without a bound schema';
    END IF;
    CREATE ROLE inkshot_live_app NOLOGIN NOINHERIT;
    CREATE SCHEMA inkshot_live;
    REVOKE ALL ON SCHEMA inkshot_live FROM PUBLIC,anon,authenticated,service_role,inkshot_app;
    GRANT USAGE ON SCHEMA inkshot_live TO inkshot_live_app;
    FOREACH tbl IN ARRAY tables LOOP
      -- LIKE copies columns, local indexes, uniqueness and checks, never rows or RLS policies.
      EXECUTE format('CREATE TABLE inkshot_live.%I (LIKE public.%I INCLUDING ALL)',tbl,tbl);
      EXECUTE format('ALTER TABLE inkshot_live.%I ENABLE ROW LEVEL SECURITY',tbl);
      EXECUTE format('REVOKE ALL ON inkshot_live.%I FROM PUBLIC,anon,authenticated,service_role,inkshot_app',tbl);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON inkshot_live.%I TO inkshot_live_app',tbl);
      EXECUTE format('CREATE POLICY live_runtime ON inkshot_live.%I TO inkshot_live_app USING (true) WITH CHECK (true)',tbl);
    END LOOP;
    -- LIKE excludes foreign keys. Rebind every FK to its corresponding LIVE
    -- parent, retaining column order, delete/update actions and deferrability.
    FOR fk IN SELECT c.conname, child.relname AS child, parent.relname AS parent,
       pg_get_constraintdef(c.oid) AS definition, pn.nspname AS parent_schema
       FROM pg_constraint c JOIN pg_class child ON c.conrelid=child.oid
       JOIN pg_class parent ON c.confrelid=parent.oid JOIN pg_namespace pn ON parent.relnamespace=pn.oid
       WHERE c.contype='f' AND child.relnamespace='public'::regnamespace AND child.relname=ANY(tables)
    LOOP
      target := format('REFERENCES public.%I(',fk.parent);
      IF fk.parent_schema <> 'public' OR NOT fk.parent=ANY(tables) OR strpos(fk.definition,target)=0 THEN
        RAISE EXCEPTION 'Unrecognised foreign key % on %', fk.conname, fk.child;
      END IF;
      EXECUTE format('ALTER TABLE inkshot_live.%I ADD CONSTRAINT %I %s',fk.child,fk.conname,
        replace(fk.definition,target,format('REFERENCES inkshot_live.%I(',fk.parent)));
    END LOOP;
    CREATE TABLE inkshot_live.inkshot_environment (LIKE public.inkshot_environment INCLUDING ALL);
    INSERT INTO inkshot_live.inkshot_environment(mode,project_ref) VALUES ('live','smpdzhxydnctiyjqojmp');
    ALTER TABLE inkshot_live.inkshot_environment ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON inkshot_live.inkshot_environment FROM PUBLIC,anon,authenticated,service_role,inkshot_app,inkshot_live_app;
    GRANT SELECT ON inkshot_live.inkshot_environment TO inkshot_live_app;
    CREATE POLICY live_marker_read ON inkshot_live.inkshot_environment FOR SELECT TO inkshot_live_app USING(true);
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('inkshot_app','inkshot_live_app')
    AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication))
    OR EXISTS (SELECT FROM pg_roles WHERE rolname='inkshot_live_app' AND rolbypassrls)
    OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'inkshot_live_app'::regrole)
    OR pg_has_role('inkshot_app','inkshot_live_app','MEMBER')
    OR has_schema_privilege('inkshot_app','inkshot_live','USAGE')
    OR has_schema_privilege('inkshot_live_app','inkshot_live','CREATE') THEN
    RAISE EXCEPTION 'Runtime roles must be isolated and unprivileged';
  END IF;
  FOREACH tbl IN ARRAY tables LOOP
    IF has_table_privilege('inkshot_live_app', format('public.%I',tbl), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('inkshot_app', format('inkshot_live.%I',tbl), 'SELECT,INSERT,UPDATE,DELETE')
    THEN RAISE EXCEPTION 'Cross-environment grant on %',tbl; END IF;
  END LOOP;
END $setup$;
COMMIT;
