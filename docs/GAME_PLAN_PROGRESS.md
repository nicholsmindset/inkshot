# Inkshot game-plan progress

> **Historical log.** Implementation history only. The current release checklist is [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md); owner decisions are in [OWNER_DECISIONS.md](OWNER_DECISIONS.md).


**21 November verification:** 149 tests passed, production build and TypeScript passed, diff checks passed. Sandbox safeguard columns and restricted runtime privileges verified; security advisor returned no findings. Preview deployment verification is recorded in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). These are not paid-provider or production acceptance results.

Updated 21 November 2026. Source: the supplied `INKSHOT_GAME_PLAN.md`. Branch: `inkshot/phase-one-integration`.

## Current checkpoint — audit remediation

**Implemented does not mean hosted or production accepted.** The current working changes address the full-audit findings below. Final integrated checks and deployment evidence must be recorded for this exact revision before marking the corresponding acceptance items complete. Earlier counts, deployments and access failures are historical snapshots, not current release evidence.

| Area | Implemented in the remediation | Acceptance still required |
| --- | --- | --- |
| Provider jobs | Invocation deadlines, durable retry/reservation safeguards, recovery of known provider receipts and conservative handling of ambiguous submissions | Hosted crash/retry recovery and an approved capped provider run; verify webhook secret, training opt-out, output quality/duration and actual-charge reconciliation |
| Payments | Verified refund/dispute events create a spending hold that later renewals do not clear; checkout/generation/deletion respect the hold; Stripe preflight requires both events | Add `charge.refunded` and `charge.dispute.created` to the existing endpoint in place, run Stripe test-mode acceptance, approve refund economics and audited release workflow; see [PAYMENT_REVIEW.md](PAYMENT_REVIEW.md) |
| Uploads | Per-workspace limits of 100 files/250 MiB, 10 MiB per file, transactional reservations, owned unused-upload listing/deletion and Settings recovery controls | Apply schema migration; prove concurrent upload/deletion isolation and hosted storage cleanup. These safety limits are not paid-plan entitlements |
| Creative review and export | Explicit human review recorded against a content fingerprint, invalidation on changed content and server-side download/export enforcement; safer rendering and archive handling | Hosted changed-version/caption/destination checks, private large/expired downloads and human review of pilot creative. This does not authenticate certificates or inspect every pixel |
| Operations | Redacted alert delivery, bounded/deduplicated notifications, stuck-job/payment-review/reconciliation signals and runtime scheduling safeguards | Select destination, configure it, prove receipt and outage behavior; local fixtures do not demonstrate operator notification |
| Studio and navigation | Workspace/user-scoped session draft recovery, reread replacement confirmation, save-and-continue, mobile disclosure/focus/Escape behavior, visible-page polling and recovery controls | Actual desktop/mobile keyboard and assistive-technology checks, reload/navigation/draft recovery and a complete hosted campaign journey |
| Commercial copy | Correct campaign-duration description and monthly credit top-up wording | Approve SGD pricing and monthly regeneration cap before changing prices or claiming that phase complete |

### Migration and verification status

The new additive `20261121063442_launch_safeguards.sql` migration adds billing holds, upload byte accounting and review metadata in both existing `public` and `inkshot_live` schemas. Existing uploads receive a conservative size charge until inventory is measured. Startup schema checks are updated. Applied to the fresh sandbox on 21 November; all five column types were verified and the Supabase security advisor returned no findings. The migration filename matches the hosted migration history. No production schema was changed; application-level hosted acceptance remains open.

Focused regression tests have been added alongside the fixes. The final combined result is deliberately not asserted here until the integration run finishes. No production change, live charge, paid generation, real refund/dispute or approved policy decision is implied by code or fixture tests.

### Release gates

See [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md#release-gates).

Keep `BILLING_MODE=off`, `ENABLE_LIVE_CHECKOUT=false`, `GENERATION_MODE=mock` and `ALLOW_LIVE_GENERATION=false` for the no-spend rehearsal. Phase 2 pilot and Phase 3 research validation remain open; remediation is not blanket completion of the original plan.

## Historical implementation record — through 20 November 2026

The following sections preserve earlier evidence and review order. Their claims and counts apply to the named revision/date only; the current checkpoint above takes precedence.

## Review order

These PRs are stacked; review and merge their prerequisites in order, then retarget each successor to the updated main branch. Do not deploy an intermediate release against an older schema.

| Plan item | Review | Implemented | Still needed |
| --- | --- | --- | --- |
| Prerequisites | [#27](https://github.com/nicholsmindset/inkshot/pull/27), [#28](https://github.com/nicholsmindset/inkshot/pull/28), [#29](https://github.com/nicholsmindset/inkshot/pull/29) | Campaign approval, schema diagnostics, restricted fresh-project setup | Hosted sandbox and pending migrations verified; complete end-to-end acceptance |
| P1-2 operations | [#30](https://github.com/nicholsmindset/inkshot/pull/30) | Protected status, bounded database probes, redacted optional failure/stuck-job events | Select and configure an alert destination; prove receipt within five minutes |
| P1-3 photo-first video | [#33](https://github.com/nicholsmindset/inkshot/pull/33) | Owned product photo as first frame, no replacement-image generation, approved duration frozen; new default ten seconds | A separately approved capped real-provider trial, including signed-photo fetch timing and output duration |
| P1-4 provider callbacks | [#32](https://github.com/nicholsmindset/inkshot/pull/32) | Signed raw callbacks, timestamp checks, durable duplicate-safe receipts, recovery and protected metrics | Real webhook-secret acceptance and provider data-training setting; actual billing source remains unresolved |
| P1-5 downloads | [#34](https://github.com/nicholsmindset/inkshot/pull/34) | Owned short-lived media links, queued category/full-kit ZIPs, immutable manifests, cancellation and invocation-budget handling | Hosted large-file, browser and expired-link checks |
| P1-6 trust/deletion | [#35](https://github.com/nicholsmindset/inkshot/pull/35) | Draft policy pages, guarded retryable deletion, terminal-checkout reconciliation, isolated cleanup and work scheduling | Operator/legal/contact/refund review; disposable hosted deletion acceptance before enabling |
| P1-6 claims | [#36](https://github.com/nicholsmindset/inkshot/pull/36) | Owned certificate plus merchant attestation, text/visual-prompt guards, revoked-attestation checks, API/worker/render enforcement | Human creative review; neither certificate authentication nor pixel-level verification is implemented |
| Combined acceptance | `inkshot/phase-one-integration` | New-table startup diagnostics, bounded read-only billing checks, correct video revision payloads, updated isolated acceptance script | CI passed; preview startup passed; hosted user journeys remain |
| P1-7 cutover | [#31](https://github.com/nicholsmindset/inkshot/pull/31) | Separate live-project runbook, payment-off rehearsal, backups and rollback gates | Owner-controlled execution after preview acceptance; this docs PR can be reviewed separately after #30 |

## Historical verification completed

Final combined implementation at `50d9d8f`:

- `GENERATION_MODE=mock node --import tsx --test tests/*.test.ts`: **102 passed, 0 failed**.
- `npm run build`: TypeScript and Vite passed.
- `git diff --check`: passed.
- Tests include real disposable database schemas/roles, private media ownership, large ZIP fixtures, cancellation, signed webhook forgery/replay/duplicates, durable retries, checkout/deletion isolation and HTTP revision-to-worker provider payload capture.
- Provider/storage/Stripe calls in tests use local or injected fixtures. These results do not establish hosted delivery, real provider quality or real billing reconciliation.
- Independent agent review found and corrected stale checkout deletion blocks, deletion queue starvation, archive timeout behavior and discarded video-regeneration notes.

GitHub Actions were still running when the feature stack was published. Vercel checks for both `inkshot` and `inkshot-live` reported failure on #36; the connected Vercel tool returned 404 for its build log. The current failure reason has **not** been independently confirmed. Earlier preview credentials/configuration were scoped to `inkshot/fresh-project-setup`; do not assume the new branches inherit them. Do not treat the existing production homepage as proof that this release is deployed.

## Migrations and release switches

New migration files, in order, are:

1. `20261119160000_photo_first_video.sql`
2. `20261119170000_campaign_exports.sql`
3. `20261119200000_provider_events.sql`
4. `20261119210000_account_deletion.sql`

They support `public` and existing `inkshot_live` schemas. Run the entire reviewed migration chain in the disposable preview first. Account deletion deliberately refuses shared-Auth live-schema mode; use a separate live project for that capability.

Keep `BILLING_MODE=off`, `ENABLE_LIVE_CHECKOUT=false`, `GENERATION_MODE=mock` and `ALLOW_LIVE_GENERATION=false` through the no-spend rehearsal. New alerts, callbacks and deletion are off by default. Never paste provider or database credentials into PRs or chat; configure them through the provider's secret settings.

## Unresolved P1-4 billing dependency

[Higgsfield's usage documentation](https://docs.higgsfield.ai/docs/enterprise/usage-and-billing) says `/models/usage` exposes estimated cost and is not an invoice source. The implementation keeps estimates and explicitly reports that actual-charge reconciliation is unsupported. A documented invoice/billing feed or an approved manual reconciliation process is required before calling this item complete.

## Historical acceptance work

1. Completed: restore preview project access and configure the integration branch without enabling production or billing.
2. Migrations and restricted-role startup completed. Verify private-bucket behavior through owned and foreign-user download tests.
3. Run signup, confirmation, returning-user login, reset, session expiry and logout through the actual hosted browser/email flow. Test draft approval and mock generation through owned downloads on desktop and mobile.
4. Validate an alert arrives at the chosen destination, webhook fixtures recover correctly, expiring downloads remain private, and disposable deletion completes with no cross-workspace access.
5. Resolve legal/operator/contact details and the provider billing-source gap. Only then approve a capped real-generation rehearsal and a separate live cutover.

## Later phases

Phase 2 is intentionally gated on Phase 1 acceptance: review-before-export/caption quality, SGD pricing and a monthly video-regeneration cap, pilot tracking, and the premium-image flag. Existing USD pricing has not been silently changed. Start the Humble Halal merchant pilot only after these gates pass.

Phase 3 starts with a manual competitor board using merchant-collected Meta Ad Library links. Ad visibility or longevity does not prove sales or ROAS. No automated Apify scraping, performance claims or paid research add-on was enabled; validate merchant demand and the legal approach first.

## Resume — 20 November 2026

The prior integration revision passed GitHub verification and the confirmed-auth journey. Managed preview failed because its acceptance script still downloaded the old campaign GET route as a ZIP. Commit `ede20a0` changes this to queue an export, run the worker, verify ready status and download the owned archive, retaining unauthenticated/foreign-workspace rejection checks. TypeScript and diff checks passed; CI rerun is in progress.

The shared-schema acceptance script and migration ordering were independently reviewed with no further concrete issue found. Vercel build-log access remains unavailable through the connected account, and no associated browser-control runtime is exposed for this session. Production configuration and payment switches remain untouched. Phase 2 remains gated on preview acceptance as specified in the supplied plan.

## Verified checkpoint — 20 November 2026

At commit `3a6020b`, GitHub Actions run `44708555330` passed both `confirmed-auth-journey` and `managed-preview`. Verification and GitGuardian checks also passed. This closes the outdated export acceptance-test failure and verifies the disposable managed integration, including the workflow's shared-schema and restore checks. It does not prove production readiness.

Both Vercel project deployments still fail. Read access to `inkshot-live` returns 404 even with the verified owning team ID. Hosted deployment diagnosis therefore remains blocked on connection access; no production or billing configuration was changed.

## Hosted preview accepted for startup — 20 November 2026

- Deployment: `dpl_EzL7W6NpotnLtEoeKiypa22DfsM4`, state **READY**, commit `b40320fc7a9a3909453b67547b1dc9eca8fd3e61`.
- Preview: https://inkshot-live-git-inksh-5e52e1-nicholsmindset-gmailcoms-projects.vercel.app/login
- Project: `inkshot-live` (`prj_xQ764dcIohrQcX0trerDhN2eh0Zg`); branch `inkshot/phase-one-integration`.
- Supabase: `zdvniqffhiycyxxzchmi`, environment marker `sandbox`.
- Enabled the existing restricted `inkshot_app` login with a generated credential. It remains non-superuser and cannot bypass RLS. No admin database credential was used for application runtime.
- Saved `DATABASE_URL` as an encrypted, branch-specific Preview variable. The server key is also Preview-only on this branch. No credential values are recorded here.
- Applied the four migration files listed above; verified RLS and runtime grants on `campaign_exports`, `provider_events` and `account_deletions`.
- Hosted health returned HTTP 200 with `ok=true`, `mode=mock`, `billingMode=off`, `demoAvailable=false`. Startup includes the database and schema checks.
- Login route returned HTTP 200 with the application shell. Successful sign-in, email confirmation, reset and session behavior remain unverified on this hosted preview.
- A local connection attempt failed DNS resolution; the subsequent Vercel runtime health check succeeded. No pooler-host change was needed.

No production deployment, payment enablement or paid generation was performed. The complete current checklist is in [INKSHOT_GAME_PLAN.md](INKSHOT_GAME_PLAN.md).

## Full-source goal and hosted access checks — 20 November 2026

Created `GAME_PLAN_ACCEPTANCE.md` from the user's uploaded 217-line game plan. It preserves Phase 2 caption/SRT, quality review, premium-image, SGD configuration, regeneration caps, funnel events, original pilot targets, and conditional research requirements. Deferred and prohibited features are not silently treated as approved implementation.

Fresh hosted checks on the integration preview:

- `/api/health`: HTTP 200, mock generation, billing off.
- `/api/studio`: HTTP 401 without an app session.
- `/api/ops/status`: HTTP 401 without authorization.
- Invalid auth callback: the fetch client followed a response to an HTML page. This is not sufficient evidence of correct error messaging, so callback acceptance remains open.

No customer email was sent, no paid call was made and no production change was performed. Full email delivery and session acceptance still require a controlled test mailbox and an interactive HTTP/browser test session; the existing disposable CI journey must not be repointed at hosted credentials.

## Multi-agent reliability pass — 20 November 2026

Authentication, exports and operations/deletion were reviewed independently. Follow-up work addressed concrete failures rather than rebuilding completed features:

- Password recovery now reports a safe 503 for provider credential/configuration failures instead of falsely promising email delivery. Unknown-account and per-user throttle responses remain private.
- ZIP inputs use a per-job temporary directory and are cleaned on success/failure. Distinct storage keys cannot overwrite files with the same basename. Category and full-kit caption contents are covered.
- Deletion retry/backlog counts and age are included in protected ops status; failures and overdue requests emit redacted events. Actual adapter tests cover storage pagination/isolation, partial failures, provider receipt validation and Auth retry behavior using mocked requests.
- Checkout request identifiers are now stable across provider-success/database-failure retries; the regression test uses a fake provider and makes no Stripe calls.

Preview-only configuration now includes a worker secret, enabled redacted operational logging, and explicit disabled deletion/Higgsfield callback flags. This does not prove an external alert destination receives events.

Hosted security checks: zero public-schema tables without RLS, zero public buckets, zero public-table grants for anon/authenticated, and no elevated privileges on inkshot_app. Supabase security advisor reports no findings. Server-side workspace checks still require full end-to-end acceptance.

Hosted interactive acceptance remains blocked: the isolated browser encounters Vercel authentication, and automatic approval review rejected a temporary shareable bypass. No alternative bypass was attempted. A controlled test mailbox and authorized browser access are required for signup/confirmation/reset acceptance.

Combined verification after these fixes: **111 tests passed, 0 failed**; TypeScript/Vite build passed. Tests use disposable databases and mocked external requests. No paid calls were made.

## Hosted HTTP acceptance and auth diagnostics — 20 November 2026

After the owner approved temporary preview access, tested deployment `dpl_DooKpMJLdqW6afZZRbpPphusRhuo` at `91f7a59`. The one-hour share access was revoked immediately after these checks.

- Health: 200, mock generation, billing off, demo disabled.
- Login, signup, recovery, privacy and terms routes: 200 application HTML. This is not a visual or email-delivery acceptance test.
- Signed-out studio, downloads, operations and worker: 401.
- Malformed signup/login: 400. Nonexistent credentials: generic 401.
- Cross-origin signup: 403. Signed-out checkout and generation: 401.

Follow-up code distinguishes provider outages/network errors from incorrect credentials or verification codes: login and email-code verification return a safe 503 during outages; credential/code failures remain generic 401. Regression tests check private details are not returned and rejected requests create no session or local user.

Validation: **112 tests passed, 0 failed**; TypeScript/Vite build passed. No email was sent, no customer was created, no paid API was called and production was not changed. Hosted confirmed signup, reset, signed-in campaign/export and cross-account acceptance still require a controlled test mailbox. External alert delivery remains unproven.
