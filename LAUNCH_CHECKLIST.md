# Inkshot launch checklist

Updated 20 November 2026. This is the current release handoff; the October assessment in `PRODUCTION_AUDIT.md` is historical evidence, not a fresh production certification.

## Release gates

Single source of truth. Owner decisions: `docs/OWNER_DECISIONS.md`. Keep `BILLING_MODE=off`, `ENABLE_LIVE_CHECKOUT=false`, `GENERATION_MODE=mock` and `ALLOW_LIVE_GENERATION=false` until the cutover is accepted.

| # | Gate | Owner |
| --- | --- | --- |
| 1 | Hosted journey with a controlled mailbox: signup, delivered confirmation, login, reset, logout, campaign approval, mock generation, owned downloads | Owner |
| 2 | Higgsfield webhook secret/signing and "Exclude data from training" confirmed; capped paid trial (US$30 Higgsfield, US$10 writing) run and rated | Owner approves, engineering runs |
| 3 | Pricing, regeneration cap and refund policy implemented from OWNER_DECISIONS (Stripe test then live prices created) | Engineering, then owner |
| 4 | Operator identity, working support mailbox, reviewed terms/privacy, audited payment-hold release procedure | Owner |
| 5 | Alert destination configured and a test alert received; `charge.refunded` and `charge.dispute.created` added to the existing Stripe endpoint and tested | Owner |
| 6 | Hosted schema, uploads, review gates, deletion isolation, mobile and expiring/large downloads accepted; backup/restore and rollback rehearsed; production startup configuration resolved; separate cutover decision | Both |
| 7 | Monthly cost reconciliation: compare `provider_spend` with the Higgsfield console CSV (manual, owner decision) | Owner |

Cutover steps, rollback and the production preflight are in [docs/CUTOVER.md](docs/CUTOVER.md).

## Migrations added since `main` (apply in this order, each additive and safe in `public` and `inkshot_live`)

1. `20261119143158_inkshot_runtime_access.sql` runtime roles and grants
2. `20261119160000_photo_first_video.sql` video duration and first-frame source
3. `20261119170000_campaign_exports.sql` background ZIP queue
4. `20261119200000_provider_events.sql` signed Higgsfield callbacks
5. `20261119210000_account_deletion.sql` deletion queue and workspace freeze
6. `20261121063442_launch_safeguards.sql` billing holds, upload sizes, review metadata
7. `20261124090000_pilot_access.sql` invites and waitlist (server-only)
8. `20261124100000_product_events.sql` pilot measurement events (server-only)
9. `20261125090000_campaign_copy.sql` platform copy runs (server-only; apply after 6, which installs the deletion trigger function)
10. `20261126090000_deletion_pilot_data.sql` lets account deletion erase measurement events and waitlist entries (apply after 7 and 8)

Migrations 7 to 10 are not covered by the startup schema guard: apply them before deploying, or signup with `PILOT_INVITE_ONLY=true` and event recording will fail (events fail quietly and log a warning).

## Pilot settings (names only)

`PLAN_CURRENCY`, `PLAN_PRICE_AMOUNT` (minor units), `PLAN_CREDITS`, `KIT_CREDITS`, `CREDIT_COST_VIDEO`, `CREDIT_COST_IMAGE`, `CREDIT_COST_POST`, `VIDEO_REGEN_MONTHLY_CAP` (default 8), `PILOT_INVITE_ONLY`, `COPY_PLATFORMS` (default facebook,instagram,tiktok), `COPY_MAX_RUNS_PER_PLATFORM` (default 3), `SUPPORT_EMAIL`. The Stripe price is `STRIPE_STUDIO_PRICE_ID` (alias `PLAN_PRICE_ID`) and must match the currency and amount exactly. Create invites with `npm run invite -- --count 5 --label "cohort 1"`; read results with `npx tsx scripts/pilot-report.ts`.

## Release being prepared

PR [#27](https://github.com/nicholsmindset/inkshot/pull/27) adds a sourced brand brief, six angles with three selected, nine editable prompts, saved drafts and exact-revision generation approval. It also improves the dashboard, library filters and revision feedback. Track remaining work in [#26](https://github.com/nicholsmindset/inkshot/issues/26).

New video requests default to ten seconds; already approved jobs preserve their duration. Credit prices remain unchanged. Preview deployments and sample generation do not prove paid fulfillment.

## Deployment order

1. Use the owner's new, dedicated Inkshot project `zdvniqffhiycyxxzchmi`. On 19 November the owner authorised starting fresh there; its schema and private buckets have been provisioned. The former project `smpdzhxydnctiyjqojmp` was not modified, and no users, balances or files were copied. See `docs/FRESH_SUPABASE_SETUP.md` for migration records and remaining setup.
2. Keep the new project in sandbox/mock mode during hosted acceptance. Its restricted runtime login was securely provisioned on 20 November; the deployed preview passes database startup checks. Configure the new project URL, publishable key, server secret, scoped database connection and Auth callbacks together; do not mix credentials with the former project.
3. Verify the columns below and runtime-role grants before deploying the branch. Both PR #27 migrations are already applied to the new project's `public` namespace. No `inkshot_live` schema is required for this separate project. Vercel access is restored; the integration branch has its own Preview settings. The four subsequent Phase 1 migrations have also been applied to the sandbox.
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
- The hosted catch-all handles this endpoint before app initialization, so operators can still diagnose missing configuration or database failures. A database/schema connection failure or stuck jobs returns 503. A healthy probe returns 200; optional provider settings may still be absent while payments are off. The status request has a 15-second deadline, startup verification queries have a ten-second statement timeout, and metric queries have a five-second timeout. The response deadline does not cancel underlying work; SQL timeouts bound database statements independently. An unreachable database reports unavailable metrics as `null`.
- `OPS_ALERTS_ENABLED=true` emits allowlisted structured JSON alerts for `inkshot_service_unavailable`, `inkshot_worker_failed`, `inkshot_stripe_webhook_failed`, and `inkshot_jobs_stuck`. The flag defaults off. Payloads contain event name, random reference and optional aggregate count only. They contain no error messages, stack traces, prompts, raw Stripe bodies, credentials or customer identifiers. Startup alerts retain the customer's diagnostic reference.
- The existing cron checks stuck work after draining jobs; an external monitor should poll the protected endpoint every minute as well, because a cron that never runs cannot report itself. Preview cron execution must not be assumed.
- **Owner decision pending:** select a log-drain/alert destination and configure delivery for `alert=true`; deduplicate repeated event types over a five-minute window. No new monitoring vendor, drain or paid plan has been created. Failure events are emitted synchronously in tests, but actual alert delivery within five minutes is not yet verified.
- Hosted acceptance: force a failure only in a disposable preview, verify the protected response and a notification at the chosen destination within five minutes, restore the configuration, then verify recovery. Check unauthorized probes return no settings or metrics. Keep payments and paid generation off throughout.
- No database migration is needed for this change; status reads the existing runtime schema, including shared live search-path isolation.
## Product-photo video and approved duration (P1-3)

- Apply `20261119160000_photo_first_video.sql` in the intended database before deploying this branch. It adds `versions.video_duration_seconds` and `versions.first_frame_source` to both provisioned namespaces. Existing versions retain 15 seconds; new drafts default to `VIDEO_DURATION_SECONDS=10`, validated from 3 through 15. Hosted startup refuses a missing/wrong-type column with `SCHEMA_PHOTO_VIDEO_REQUIRED`. No hosted migration was applied during implementation.
- New campaigns freeze duration at creation; saved prompts, approval UI, provider estimate/submission, version revisions and mock rendering use that duration. Changing deployment config affects new campaigns only. Existing prompts without duration retain their previous 15-second contract. Customer generation credits remain unchanged; no unverified cost-saving claim is presented.
- A live video with an approved product photo uses that workspace's private upload as `image_url`; no replacement image is generated. It uses the saved motion prompt. A missing or foreign upload fails closed and returns credits through the existing refund flow. Without a photo, a generated first frame is retained as fallback. Existing jobs already working on a generated first frame continue that path.
- Signed photo links expire after 600 seconds and stay in server-only job checkpoints, never API asset responses or logs. A checkpoint preserves the exact link across ambiguous retries so a budget reservation cannot be reused for changed inputs. If the provider cannot fetch before expiry, the job must fail/recover through the existing retry/refund flow; do not refresh the URL under the same idempotency key. Confirm provider fetch timing in a separately approved capped live acceptance run. Real generation quality and billing are not certified by mocked tests.
- `first_frame_source` records `merchant_photo`, `generated`, or `sample`; text edits preserve that provenance and duration. The preview explains when the approved photo starts the video. Default mock clips now use their approved duration rather than a hard-coded five seconds.
- Current primary reference verified on 19 November 2026: https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference (`image_url`, integer duration 3–15, `sound=off`). The provider account's access and quality remain unverified; no paid API calls were made.
## Signed Higgsfield callbacks (P1-4)

- Apply `20261119200000_provider_events.sql` to each provisioned namespace before enabling `HF_WEBHOOKS_ENABLED=true`. It grants only the matching runtime role access, with RLS; browser roles and the other environment role have no access. No migration is applied automatically at startup.
- Set `HF_WEBHOOK_SECRET` to the existing signing secret revealed by an administrator in Higgsfield Console, and use the final HTTPS `APP_ORIGIN`. The flag defaults off. Do not reveal credentials in chat or client code. Stop/drain outstanding submissions before changing callback settings so an idempotency replay retains its original submission configuration.
- The adapter appends `hf_webhook=<APP_ORIGIN>/api/webhooks/higgsfield` to generation submissions. The raw-body endpoint verifies the Standard Webhooks HMAC, accepts any valid `v1` signature during rotation, and rejects timestamps outside five minutes. Unsigned or malformed deliveries return 400; unavailable durable storage returns 503 so Higgsfield retries.
- A unique `webhook_id` and raw-body hash make duplicate delivery safe. Same ID with changed bytes is rejected. Receipts contain only request ID, terminal status, optional expiry, hash and timestamps: no output URLs, prompts, provider error bodies or raw payloads.
- Webhooks wake queued work only. Active job leases are not interrupted and done/failed jobs are not revived. Early receipts remain unmatched until the worker joins them to the saved provider receipt. The worker still retrieves authenticated provider status and copies media to existing private storage; webhook-supplied media URLs are never fetched directly. Missed callbacks still use existing cron polling.
- `providerOperationsSummary()` returns counts, age of the latest callback, and `actualChargeReconciliationSupported:false` (by design: reconciliation is the manual monthly process). Unknown request IDs cannot target arbitrary workspaces.
- **Cost reconciliation (manual):** Provider spend is reconciled manually each month: compare the `provider_spend` table with the Higgsfield console CSV export (open.higgsfield.ai, Analytics) and record any difference (owner decision, `docs/OWNER_DECISIONS.md`). Higgsfield's `GET /models/usage` is estimated analytics, not an invoice, and webhooks carry no cost, so there is no automated actual-charge feed. No usage estimate is relabelled as an actual charge, and the conservative spending reservations remain intact.
- Before live activation, use a capped, owner-approved acceptance run to check public callback reachability (Vercel preview protection may block delivery), delivery within ten seconds, private persistence before `expires_at`, and poll recovery with a deliberately missed callback. Mocked tests do not prove these hosted/provider conditions.

Primary documentation checked 19 November 2026:
- https://docs.higgsfield.ai/docs/how-to/webhooks
- https://docs.higgsfield.ai/docs/enterprise/webhook-security
- https://docs.higgsfield.ai/docs/enterprise/usage-and-billing
- https://docs.higgsfield.ai/docs/concepts/billing-and-retention
## Private downloads and background ZIPs (P1-5)

- Apply `20261119170000_campaign_exports.sql` before deploying this branch. It creates a workspace-scoped archive queue with RLS/runtime-role permissions in each provisioned `public` and `inkshot_live` schema, and permits ZIP content in the existing private generated-media buckets. It does not make any bucket public. Hosted migration execution is owner-controlled.
- Media previews and individual downloads authorize the version's workspace, validate the private bucket and object owner, then redirect to a Supabase signed URL valid for 600 seconds. Responses are `private, no-store` and `no-referrer`. Signed links grant temporary bearer access: do not log or share them. Local mock media continues to use local file responses. CSP permits only the configured HTTPS storage origin for image/video delivery.
- Campaign downloads use POST to queue an immutable snapshot of selected ready versions. Repeated requests for the same snapshot/category reuse an archive. The UI supports all ready assets, video ads, image ads and organic posts, each with captions and a destination URL file when present. The former GET download link opens the campaign rather than starting work.
- The existing worker prepares archives after available generation work. Archives are written privately, with one active archive at a time, three attempts, a 150-second build deadline and 95 MiB input ceiling to fit the existing 100 MiB bucket limit. Failed archives can be explicitly retried; no generation credits are charged. Local ZIP files remain available in mock mode. Completed cloud ZIP temp files are removed after persistence.
- Validation covers foreign-workspace 404s before signing, a fixed 600-second signing TTL, category captions, idempotent requests, failure/retry recovery, real ZIP integrity for three 8 MiB inputs, and a complete nine-asset mock kit with three decodable sample videos. These are local tests; a Vercel worker with three real provider videos and Supabase storage still needs hosted acceptance. Oversized campaigns must be downloaded by category or individually.
- The same export status can be reopened while pending; the browser does not hold a serverless response open during ZIP creation. Verify cron actually runs for the target deployment: preview cron execution is not assumed. Keep paid generation and payments off for mock acceptance.

Archive work is deferred to the next worker invocation when fewer than 160 seconds remain. Supabase storage fetches have a 30-second abort deadline, independently of the 150-second archive deadline. These are local safety bounds, not proof of hosted throughput.
## Trust pages and account deletion (P1-6)

- `/privacy`, `/terms` and `/ai-notice` are linked from the public footer, signup/sign-in and studio footer. They are explicitly preview drafts. Before paid launch the owner must approve the operator identity, controlled contact, retention periods, international-transfer details, governing terms, cancellation timing and cash-refund policy. Do not treat generation-credit refunds as cash refunds. No support address or zero-retention/training promise has been invented.
- Apply `20261119210000_account_deletion.sql` to each provisioned namespace before this release. It adds the workspace freeze marker, private durable deletion queue and triggers rejecting late workspace writes. The startup guard reports `SCHEMA_ACCOUNT_DELETION_REQUIRED` if the release columns are missing. No migration has been applied to hosted databases by this change.
- `ENABLE_ACCOUNT_DELETION` defaults false. Enable only after disposable hosted acceptance. The feature refuses shared Supabase Auth/live-schema mode, demo accounts, multiple-member workspaces, unfinished creative jobs, active subscriptions/pending checkout and provider reservations whose request ID was not recorded. Read-only Stripe reconciliation checks the customer’s checkout and subscription history. Expired/completed checkout IDs, including legacy rows, are cleared only when all subscriptions are terminal. Open checkout, active/past-due/incomplete subscriptions, failed reads and incomplete histories block deletion. Cancellation is not automatic.
- The authenticated endpoint requires the exact configured Origin and the phrase `DELETE MY ACCOUNT`; a body-supplied workspace ID is ignored. Enqueue freezes the workspace under a row lock. Database triggers reject late inserts/updates in its application tables. A 15-minute drain window exceeds current Vercel request/worker limits before external deletion starts. Keep this window greater than any future execution limit. Do not disable safeguards while requests are pending.
- Worker cleanup is staged and durable: provider request data, all objects under the private workspace prefixes, managed Auth identity, then a transaction removing application rows. Provider IDs are snapshotted before external calls; completed steps and per-request deletions survive retries. Work is bounded per invocation. The worker handles creative work first, then one bounded deletion stage to avoid starving either queue. Failures retain a safe retry code and never mark complete. A hashed identity tombstone prevents stale managed-auth requests from recreating a deleted workspace.
- Provider deletion uses the documented `DELETE /requests/{id}`. Only a matching `200`/`status=deleted` receipt is accepted; 404 can indicate the wrong provider account and requires review, 409/503 are retried. Provider billing/identifier records and third-party retention are not removed by this endpoint. Official contract: https://docs.higgsfield.ai/docs/enterprise/data-retention . Supabase operations use Storage list/remove and Auth admin deleteUser; credentials remain server-only.
- Hosted cleanup intentionally refuses local-file storage. The local test suite injects deletion adapters and does not delete real accounts, provider requests or hosted media. Hosted acceptance must cover provider failure/recovery, partial storage failure, Auth failure/recovery, concurrent late writes, stale sign-in, scope isolation and final private-object listing.
- A minimal internal receipt (opaque request/workspace IDs, identity hash, state/timestamps) remains for idempotency and stale-identity protection; raw identity/provider IDs are cleared at completion. Global Stripe event identifiers and global writing totals remain. Workspace writing counters are removed. Provider spend totals are retained to avoid resetting the daily spending budget; provider request IDs, input fingerprints and version linkage are removed. Backups and legally required accounting/security records require a separate approved retention policy.
- The migration also registers `campaign_exports` with the freeze trigger when present; apply it after the downloads migration. Enqueue refuses pending exports. Cleanup removes export records before campaigns and provider-event records matching the snapshotted provider IDs when those tables exist. Reapply the idempotent migration if downloads are installed later. Verify the combined release before enabling deletion. Existing signed-download URLs can remain in client caches; deleting the stored object does not erase downloaded copies.
## Claims guard (P1-6)

- Brand briefs now include a MUIS certification declaration and a private certificate image reference. Certified wording requires explicit merchant attestation and a certificate upload owned by the same workspace. The UI does not call an upload verified certification; owners remain responsible for checking authenticity, expiry and scope. Website/model imports cannot set the attestation. Campaign generation rechecks the current workspace declaration, so withdrawing it blocks older queued campaigns. A certificate cannot be selected as the campaign photo or logo.
- Certification text (`halal`, `MUIS`, Arabic and Chinese equivalents), currency/percentage claims, common guarantee/testimonial patterns and quoted copy are checked at draft save/generation, revisions, headline variations, worker execution and deterministic rendering. Prices/discounts must match approved brief/campaign-offer values; detected testimonials/guarantees need exact approved wording. A failed queued creative is stopped before provider/render work and refunded through the existing idempotent ledger.
- Visual prompts mentioning certification logos, marks, badges, seals or symbols are refused even for attested merchants. Writing instructions prohibit model-generated certification marks. Do not use generated certification graphics or let a certificate image become ad artwork. The upload is private reference evidence only.
- This is a conservative text guard, not a complete semantic truth detector or pixel inspection service. Alternate spellings, languages and new claim forms may require additional rules. Existing merchant-supplied photos/logos and generated pixels still need manual review before export; this change cannot verify whether a pictured mark is legitimate. The later quality-review task remains required.
- No DDL changes are needed: certification declaration/reference are stored in existing brand JSON; all upload references are checked against the workspace. Local regression coverage includes direct API bypass attempts, cross-workspace certificates, model-import attestation reset, renderer rejection and worker refund-once behavior. Hosted acceptance and small-screen browser QA remain pending.

## Current acceptance checkpoint — 20 November 2026

See `docs/GAME_PLAN_ACCEPTANCE.md` for every source-plan requirement. Hosted health succeeds in mock/billing-off mode; anonymous studio and operations calls return 401. Supabase security advisor currently reports no findings. Login-page availability does not prove full authentication acceptance.

A branch-specific Preview `CRON_SECRET` has now been saved for the next build. Preview cron execution must be tested explicitly; do not assume a production schedule executes preview jobs. Alert destination delivery, real Auth email callbacks and disposable deletion remain unverified.

The isolated browser reaches Vercel's authentication gate. Automatic review rejected creation of a temporary shareable protection bypass because it would expose a private preview. Continue local/CI and permitted read-only checks; do not disable protection or recreate access by another mechanism. Browser acceptance needs the owner's approved preview-access method and a controlled test mailbox.
