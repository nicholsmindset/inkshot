BEGIN;
CREATE TABLE IF NOT EXISTS public.provider_spend(request_key text PRIMARY KEY,input_hash text NOT NULL,usd numeric(12,6) NOT NULL CHECK(usd>0),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.provider_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_spend FROM anon,authenticated;
COMMIT;
