-- Durable signed-webhook receipts. Contains no prompts, URLs or raw bodies.
BEGIN;
DO $migration$
DECLARE target_schema text; runtime_role text; denied_role text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public','inkshot_live'] LOOP
    IF to_regclass(format('%I.workspaces',target_schema)) IS NULL THEN CONTINUE; END IF;
    runtime_role := CASE WHEN target_schema='public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.provider_events (
      webhook_id text PRIMARY KEY, request_id text NOT NULL,
      status text NOT NULL CHECK(status IN (''completed'',''failed'',''nsfw'')),
      expires_at timestamptz, body_hash text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(), matched_at timestamptz
    )',target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS provider_events_request ON %I.provider_events(request_id)',target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS provider_events_unmatched ON %I.provider_events(request_id) WHERE matched_at IS NULL',target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS provider_spend_receipt ON %I.provider_spend(provider_request_id) WHERE provider_request_id IS NOT NULL',target_schema);
    EXECUTE format('ALTER TABLE %I.provider_events ENABLE ROW LEVEL SECURITY',target_schema);
    EXECUTE format('REVOKE ALL ON %I.provider_events FROM PUBLIC',target_schema);
    FOREACH denied_role IN ARRAY ARRAY['anon','authenticated','service_role','inkshot_app','inkshot_live_app'] LOOP
      IF EXISTS(SELECT FROM pg_roles WHERE rolname=denied_role) THEN
        EXECUTE format('REVOKE ALL ON %I.provider_events FROM %I',target_schema,denied_role);
      END IF;
    END LOOP;
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=runtime_role) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I.provider_events TO %I',target_schema,runtime_role);
      EXECUTE format('DROP POLICY IF EXISTS provider_event_runtime ON %I.provider_events',target_schema);
      EXECUTE format('CREATE POLICY provider_event_runtime ON %I.provider_events TO %I USING(true) WITH CHECK(true)',target_schema,runtime_role);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
