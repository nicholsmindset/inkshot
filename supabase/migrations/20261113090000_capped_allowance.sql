ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS last_allowance_invoice_created bigint NOT NULL DEFAULT 0;
