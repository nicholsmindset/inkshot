-- A null receipt on an existing reservation is ambiguous. Never replay it.
ALTER TABLE public.provider_spend ADD COLUMN IF NOT EXISTS provider_request_id text;
