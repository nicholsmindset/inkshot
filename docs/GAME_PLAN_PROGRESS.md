# Inkshot game-plan progress

Updated 19 November 2026 (Singapore). Source: the supplied `INKSHOT_GAME_PLAN.md`.

Phase 1 code is prepared in draft PRs. This is **not launch acceptance**: no production settings, hosted migrations, live payment switches, real deletions or paid provider calls were performed in this implementation pass. The final combined branch is `inkshot/phase-one-integration`.

## Review order

These PRs are stacked; review and merge their prerequisites in order, then retarget each successor to the updated main branch. Do not deploy an intermediate release against an older schema.

| Plan item | Review | Implemented | Still needed |
| --- | --- | --- | --- |
| Prerequisites | [#27](https://github.com/nicholsmindset/inkshot/pull/27), [#28](https://github.com/nicholsmindset/inkshot/pull/28), [#29](https://github.com/nicholsmindset/inkshot/pull/29) | Campaign approval, schema diagnostics, restricted fresh-project setup | Confirm hosted environment and apply reviewed migrations before deployment |
| P1-2 operations | [#30](https://github.com/nicholsmindset/inkshot/pull/30) | Protected status, bounded database probes, redacted optional failure/stuck-job events | Select and configure an alert destination; prove receipt within five minutes |
| P1-3 photo-first video | [#33](https://github.com/nicholsmindset/inkshot/pull/33) | Owned product photo as first frame, no replacement-image generation, approved duration frozen; new default ten seconds | A separately approved capped real-provider trial, including signed-photo fetch timing and output duration |
| P1-4 provider callbacks | [#32](https://github.com/nicholsmindset/inkshot/pull/32) | Signed raw callbacks, timestamp checks, durable duplicate-safe receipts, recovery and protected metrics | Real webhook-secret acceptance and provider data-training setting; actual billing source remains unresolved |
| P1-5 downloads | [#34](https://github.com/nicholsmindset/inkshot/pull/34) | Owned short-lived media links, queued category/full-kit ZIPs, immutable manifests, cancellation and invocation-budget handling | Hosted large-file, browser and expired-link checks |
| P1-6 trust/deletion | [#35](https://github.com/nicholsmindset/inkshot/pull/35) | Draft policy pages, guarded retryable deletion, terminal-checkout reconciliation, isolated cleanup and work scheduling | Operator/legal/contact/refund review; disposable hosted deletion acceptance before enabling |
| P1-6 claims | [#36](https://github.com/nicholsmindset/inkshot/pull/36) | Owned certificate plus merchant attestation, text/visual-prompt guards, revoked-attestation checks, API/worker/render enforcement | Human creative review; neither certificate authentication nor pixel-level verification is implemented |
| Combined acceptance | `inkshot/phase-one-integration` | New-table startup diagnostics, bounded read-only billing checks, correct video revision payloads, updated isolated acceptance script | CI and hosted acceptance of this exact final branch |
| P1-7 cutover | [#31](https://github.com/nicholsmindset/inkshot/pull/31) | Separate live-project runbook, payment-off rehearsal, backups and rollback gates | Owner-controlled execution after preview acceptance; this docs PR can be reviewed separately after #30 |

## Verification completed

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

## Next acceptance work

1. Confirm the intended preview project's access and configuration for the final integration branch, without changing production or enabling billing.
2. Apply the reviewed migrations to that disposable preview and verify restricted-role readiness plus private buckets.
3. Run signup, confirmation, returning-user login, reset, session expiry and logout through the actual hosted browser/email flow. Test draft approval and mock generation through owned downloads on desktop and mobile.
4. Validate an alert arrives at the chosen destination, webhook fixtures recover correctly, expiring downloads remain private, and disposable deletion completes with no cross-workspace access.
5. Resolve legal/operator/contact details and the provider billing-source gap. Only then approve a capped real-generation rehearsal and a separate live cutover.

## Later phases

Phase 2 is intentionally gated on Phase 1 acceptance: review-before-export/caption quality, SGD pricing and a monthly video-regeneration cap, pilot tracking, and the premium-image flag. Existing USD pricing has not been silently changed. Start the Humble Halal merchant pilot only after these gates pass.

Phase 3 starts with a manual competitor board using merchant-collected Meta Ad Library links. Ad visibility or longevity does not prove sales or ROAS. No automated Apify scraping, performance claims or paid research add-on was enabled; validate merchant demand and the legal approach first.

## Resume — 20 November 2026

The prior integration revision passed GitHub verification and the confirmed-auth journey. Managed preview failed because its acceptance script still downloaded the old campaign GET route as a ZIP. Commit `ede20a0` changes this to queue an export, run the worker, verify ready status and download the owned archive, retaining unauthenticated/foreign-workspace rejection checks. TypeScript and diff checks passed; CI rerun is in progress.

The shared-schema acceptance script and migration ordering were independently reviewed with no further concrete issue found. Vercel build-log access remains unavailable through the connected account, and no associated browser-control runtime is exposed for this session. Production configuration and payment switches remain untouched. Phase 2 remains gated on preview acceptance as specified in the supplied plan.
