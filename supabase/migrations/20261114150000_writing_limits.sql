BEGIN;
CREATE TABLE IF NOT EXISTS public.writing_daily_usage (
  usage_day date NOT NULL,
  scope text NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (usage_day, scope)
);
ALTER TABLE public.writing_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.writing_daily_usage FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'inkshot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.writing_daily_usage TO inkshot_app;
    CREATE POLICY inkshot_app_writing_usage ON public.writing_daily_usage TO inkshot_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
