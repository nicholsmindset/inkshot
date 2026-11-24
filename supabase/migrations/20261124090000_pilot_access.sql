-- Invite-only pilot access and waitlist. Additive; server-only tables.
BEGIN;
DO $migration$
DECLARE
  target_schema text;
  runtime_role text;
  denied_role text;
  table_name text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'inkshot_live'] LOOP
    IF to_regclass(format('%I.workspaces', target_schema)) IS NULL THEN CONTINUE; END IF;
    runtime_role := CASE WHEN target_schema = 'public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.invites (
      id text PRIMARY KEY, code_hash text NOT NULL UNIQUE, label text NOT NULL DEFAULT '''',
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
      used_at timestamptz, used_email text)', target_schema);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.waitlist (
      id text PRIMARY KEY, email text NOT NULL UNIQUE, business_url text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())', target_schema);
    FOREACH table_name IN ARRAY ARRAY['invites', 'waitlist'] LOOP
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target_schema, table_name);
      EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC', target_schema, table_name);
      FOREACH denied_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inkshot_app', 'inkshot_live_app'] LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = denied_role) THEN
          EXECUTE format('REVOKE ALL ON %I.%I FROM %I', target_schema, table_name, denied_role);
        END IF;
      END LOOP;
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.%I TO %I', target_schema, table_name, runtime_role);
        EXECUTE format('DROP POLICY IF EXISTS pilot_access_runtime ON %I.%I', target_schema, table_name);
        EXECUTE format('CREATE POLICY pilot_access_runtime ON %I.%I TO %I USING (true) WITH CHECK (true)', target_schema, table_name, runtime_role);
      END IF;
    END LOOP;
  END LOOP;
END $migration$;
COMMIT;
