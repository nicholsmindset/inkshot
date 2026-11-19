-- Shared abuse counters. Apply before deploying the shared rate-limit store.
BEGIN;
DO $migration$
DECLARE
  target_schema text;
  runtime_role text;
  denied_role text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'inkshot_live'] LOOP
    -- Do not create a new live namespace as a side effect of this migration.
    IF to_regclass(format('%I.workspaces', target_schema)) IS NULL THEN CONTINUE; END IF;
    runtime_role := CASE WHEN target_schema = 'public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.rate_limit_buckets (
      bucket_key text PRIMARY KEY, hits integer NOT NULL CHECK (hits >= 0), expires_at timestamptz NOT NULL
    )', target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry ON %I.rate_limit_buckets(expires_at)', target_schema);
    EXECUTE format('ALTER TABLE %I.rate_limit_buckets ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON %I.rate_limit_buckets FROM PUBLIC', target_schema);
    FOREACH denied_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inkshot_app', 'inkshot_live_app'] LOOP
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = denied_role) THEN
        EXECUTE format('REVOKE ALL ON %I.rate_limit_buckets FROM %I', target_schema, denied_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.rate_limit_buckets TO %I', target_schema, runtime_role);
      EXECUTE format('DROP POLICY IF EXISTS rate_limit_runtime ON %I.rate_limit_buckets', target_schema);
      EXECUTE format('CREATE POLICY rate_limit_runtime ON %I.rate_limit_buckets TO %I USING (true) WITH CHECK (true)', target_schema, runtime_role);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
