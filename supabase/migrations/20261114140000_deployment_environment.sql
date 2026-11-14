BEGIN;
CREATE TABLE public.inkshot_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL CHECK (mode IN ('sandbox','live')),
  project_ref text,
  CHECK ((mode = 'sandbox' AND project_ref IS NULL) OR
         (mode = 'live' AND project_ref IS NOT NULL AND project_ref ~ '^[a-z0-9]{20}$'))
);
INSERT INTO public.inkshot_environment(mode) VALUES ('sandbox');
ALTER TABLE public.inkshot_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inkshot_environment FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'inkshot_app') THEN
    REVOKE ALL ON public.inkshot_environment FROM inkshot_app;
    GRANT SELECT ON public.inkshot_environment TO inkshot_app;
  END IF;
END $$;
CREATE POLICY inkshot_environment_read ON public.inkshot_environment FOR SELECT TO PUBLIC USING (true);
COMMIT;
