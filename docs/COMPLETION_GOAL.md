# Goal: complete the Inkshot game plan

Started 20 November 2026, Singapore. Work now; no scheduled automation.

Deliver a tested advertising studio ready for an approved paid merchant pilot, then validate the competitor-research add-on. Source: INKSHOT_GAME_PLAN.md. Detailed implementation evidence and PR order: [GAME_PLAN_PROGRESS.md](GAME_PLAN_PROGRESS.md).

Full source-to-task register: [GAME_PLAN_ACCEPTANCE.md](GAME_PLAN_ACCEPTANCE.md). This includes captions/SRT, category caption files, quality review, pricing assumptions and the original pilot targets.

A task is complete only when its acceptance evidence is recorded. Code in a draft PR is not a verified live feature. Keep credentials private, work on branches, keep payments off, and make no production changes or paid provider calls until the relevant release decision is approved. Record owner-dependent tasks and continue independent work.

## Phase 1 — launch reliability

- [x] Schema startup checks: the intended hosted preview starts successfully under its restricted database role after the four pending migrations were applied; `/api/health` returned HTTP 200 on 20 November 2026.
- [ ] Signup and returning-user journey: confirmed-auth CI passes; finish intended hosted signup, email confirmation, reset, expiry and logout checks.
- [ ] Operations: protected status and redacted events implemented; select a destination and prove alert receipt within five minutes.
- [ ] Product-photo-first video: implemented with default ten seconds, approved duration and revision preservation; validate a separately approved capped provider run.
- [ ] Higgsfield callbacks: signature, replay and durable receipt handling implemented; validate real signing-secret configuration and exclude-data-from-training setting.
- [ ] Spend reconciliation: obtain actual invoice/charge evidence or approve a manual process; estimated usage alone is insufficient.
- [ ] Private downloads: signed links and background category/full-kit ZIPs implemented; managed-preview CI passed; finish hosted expiry, mobile and large-file checks.
- [ ] Privacy, terms, refunds and AI notices: draft pages implemented; resolve legal operator, verified contact, retention and refund details.
- [ ] Account deletion: guarded retryable cleanup implemented; verify disposable hosted provider/storage/Auth cleanup and isolation before enabling.
- [ ] Halal/advertising claims: text and prompt checks implemented; review merchant attestation and human creative checks with pilot examples.
- [ ] Release readiness: Vercel preview failure resolved; review stacked PRs, rehearse backup/restore and rollback; execute separate live cutover only after explicit release approval.

## Phase 2 — paid Humble Halal merchant pilot

Begin after Phase 1 acceptance, as specified in the source plan.

- [ ] Require quality review before export and improve caption quality; verify changed versions invalidate prior approval.
- [ ] Implement agreed SGD pricing and a monthly video-regeneration cap; verify duplicate events, renewals, cancellations and allowance boundaries in Stripe test mode.
- [ ] Implement privacy-conscious pilot funnel tracking and a usable pilot review report.
- [ ] Add the premium-image feature flag and verify eligibility, cost visibility and fallback behavior.
- [ ] Run the approved merchant pilot; record output quality, failures, cost and merchant feedback before expanding.

## Phase 3 — validated competitor research

- [ ] Build an owned manual research board using merchant-supplied Meta Ad Library links, source dates and notes.
- [ ] Separate observable ad patterns from performance hypotheses; never label an ad a proven winner without performance evidence.
- [ ] Validate merchant demand and willingness to pay for the research feature.
- [ ] Obtain legal advice before deciding whether automated Apify collection should be implemented.
- [ ] Define the paid add-on only after validation, with approved pricing, usage limits and source handling.

## Current checkpoint

Updated 20 November 2026, Singapore.

- Vercel connection access is restored for the existing Inkshot projects.
- Preview deployment `dpl_EzL7W6NpotnLtEoeKiypa22DfsM4` is READY at commit `b40320fc7a9a3909453b67547b1dc9eca8fd3e61`.
- `SUPABASE_SECRET_KEY` and `DATABASE_URL` are configured for Preview only on `inkshot/phase-one-integration`.
- The fresh Supabase project `zdvniqffhiycyxxzchmi` is marked sandbox. Its `inkshot_app` role can log in and has no superuser or RLS-bypass privileges.
- All four pending Phase 1 schema migrations applied successfully. New tables have RLS enabled and restricted-runtime grants.
- Hosted `/api/health`: HTTP 200, `ok=true`, `mode=mock`, `billingMode=off`, `demoAvailable=false`.
- The preview login route returns HTTP 200 and the application shell. This does not verify successful login or email delivery.
- Earlier GitHub verification, confirmed-auth journey and managed-preview checks passed at `3a6020b`; combined local implementation passed 102 tests and its build.

[Open the preview login](https://inkshot-live-git-inksh-5e52e1-nicholsmindset-gmailcoms-projects.vercel.app/login).

Next execution: complete the hosted signup, email and returning-user journey, then campaign/download acceptance. Payments remain off; production and paid generation were not enabled.

## Reliability follow-up

Password-recovery configuration errors, export temporary-file cleanup, checkout retry parameters and deletion monitoring were fixed. The combined suite passes 111 tests and the production build. Preview worker authentication is configured; redacted operational events are enabled, while deletion, provider callbacks and payment activation stay disabled. Full hosted email/account acceptance remains open behind the preview-access and controlled-mailbox prerequisites.
