-- Run once on a NEW, otherwise unused Supabase project, before pointing any app at it.
-- Usage: psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v project_ref=abcdefghijklmnopqrst -f scripts/bind-live-project.sql
BEGIN;
LOCK TABLE public.inkshot_environment, public.workspaces, public.payment_events,
  public.provider_spend, auth.users, storage.objects IN SHARE ROW EXCLUSIVE MODE;
SELECT set_config('inkshot.setup_project_ref', :'project_ref', true);
DO $$
DECLARE
  ref text := current_setting('inkshot.setup_project_ref');
BEGIN
  IF ref !~ '^[a-z0-9]{20}$' OR ref = 'smpdzhxydnctiyjqojmp' THEN
    RAISE EXCEPTION 'Expected a fresh live Supabase project reference';
  END IF;
  IF EXISTS (SELECT FROM public.inkshot_environment WHERE mode='live' AND project_ref=ref) THEN RETURN; END IF;
  IF EXISTS (SELECT FROM public.workspaces) OR EXISTS (SELECT FROM public.payment_events)
     OR EXISTS (SELECT FROM public.provider_spend) OR EXISTS (SELECT FROM auth.users)
     OR EXISTS (SELECT FROM storage.objects) THEN
    RAISE EXCEPTION 'Refusing to bind a populated project to live billing';
  END IF;
  UPDATE public.inkshot_environment SET mode='live',project_ref=ref WHERE mode='sandbox';
  IF NOT FOUND THEN RAISE EXCEPTION 'Project has no sandbox marker or is already bound to a different live project'; END IF;
END $$;
COMMIT;
