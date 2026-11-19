# Separate live project: owner cutover runbook

Prepared 19 November 2026. This document authorises no deployment, purchase, secret creation, migration application or payment. Keep checkout off until the release gates below are met.

## Current verified position

- GitHub repository: `nicholsmindset/inkshot`.
- Vercel project: `inkshot-live`, team `nicholsmindset-gmailcoms-projects`, Pro shown in the dashboard.
- Current public hostname: `https://inkshot-live.vercel.app`.
- Latest inspected production commit: `d09e537` on 19 November. Recheck at cutover.
- New Supabase project: `zdvniqffhiycyxxzchmi`, Singapore region, provisioned with a sandbox marker. It is currently intended for mock preview acceptance. Do not assume it is empty now: the owner may have finished setup or created accounts since the last inspection.
- Former Supabase project `smpdzhxydnctiyjqojmp` is not being migrated or modified. Its accounts, balances and media have not been transferred.
- Preview settings were saved only for `inkshot/fresh-project-setup`; new branches do not automatically inherit branch-specific values. Configure each reviewed preview explicitly. Credentials must match its project, not the old database or production.

## 1. Choose the live target before running tests

Keep a separate Supabase project for mock acceptance and a clean project for live. Creating another project can incur charges and requires the owner's choice. If retaining `zdvniqffhiycyxxzchmi` as live, first inspect Auth users, workspaces, payment events, provider spend and storage objects. If any exist, stop: `scripts/bind-live-project.sql` deliberately refuses populated targets. Do not erase records or change the marker manually to bypass it. Decide whether to preserve this project as sandbox and provision a clean live target instead.

Store the chosen project reference, region, canonical app origin and Vercel project in the release record. Record identifiers, never secrets.

## 2. Validate the reviewed code in sandbox

1. Review the entire stacked PR chain and record the exact head commit. Do not deploy a parent branch by mistake.
2. Run all unit/integration tests, TypeScript and the production build with mock providers. Verify GitHub checks at that exact commit.
3. Apply reviewed migrations to disposable acceptance infrastructure first. Check runtime privileges, private buckets, environment binding and schema readiness. Both `public` and `inkshot_live` paths must pass tests even when the chosen live project uses only `public`.
4. Configure a preview with `GENERATION_MODE=mock`, `ALLOW_LIVE_GENERATION=false`, `BILLING_MODE=off`, `ENABLE_BILLING_SANDBOX=false`, `ENABLE_LIVE_CHECKOUT=false` and `INKSHOT_SHARED_PROJECT_LIVE=false`. Use its own `APP_ORIGIN`, Supabase keys, scoped DB login and cron secret.
5. Configure the exact Auth callback and recovery callback for that preview; apply the confirmation template. Verify actual delivery with an owned account, plus confirmation, returning login, recovery, signout, two-workspace isolation, saved brief, approved prompts, nine mock assets and private exports.
6. Verify `/api/ops/status` requires the cron bearer secret. Select an alert destination, enable structured alert routing and prove a forced preview failure arrives within five minutes. Restore healthy operation afterwards.

Local/CI results alone do not satisfy hosted acceptance. Vercel preview cron execution must not be assumed; invoke its authenticated worker through the authorised test workflow.

## 3. Prepare the clean live database

Owner/operator action, after backup and target verification:

1. Confirm the project is healthy and empty of user/business data. Record read-only counts and migration history.
2. Apply the reviewed migration set with stop-on-error. The history of the fresh project uses server-assigned versions documented in `FRESH_SUPABASE_SETUP.md`; do not blindly replay source filenames against that project.
3. Run `scripts/bind-live-project.sql` using an administrator connection and the exact new project reference, before any app is pointed at it. The script locks relevant tables and checks emptiness. Re-running against the same already-bound target is safe. A failed guard is an investigation requirement, not permission to bypass it.
4. Provision the scoped `inkshot_app` login securely. Verify no elevated privileges, no role memberships, no schema CREATE, no table TRUNCATE and no write privilege on `inkshot_environment`. Keep the administrator connection out of Vercel runtime variables.
5. Verify all storage buckets are private, runtime schema checks pass and Auth uses the matching project URL and keys. Keep certificate validation enabled on the pooler connection.

Do not switch an existing sandbox database with customer data to live by editing the marker.

## 4. Configure production while access is controlled

Only after owner approval, configure the production environment together:

- Matching `SUPABASE_URL`, publishable key, server key and scoped `DATABASE_URL`.
- Exact canonical `APP_ORIGIN`; Auth site URL and callback/recovery allowlist. Keep preview origins on their separate Auth project.
- `AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, `INKSHOT_SHARED_PROJECT_LIVE=false`.
- Owned sender/support address and reviewed legal pages; do not claim that `hello@inkshot.com` works without domain ownership and inbox verification.
- Separate cron/webhook signing secrets through the secret manager. Verify webhooks against raw bodies; never log signing headers or payloads containing personal data.
- Monitoring flag and destination configured by the owner; verify dispatch, not just logs.

The current application couples live billing mode with live generation mode and binds both to the live database marker. A live-bound database will not start in mock/sandbox mode. Therefore a production cutover is a distinct owner-controlled step, not simply copying the mock preview variables. Keep `ENABLE_LIVE_CHECKOUT=false`. Restrict access during any funded acceptance; a checkout flag alone is not a generation-spend kill switch.

Live provider settings and budgets must be configured only after account funding, model/pricing verification and a capped-spend decision. `scripts/check-live-stripe.ts` is read-only; `scripts/verify-live-kit.ts` can spend money and requires explicit approval.

## 5. Acceptance and opening checkout

Before opening paid subscriptions, record evidence for:

- All hosted account-journey and two-workspace access checks.
- Product-photo video input, approved prompt/duration, private storage, downloads and retry recovery at the reviewed commit.
- One deliberately capped funded provider acceptance. Keep estimates distinct from actual invoice charges.
- Stripe sandbox lifecycle and signed fulfillment checks, then a separately approved genuine live transaction. Never put test cards into live mode.
- Credits, refunds and subscription renewal idempotency; cancellation and deletion behaviour.
- Private storage restoration, support delivery, operational alerts, worker execution and provider timeouts.
- Reviewed customer terms, retention/deletion policy, halal/offer claims controls and pilot pricing.

The owner may then open checkout with the chosen catalogue and verified provider budgets. Any public-indexing change is a separate marketing release: keep auth, studio and preview URLs excluded.

## 6. Incident and rollback rules

1. Close new checkout first if payment fulfillment is unreliable. Preserve signed webhook delivery and reconcile already accepted payments; do not discard payment events.
2. Stop new paid generation through a reviewed application control or access restriction; do not create an invalid live/mock configuration pair or switch the database marker. Let authorised in-flight work be recovered or refunded deliberately.
3. Roll back application code only to a known compatible commit with the current schema. Additive migrations normally stay applied. Never blindly roll back migrations or restore over newer payment/credit records.
4. If data may be lost, pause mutations and reconcile provider requests, Stripe events and the ledger against backups before reopening.
5. Record the incident, affected commit, references and counts without credentials or customer content. Rerun hosted acceptance after recovery.

## Release record

Record code commit, migration versions, target identifiers, environment flags, local/CI checks, hosted checks, approved spend limit, actual outcomes and unresolved owner decisions. A green build, zero advisor findings or a visible homepage alone is not paid-launch approval.
