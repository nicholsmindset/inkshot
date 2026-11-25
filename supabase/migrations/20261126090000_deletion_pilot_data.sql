-- Account deletion must be able to erase pilot measurement and waitlist data. Additive grants only.
BEGIN;
DO $migration$
DECLARE
  target_schema text;
  runtime_role text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'inkshot_live'] LOOP
    runtime_role := CASE WHEN target_schema = 'public' THEN 'inkshot_app' ELSE 'inkshot_live_app' END;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_role) THEN CONTINUE; END IF;
    IF to_regclass(format('%I.product_events', target_schema)) IS NOT NULL THEN
      EXECUTE format('GRANT DELETE ON %I.product_events TO %I', target_schema, runtime_role);
    END IF;
    IF to_regclass(format('%I.waitlist', target_schema)) IS NOT NULL THEN
      EXECUTE format('GRANT DELETE ON %I.waitlist TO %I', target_schema, runtime_role);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
