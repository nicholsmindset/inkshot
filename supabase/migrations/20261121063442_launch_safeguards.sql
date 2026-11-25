-- Additive safeguards. Legacy upload bytes are deliberately charged at the old
-- per-file ceiling until an operator can inventory them without undercounting.
DO $$
DECLARE scope text;
BEGIN
  FOREACH scope IN ARRAY ARRAY['public','inkshot_live'] LOOP
    IF to_regclass(format('%I.billing_accounts',scope)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.billing_accounts ADD COLUMN IF NOT EXISTS spend_blocked boolean NOT NULL DEFAULT false',scope);
      EXECUTE format('ALTER TABLE %I.billing_accounts ADD COLUMN IF NOT EXISTS spend_block_reason text',scope);
      EXECUTE format('ALTER TABLE %I.uploads ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 10485760 CHECK(size_bytes>=0)',scope);
      EXECUTE format('ALTER TABLE %I.versions ADD COLUMN IF NOT EXISTS review_fingerprint text',scope);
      EXECUTE format('ALTER TABLE %I.versions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz',scope);
    END IF;
  END LOOP;
END $$;
