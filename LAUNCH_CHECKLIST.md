# Inkshot launch checklist

Updated 19 November 2026. This is the current release handoff; the October assessment in `PRODUCTION_AUDIT.md` is historical evidence, not a fresh production certification.

## Release being prepared

PR [#27](https://github.com/nicholsmindset/inkshot/pull/27) adds a sourced brand brief, six angles with three selected, nine editable prompts, saved drafts and exact-revision generation approval. It also improves the dashboard, library filters and revision feedback. Track remaining work in [#26](https://github.com/nicholsmindset/inkshot/issues/26).

The existing 15-second video product and credit prices remain unchanged. Preview deployments and sample generation do not prove paid fulfillment.

## Deployment order

1. Use the owner's new, dedicated Inkshot project `zdvniqffhiycyxxzchmi`. On 19 November the owner authorised starting fresh there; its schema and private buckets have been provisioned. The former project `smpdzhxydnctiyjqojmp` was not modified, and no users, balances or files were copied. See `docs/FRESH_SUPABASE_SETUP.md` for migration records and remaining setup.
2. Keep the new project in sandbox/mock mode during hosted acceptance. Its runtime role is intentionally `NOLOGIN` until a credential is provisioned through a secure channel. Configure the new project URL, publishable key, server secret, scoped database connection and Auth callbacks together; do not mix credentials with the former project.
3. Verify the columns below and runtime-role grants before deploying the branch. Both PR #27 migrations are already applied to the new project's `public` namespace. No `inkshot_live` schema is required for this separate project. Restore Vercel access before changing the app's environment; the connected Vercel tool still cannot find the existing Inkshot project.
4. Review passing checks for the final PR commit, deploy the matching version to a preview, and check email confirmation, returning login, password recovery, saved drafts, private downloads and workspace isolation. Supabase Auth confirmation template, redirect URLs and email delivery still require configuration/verification.
5. Keep live checkout closed until funded writing, hosted media delivery and signed Stripe fulfillment pass their acceptance checks. Binding a project to live mode and updating the production app require a separate reviewed cutover. Do not mix disposable paid-acceptance data with live balances.

Read-only migration verification:

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'inkshot_live')
  AND ((table_name = 'campaigns' AND column_name = 'draft')
    OR (table_name = 'versions' AND column_name = 'motion_prompt'))
ORDER BY table_schema, table_name;
```

Expect `draft` as `jsonb` and `motion_prompt` as `text` in each provisioned namespace. Check as an administrator; a scoped runtime role is intentionally unable to inspect the other environment's tables.

## Account journey release checks

Vercel builds run `scripts/check-hosted-build.ts` before compiling the frontend. Missing Auth, database or private-storage configuration must fail the build instead of publishing a login form backed by an unavailable API. Configure Preview and Production independently. Passing this check proves configuration shape, not valid credentials or database connectivity.

For each served origin, set `APP_ORIGIN` to its exact HTTPS origin and allow its `/api/auth/callback` and `/api/auth/recovery-callback` URLs in that project's Supabase Auth configuration. A confirmation started on a preview cannot rely on a verifier cookie on a different production hostname. Do not copy live payment credentials into a preview to make its checks pass.

The dedicated `confirmed-auth-journey` CI job requires email confirmation using a disposable Supabase server and captured local mailbox. It checks signup, blocked login before confirmation, callback website continuation, first login, signout, returning login to the same workspace, incorrect passwords and single-use password recovery. Chrome checks also cover form state, a late anonymous response after signup and a failed signout followed by a successful retry.

Hosted startup failures emit only a safe stage/configuration code and customer reference. Match the reference in Vercel runtime logs to distinguish missing configuration, database access and application startup failures. Do not diagnose a customer's password from a generic service failure, or call the hosted issue resolved from local tests alone.

### Database schema readiness

Hosted database initialization checks the runtime schema after verifying the project/environment binding and before constructing the app. It checks `campaigns.draft` (`jsonb`), `versions.motion_prompt` (`text`) and the three shared rate-limit columns. The check is read-only, uses the runtime role/search path, and refuses to substitute sandbox tables for missing live tables. Missing or incompatible fields prevent startup; failed initialization closes its connection pool and can retry after the operator fixes the schema.

- `stage=database`, `code=SCHEMA_CAMPAIGN_PLANNING_REQUIRED`: verify and apply `20261119090000_campaign_planning.sql` in the intended namespaces.
- `stage=database`, `code=SCHEMA_SHARED_RATE_LIMITS_REQUIRED`: verify and apply `20261119100000_shared_rate_limits.sql` in the intended namespaces.
- If a code persists after migration, check column types and the runtime search path. Additive migrations do not repair an existing column of the wrong type; investigate before changing data.

Customers receive only the existing unavailable response and support reference, never SQL/schema details. This check is not a migration runner or a full database audit. It does not prove provider funding, email delivery or paid fulfillment. No additional migration is needed for the guard itself.

### Confirmation recovery and abuse controls

- Copy `supabase/templates/confirmation.html` into the hosted Supabase **Confirm signup** email template. It preserves the existing confirmation link and adds `{{ .Token }}` for code entry from another browser/device. Verify the sender and inbox delivery before inviting customers. The code feature cannot be called ready until the deployed template includes the code.
- Signup and login expose resend and existing-code entry. Resend returns the same receipt for unknown, confirmed and waiting addresses. Editing the signup email starts a new signup; it does not update another account.
- Verification accepts the latest code once through Supabase, then provisions the verified identity. Email codes never appear in query strings or application logs. Existing confirmation links and password recovery retain their original browser-bound PKCE flow; cross-device password recovery is not part of this change.
- All app, auth and website-read counters use PostgreSQL across instances. Additional normalized-address limits allow one resend per minute and ten verification attempts per 15 minutes. A storage failure blocks the request; there is no memory fallback. Keys are hashed and expired counters are removed in bounded batches.
- On Vercel, only the platform-overwritten single `x-vercel-forwarded-for` IP is used. Outside Vercel, forwarding headers are ignored. IPv6 callers are grouped by subnet. Verify this against hosted traffic before launch; other reverse proxies need an explicit trusted-proxy configuration.

### Remaining launch and growth work

- Keep public indexing disabled until the canonical production origin and public pages are approved. The current `vercel.json` sends `noindex, nofollow` site-wide. When opening marketing pages, keep studio, auth and preview pages excluded; verify served headers as well as page metadata.
- Confirm a support address you control. Do not publish `hello@inkshot.com` as a working contact until ownership and delivery are verified.
- Add production alerts for startup failures, Stripe delivery failures and stuck generation jobs. Existing safe diagnostic logs do not establish that alert routing is configured.
- Add a minimal conversion funnel (signup, verified account, saved brief, approved campaign, checkout, completed download) after choosing the analytics destination and privacy settings. This release does not install tracking or send customer data to a new vendor.

## Paid acceptance evidence

- Funded writing: read an owned public website, review the extracted facts and inferred suggestions, select three angles and save nine prompts. Confirm evidence excerpts match the source and unsupported claims are absent.
- Capped generation: approve the saved revision, then verify all three videos, three image ads and three posts. Confirm submitted first-frame and motion prompts match the saved approval, media is stored privately and the downloaded output matches its preview.
- Recovery: confirm retries reuse a provider request identity, failed assets receive the intended credit refund once, and a new deliberate generation is separately priced. Reconcile provider reservations against actual provider charges; estimates are not invoices.
- Billing: verify the intended live account/catalogue/webhook configuration read-only, test payment lifecycle cases in Stripe sandbox, then verify the first approved genuine live transaction and signed credit fulfillment. No test card should be used in live mode.
- Operations: check password recovery delivery, private object backup/restore, support contact, cancellation/refund terms and alerts for failed billing delivery or stuck jobs. Historical check results must be revalidated against the deployed configuration.

`scripts/check-live-stripe.ts` checks configuration without creating a payment. `scripts/verify-live-kit.ts` can incur provider spend and uses a local verification database; even a passing run does not replace hosted acceptance. Supply credentials through the established secret-management workflow, never a chat message or committed file.

Provider receipt recovery follows [Higgsfield's idempotency contract](https://docs.higgsfield.ai/docs/concepts/idempotency): replay the unchanged request with the original key, then poll the recovered request ID. Inkshot rejects changed inputs and leaves unresolved reservations from an earlier budget day for reconciliation. A replay is not a new creative revision.

## Saved access and spending decisions

- Supabase access is restored for the new project `zdvniqffhiycyxxzchmi`; the owner authorised provisioning it fresh. Access to the former project remains unavailable and is not needed for this fresh setup.
- Current Vercel connector discovery does not expose Inkshot projects. GitHub-created preview checks are visible, but that is not permission to edit the production project's configuration.
- A capped funded provider run and live transaction still need an explicit amount/account decision. Continue code, tests and sandbox verification independently while these are pending.


## Operations monitoring (P1-2)

- `GET /api/ops/status` requires the exact `Authorization: Bearer <CRON_SECRET>` header. Missing secrets, wrong tokens and non-GET calls fail closed. Never put the token in the URL. Responses are `no-store` and contain setting-presence booleans only, database reachability, counts of queued/processing jobs older than 15 minutes, and seconds since the latest locally processed Stripe event. A missing event is `null`, not zero. Presence does not validate a setting's value, provider funding, or email delivery.
- The hosted catch-all handles this endpoint before app initialization, so operators can still diagnose missing configuration or database failures. A database/schema connection failure or stuck jobs returns 503. A healthy probe returns 200; optional provider settings may still be absent while payments are off. The DB queries use a five-second statement timeout. An unreachable database reports unavailable metrics as `null`.
- `OPS_ALERTS_ENABLED=true` emits allowlisted structured JSON alerts for `inkshot_service_unavailable`, `inkshot_worker_failed`, `inkshot_stripe_webhook_failed`, and `inkshot_jobs_stuck`. The flag defaults off. Payloads contain event name, random reference and optional aggregate count only. They contain no error messages, stack traces, prompts, raw Stripe bodies, credentials or customer identifiers. Startup alerts retain the customer's diagnostic reference.
- The existing cron checks stuck work after draining jobs; an external monitor should poll the protected endpoint every minute as well, because a cron that never runs cannot report itself. Preview cron execution must not be assumed.
- **Owner decision pending:** select a log-drain/alert destination and configure delivery for `alert=true`; deduplicate repeated event types over a five-minute window. No new monitoring vendor, drain or paid plan has been created. Failure events are emitted synchronously in tests, but actual alert delivery within five minutes is not yet verified.
- Hosted acceptance: force a failure only in a disposable preview, verify the protected response and a notification at the chosen destination within five minutes, restore the configuration, then verify recovery. Check unauthorized probes return no settings or metrics. Keep payments and paid generation off throughout.
- No database migration is needed for this change; status reads the existing runtime schema, including shared live search-path isolation.
