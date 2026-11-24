-- Pilot measurement. Additive; written only by the server, never readable by browser roles.
-- Events hold no website text, prompts or file contents (see the privacy page).
BEGIN;
DO $migration$
DECLARE
  target_schema text;
  runtime_role text;
  denied_role text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'inkshot_live'] LOOP
    IF to_regclass(format('%I.workspaces', target_schema)) IS NULL THEN CONTINUE; END IF;
    runtime_role := CASE WHEN target_schema = 'public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.product_events (
      id text PRIMARY KEY, workspace_id text NOT NULL, user_id text, event text NOT NULL,
      campaign_id text, asset_id text, props jsonb NOT NULL DEFAULT ''{}'',
      dedupe_key text, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, dedupe_key))', target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS product_events_event_time ON %I.product_events(event, created_at)', target_schema);
    EXECUTE format('ALTER TABLE %I.product_events ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON %I.product_events FROM PUBLIC', target_schema);
    FOREACH denied_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inkshot_app', 'inkshot_live_app'] LOOP
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = denied_role) THEN
        EXECUTE format('REVOKE ALL ON %I.product_events FROM %I', target_schema, denied_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.product_events TO %I', target_schema, runtime_role);
      EXECUTE format('DROP POLICY IF EXISTS product_events_runtime ON %I.product_events', target_schema);
      EXECUTE format('CREATE POLICY product_events_runtime ON %I.product_events TO %I USING (true) WITH CHECK (true)', target_schema, runtime_role);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
