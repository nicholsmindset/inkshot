-- Run after the application migrations. Does not activate live billing or
-- provision login credentials. Apply through the migration runner.
BEGIN;
DO $runtime$
DECLARE
  target_schema text;
  runtime_role text;
  table_name text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'inkshot_live'] LOOP
    IF to_regclass(format('%I.workspaces', target_schema)) IS NULL THEN CONTINUE; END IF;
    runtime_role := CASE WHEN target_schema = 'public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', runtime_role);
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
      OR EXISTS (SELECT FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = runtime_role))
    THEN RAISE EXCEPTION 'Runtime role % must be unprivileged and have no role memberships', runtime_role; END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', target_schema, runtime_role);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM %I', target_schema, runtime_role);
    FOREACH table_name IN ARRAY ARRAY[
      'workspaces', 'users', 'sessions', 'campaigns', 'assets', 'versions',
      'jobs', 'ledger', 'uploads', 'billing_accounts', 'payment_events',
      'provider_spend', 'writing_daily_usage', 'rate_limit_buckets'
    ] LOOP
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target_schema, table_name);
      EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC, anon, authenticated, service_role', target_schema, table_name);
      EXECUTE format('REVOKE ALL ON %I.%I FROM %I', target_schema, table_name, runtime_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO %I', target_schema, table_name, runtime_role);
      EXECUTE format('DROP POLICY IF EXISTS inkshot_server_runtime ON %I.%I', target_schema, table_name);
      -- Workspace ownership is enforced by the server. This role is for direct
      -- server connections only, never browser JWTs or authenticated API users.
      EXECUTE format('CREATE POLICY inkshot_server_runtime ON %I.%I TO %I USING (true) WITH CHECK (true)', target_schema, table_name, runtime_role);
    END LOOP;
    EXECUTE format('REVOKE ALL ON %I.inkshot_environment FROM PUBLIC, anon, authenticated, service_role, %I', target_schema, runtime_role);
    EXECUTE format('GRANT SELECT ON %I.inkshot_environment TO %I', target_schema, runtime_role);
    EXECUTE format('DROP POLICY IF EXISTS inkshot_runtime_marker_read ON %I.inkshot_environment', target_schema);
    EXECUTE format('CREATE POLICY inkshot_runtime_marker_read ON %I.inkshot_environment FOR SELECT TO %I USING (true)', target_schema, runtime_role);
  END LOOP;
  -- Preserve Supabase's automatic RLS event trigger while removing its public
  -- execution grants. No function is dropped or replaced.
  IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable' AND p.pronargs=0
      AND p.prorettype='event_trigger'::regtype) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $runtime$;
COMMIT;
