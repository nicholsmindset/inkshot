CREATE TABLE IF NOT EXISTS workspaces (
 id text PRIMARY KEY, brand jsonb NOT NULL DEFAULT '{}', credits integer NOT NULL DEFAULT 0 CHECK(credits>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL, demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns (
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),name text NOT NULL,goal text NOT NULL,offer text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'draft',concepts jsonb NOT NULL,brand jsonb NOT NULL,mock boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assets (
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),campaign_id text NOT NULL REFERENCES campaigns(id),kind text NOT NULL,title text NOT NULL,format text NOT NULL,caption text NOT NULL DEFAULT '',current_version_id text
);
CREATE TABLE IF NOT EXISTS versions (
 id text PRIMARY KEY,asset_id text NOT NULL REFERENCES assets(id),workspace_id text NOT NULL REFERENCES workspaces(id),n integer NOT NULL,status text NOT NULL DEFAULT 'queued',prompt text NOT NULL,headline text NOT NULL,cta text NOT NULL,note text NOT NULL DEFAULT '',credit_cost integer NOT NULL DEFAULT 0,mock boolean NOT NULL,source_path text,file_path text,preview_path text,error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(asset_id,n)
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY,version_id text NOT NULL UNIQUE REFERENCES versions(id),workspace_id text NOT NULL REFERENCES workspaces(id),state text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,checkpoint jsonb NOT NULL DEFAULT '{}',available_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),amount integer NOT NULL,kind text NOT NULL,description text NOT NULL,event_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),file_path text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(state,available_at);
CREATE INDEX IF NOT EXISTS campaigns_workspace ON campaigns(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS versions_workspace ON versions(workspace_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS billing_accounts (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id), customer_id text UNIQUE, subscription_id text UNIQUE, status text NOT NULL DEFAULT 'none', checkout_id text, last_event_created bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_events (id text PRIMARY KEY,type text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS provider_spend(request_key text PRIMARY KEY,input_hash text NOT NULL,usd numeric(12,6) NOT NULL CHECK(usd>0),created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE provider_spend ADD COLUMN IF NOT EXISTS provider_request_id text;

ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS last_allowance_invoice_created bigint NOT NULL DEFAULT 0;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS spend_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS spend_block_reason text;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 10485760 CHECK(size_bytes>=0);
ALTER TABLE versions ADD COLUMN IF NOT EXISTS review_fingerprint text;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS writing_daily_usage (
  usage_day date NOT NULL,
  scope text NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (usage_day, scope)
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS draft jsonb;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS motion_prompt text;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  hits integer NOT NULL CHECK (hits >= 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry ON rate_limit_buckets(expires_at);

ALTER TABLE versions ADD COLUMN IF NOT EXISTS video_duration_seconds integer NOT NULL DEFAULT 15 CHECK(video_duration_seconds BETWEEN 3 AND 15);
ALTER TABLE versions ADD COLUMN IF NOT EXISTS first_frame_source text CHECK(first_frame_source IN ('merchant_photo','generated','sample'));
CREATE TABLE IF NOT EXISTS provider_events (
  webhook_id text PRIMARY KEY, request_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('completed','failed','nsfw')),
  expires_at timestamptz, body_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), matched_at timestamptz
);
CREATE INDEX IF NOT EXISTS provider_events_request ON provider_events(request_id);
CREATE INDEX IF NOT EXISTS provider_events_unmatched ON provider_events(request_id) WHERE matched_at IS NULL;
CREATE INDEX IF NOT EXISTS provider_spend_receipt ON provider_spend(provider_request_id) WHERE provider_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS campaign_exports (
 id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),campaign_id text NOT NULL REFERENCES campaigns(id),
 category text NOT NULL CHECK(category IN ('all','video','image','post')),fingerprint text NOT NULL,manifest jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','ready','failed')),file_path text,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,campaign_id,category,fingerprint)
);
CREATE INDEX IF NOT EXISTS campaign_exports_ready ON campaign_exports(state,available_at);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
CREATE TABLE IF NOT EXISTS account_deletions (
 id text PRIMARY KEY, workspace_id text NOT NULL UNIQUE, user_id text,
 user_hash text NOT NULL UNIQUE, managed_auth boolean NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','deleting','complete')),
 provider_ids jsonb NOT NULL DEFAULT '[]', provider_deleted jsonb NOT NULL DEFAULT '[]', provider_done boolean NOT NULL DEFAULT false,
 storage_done boolean NOT NULL DEFAULT false, auth_done boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, error_code text,
 locked_until timestamptz, available_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE OR REPLACE FUNCTION reject_deleted_workspace_write() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE pending timestamptz;
BEGIN
 SELECT deletion_requested_at INTO pending FROM workspaces WHERE id=NEW.workspace_id FOR SHARE;
 IF pending IS NOT NULL THEN RAISE EXCEPTION 'Workspace deletion is pending' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON users;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON campaigns;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON assets;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON versions;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON versions FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON jobs;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON ledger;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON ledger FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON uploads;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();
DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON billing_accounts;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON billing_accounts FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();

DROP TRIGGER IF EXISTS reject_deleted_workspace_write ON campaign_exports;
CREATE TRIGGER reject_deleted_workspace_write BEFORE INSERT OR UPDATE ON campaign_exports FOR EACH ROW EXECUTE FUNCTION reject_deleted_workspace_write();

CREATE TABLE IF NOT EXISTS invites(id text PRIMARY KEY,code_hash text NOT NULL UNIQUE,label text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,used_at timestamptz,used_email text);
CREATE TABLE IF NOT EXISTS waitlist(id text PRIMARY KEY,email text NOT NULL UNIQUE,business_url text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS product_events(id text PRIMARY KEY,workspace_id text NOT NULL,user_id text,event text NOT NULL,campaign_id text,asset_id text,props jsonb NOT NULL DEFAULT '{}',dedupe_key text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,dedupe_key));
CREATE INDEX IF NOT EXISTS product_events_event_time ON product_events(event,created_at);

CREATE TABLE IF NOT EXISTS campaign_copy(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),campaign_id text NOT NULL REFERENCES campaigns(id),platform text NOT NULL,run integer NOT NULL,status text NOT NULL DEFAULT 'running' CHECK(status IN('running','ready','failed')),result jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(campaign_id,platform,run));
