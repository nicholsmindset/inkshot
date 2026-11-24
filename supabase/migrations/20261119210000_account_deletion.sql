BEGIN;
DO $migration$
DECLARE target_schema text; runtime_role text; denied_role text; table_name text;
BEGIN
 FOREACH target_schema IN ARRAY ARRAY['public','inkshot_live'] LOOP
  IF to_regclass(format('%I.workspaces',target_schema)) IS NULL THEN CONTINUE; END IF;
  runtime_role:=CASE WHEN target_schema='public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
  EXECUTE format('ALTER TABLE %I.workspaces ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz',target_schema);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.account_deletions (
 id text PRIMARY KEY, workspace_id text NOT NULL UNIQUE, user_id text,
 user_hash text NOT NULL UNIQUE, managed_auth boolean NOT NULL,
 state text NOT NULL DEFAULT ''pending'' CHECK(state IN (''pending'',''deleting'',''complete'')),
 provider_ids jsonb NOT NULL DEFAULT ''[]'', provider_deleted jsonb NOT NULL DEFAULT ''[]'', provider_done boolean NOT NULL DEFAULT false,
 storage_done boolean NOT NULL DEFAULT false, auth_done boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, error_code text,
 locked_until timestamptz, available_at timestamptz NOT NULL DEFAULT now()+interval ''15 minutes'',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
)',target_schema);
  EXECUTE format('ALTER TABLE %I.account_deletions ENABLE ROW LEVEL SECURITY',target_schema);
  EXECUTE format('REVOKE ALL ON %I.account_deletions FROM PUBLIC',target_schema);
  FOREACH denied_role IN ARRAY ARRAY['anon','authenticated','service_role','inkshot_app','inkshot_live_app'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=denied_role) THEN EXECUTE format('REVOKE ALL ON %I.account_deletions FROM %I',target_schema,denied_role); END IF;
  END LOOP;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=runtime_role) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I.account_deletions TO %I',target_schema,runtime_role);
   EXECUTE format('DROP POLICY IF EXISTS deletion_runtime ON %I.account_deletions',target_schema);
   EXECUTE format('CREATE POLICY deletion_runtime ON %I.account_deletions TO %I USING(true) WITH CHECK(true)',target_schema,runtime_role);
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %I.reject_deleted_workspace_write() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
   DECLARE pending timestamptz;
   BEGIN
    SELECT deletion_requested_at INTO pending FROM %I.workspaces WHERE id=NEW.workspace_id FOR SHARE;
    IF pending IS NOT NULL THEN RAISE EXCEPTION ''Workspace deletion is pending'' USING ERRCODE=''55000''; END IF;
    RETURN NEW;
   END $body$',target_schema,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.reject_deleted_workspace_write() FROM PUBLIC',target_schema);
  FOREACH table_name IN ARRAY ARRAY['users','campaigns','assets','versions','jobs','ledger','uploads','billing_accounts','campaign_exports'] LOOP
   IF to_regclass(format('%I.%I',target_schema,table_name)) IS NULL THEN CONTINUE; END IF;
   EXECUTE format('DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON %I.%I',target_schema,table_name);
   EXECUTE format('CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.reject_deleted_workspace_write()',target_schema,table_name,target_schema);
  END LOOP;
 END LOOP;
END $migration$;
COMMIT;
