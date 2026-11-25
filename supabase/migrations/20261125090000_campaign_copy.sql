-- Platform copy (Facebook, Instagram, TikTok, ...). Additive; written only by the server.
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
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.campaign_copy (
      id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES %I.workspaces(id),
      campaign_id text NOT NULL REFERENCES %I.campaigns(id), platform text NOT NULL, run integer NOT NULL,
      status text NOT NULL DEFAULT ''running'' CHECK (status IN (''running'',''ready'',''failed'')),
      result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (campaign_id, platform, run))', target_schema, target_schema, target_schema);
    -- Late writes into a workspace being deleted are rejected, like the other application tables.
    IF to_regprocedure(format('%I.reject_deleted_workspace_write()', target_schema)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON %I.campaign_copy', target_schema);
      EXECUTE format('CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON %I.campaign_copy FOR EACH ROW EXECUTE FUNCTION %I.reject_deleted_workspace_write()', target_schema, target_schema);
    END IF;
    EXECUTE format('ALTER TABLE %I.campaign_copy ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON %I.campaign_copy FROM PUBLIC', target_schema);
    FOREACH denied_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'inkshot_app', 'inkshot_live_app'] LOOP
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = denied_role) THEN
        EXECUTE format('REVOKE ALL ON %I.campaign_copy FROM %I', target_schema, denied_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.campaign_copy TO %I', target_schema, runtime_role);
      EXECUTE format('DROP POLICY IF EXISTS campaign_copy_runtime ON %I.campaign_copy', target_schema);
      EXECUTE format('CREATE POLICY campaign_copy_runtime ON %I.campaign_copy TO %I USING (true) WITH CHECK (true)', target_schema, runtime_role);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
