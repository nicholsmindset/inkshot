-- Additive upgrade for both existing namespaces. No customer rows are copied.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS draft jsonb;
ALTER TABLE public.versions ADD COLUMN IF NOT EXISTS motion_prompt text;
DO $$ BEGIN
  IF to_regclass('inkshot_live.campaigns') IS NOT NULL THEN
    ALTER TABLE inkshot_live.campaigns ADD COLUMN IF NOT EXISTS draft jsonb;
    ALTER TABLE inkshot_live.versions ADD COLUMN IF NOT EXISTS motion_prompt text;
  END IF;
END $$;
