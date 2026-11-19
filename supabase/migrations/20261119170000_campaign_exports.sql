BEGIN;
DO $exports$
DECLARE ns text; runtime_role text;
BEGIN
 FOREACH ns IN ARRAY ARRAY['public','inkshot_live'] LOOP
  IF to_regclass(format('%I.workspaces',ns)) IS NULL THEN CONTINUE; END IF;
  runtime_role:=CASE WHEN ns='public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I.campaign_exports (
   id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES %1$I.workspaces(id),campaign_id text NOT NULL REFERENCES %1$I.campaigns(id),
   category text NOT NULL CHECK(category IN ('all','video','image','post')),fingerprint text NOT NULL,manifest jsonb NOT NULL,
   state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','ready','failed')),file_path text,
   attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(workspace_id,campaign_id,category,fingerprint))$ddl$,ns);
  EXECUTE format('CREATE INDEX IF NOT EXISTS campaign_exports_ready ON %I.campaign_exports(state,available_at)',ns);
  EXECUTE format('ALTER TABLE %I.campaign_exports ENABLE ROW LEVEL SECURITY',ns);
  EXECUTE format('REVOKE ALL ON %I.campaign_exports FROM PUBLIC,anon,authenticated,service_role',ns);
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=runtime_role) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I.campaign_exports TO %I',ns,runtime_role);
   EXECUTE format('DROP POLICY IF EXISTS inkshot_server_runtime ON %I.campaign_exports',ns);
   EXECUTE format('CREATE POLICY inkshot_server_runtime ON %I.campaign_exports TO %I USING(true) WITH CHECK(true)',ns,runtime_role);
  END IF;
 END LOOP;
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  UPDATE storage.buckets SET allowed_mime_types=array_append(allowed_mime_types,'application/zip')
    WHERE id IN ('generated-media','inkshot-live-generated-media') AND allowed_mime_types IS NOT NULL
      AND NOT ('application/zip'=ANY(allowed_mime_types));
 END IF;
END $exports$;
COMMIT;
