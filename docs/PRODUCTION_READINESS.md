# Inkshot production readiness — 21 November 2026

This is the release checklist for the audit remediation in draft PR #37. Implementation is on `inkshot/phase-one-integration`. It is not approval to collect money. Payments and paid generation remain disabled; no production settings or customer balances were changed in this pass.

## Audit remediation

| Area | Change | Remaining acceptance |
| --- | --- | --- |
| Photo-backed image regeneration | API rejects unsupported scene changes before any debit; free text/caption editing remains available | Hosted merchant example |
| Provider lifecycle | Bounded provider job lifetime, one-time refund, durable reconciliation flag, expiry-aware first frames and known-receipt recovery | Approved paid-provider trial and actual-charge reconciliation |
| Worker concurrency | Workspace-first writes, advisory claim coordination, eligibility rechecks and lease fencing | Concurrent hosted PostgreSQL stress/recovery rehearsal |
| Worker duration | Invocation budget, cancellation for provider/download/render, FFmpeg termination, temporary cleanup | Hosted long-running video and worker restart |
| Exports | Fair scheduling, oversized archive terminal diagnosis, current-copy review checks, private short-lived links | Hosted large/expired download and browser checks |
| Uploads | 100-file/250-MiB workspace safety limits; durable byte reservation; locked persistence/deletion; safe unused-file removal | Hosted ambiguous failure and deletion acceptance |
| Billing | Explicit off switch, checkout pagination fails closed, refund/dispute spend holds, consistent lock order | Stripe test-event delivery, operator-reviewed release of holds |
| Writing and provider spend | Held accounts cannot create new paid reservations; existing receipts can recover | Provider/account reconciliation |
| Human review | Seven checks required; approval bound to version, copy and destination; edits invalidate approval | Pilot merchant validates outputs, claims and destination |
| UI | Scoped draft recovery, replacement confirmation, editable captions, mobile navigation and bounded visible-page polling | Desktop/mobile keyboard and assistive-technology review |
| Infrastructure | Static-page CSP/anti-framing, wider CI change triggers, schema diagnostics, bounded optional alerts | Hosted headers, alert receipt, restore/rollback rehearsal |

## Safe environment

The fresh Supabase project `zdvniqffhiycyxxzchmi` was verified as sandbox. Additive migration `20261121063442_launch_safeguards.sql` was applied there, and all five column types were verified. Security advisor returned no findings. The local CLI was terminated by the host; the connected migration service was used and its generated version retained in Git. Both schema variants are covered by local tests; this does not mean production was migrated.

Preview-only `ENABLE_EXPORT_REVIEW=true` exercises the review gate even in mock mode. Live mode always requires review. Keep `BILLING_MODE=off`, `ENABLE_LIVE_CHECKOUT=false`, `GENERATION_MODE=mock` and `ALLOW_LIVE_GENERATION=false` during acceptance.

## Alert setup still required

Choose an operator-controlled HTTPS receiver. Configure server-only `OPS_ALERT_WEBHOOK_URL` and optionally `OPS_ALERT_WEBHOOK_SECRET`; keep `OPS_ALERTS_ENABLED=true`. Never put these in frontend variables. Notifications contain only an allowlisted event and aggregate count, use a 2.5-second request deadline, reject redirects, and deduplicate through PostgreSQL for five minutes. Failed sends can retry on the next probe; database outages use bounded per-instance deduplication, so the receiver must also deduplicate.

An external monitor must call the protected operations endpoint with the existing server-side authorization and alert on failed probes. An internal cron alone cannot report that it stopped running. Configuration and external delivery have not been performed. Log output and fake transport tests are not evidence of operator receipt.

## Payment setup still required

Add `charge.refunded` and `charge.dispute.created` to the existing intended Stripe endpoint, first in test mode. Do not create duplicate endpoints or rerun provisioning blindly. See [PAYMENT_REVIEW.md](PAYMENT_REVIEW.md). Any refund or dispute holds new spend for review; it does not silently claw back credits or automatically release a hold.

The currently implemented offer remains USD 39. The game plan's S$49 and eight regenerations are proposals. Approve pricing, credit economics and monthly regeneration rules using actual provider costs before implementing or advertising them as the launch offer.

## Release evidence still required

1. Controlled mailbox: hosted signup, delivered confirmation, returning login, reset, expiry and logout. Continue through campaign planning, mock generation, review and private downloads.
2. Hosted upload and account deletion isolation, worker restart/concurrency, large/expired downloads, desktop/mobile UI and security headers.
3. Verified provider credentials, webhook signing, data-training exclusion setting, approved capped paid trial, actual charges and reconciliation process.
4. Confirmed legal operator, working support mailbox, retention/refund policy and reviewed terms/privacy. Do not use an unowned domain email as a verified support address.
5. Tested external alerts, backups, restore and rollback; resolve production startup settings separately.
6. Explicit cutover decision after the evidence above. Keep payments off until the release is accepted.

The original pilot and competitor-research validation remain separate open work. The manual research board must distinguish observed ad patterns from measured performance; automated scraping is not part of this release.

## Verification record

- Combined local suite: **149 passed, zero failed**.
- Production build, TypeScript and whitespace validation: passed.
- Fresh sandbox: all new column types and restricted-runtime read/write privileges verified; security advisor has no findings.
- Tests exercise HTTP routes, real local database schemas, fake provider transports, failure/retry paths and lock ordering. Actual concurrent hosted PostgreSQL, external delivery and paid-provider quality are not established by these tests.

### Integration preview acceptance at `ab69097`

- Vercel `inkshot-live` deployment `dpl_4oCKHfyHazYjG5xsEmqVc514Egdt`: READY.
- Hosted `/api/health`: HTTP 200, `ok=true`, `mode=mock`, `billingMode=off`, `demoAvailable=false`.
- Hosted `/login`: HTTP 200 and application shell; CSP and `X-Frame-Options: DENY` verified.
- Signed-out `/api/studio`: HTTP 401.
- GitHub verify, confirmed-auth-journey, managed-preview, browser and GitGuardian checks: passed. Auth/service checks run against disposable CI services, not a real customer's mailbox.
- Temporary preview access used for checks was revoked. Ordinary Vercel authentication still applies.
- Separate legacy `inkshot` deployment remains failed with its known missing preview `APP_ORIGIN` configuration. It was not changed or promoted; do not call the full two-project deployment set green.

[Preview login](https://inkshot-live-4kc4jlp8o-nicholsmindset-gmailcoms-projects.vercel.app/login) · [Draft PR #37](https://github.com/nicholsmindset/inkshot/pull/37).
