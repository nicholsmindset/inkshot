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
