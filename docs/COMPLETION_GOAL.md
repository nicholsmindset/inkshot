# Goal: complete the Inkshot game plan

Started 20 November 2026, Singapore. Work now; no scheduled automation.

Deliver a tested advertising studio ready for an approved paid merchant pilot, then validate the competitor-research add-on. Source: INKSHOT_GAME_PLAN.md. Detailed implementation evidence and PR order: [GAME_PLAN_PROGRESS.md](GAME_PLAN_PROGRESS.md).

A task is complete only when its acceptance evidence is recorded. Code in a draft PR is not a verified live feature. Keep credentials private, work on branches, keep payments off, and make no production changes or paid provider calls until the relevant release decision is approved. Record owner-dependent tasks and continue independent work.

## Phase 1 — launch reliability

- [ ] Schema startup checks: implemented; verify the complete migration chain in the intended hosted preview, under its restricted role.
- [ ] Signup and returning-user journey: confirmed-auth CI passes; finish intended hosted signup, email confirmation, reset, expiry and logout checks.
- [ ] Operations: protected status and redacted events implemented; select a destination and prove alert receipt within five minutes.
- [ ] Product-photo-first video: implemented with default ten seconds, approved duration and revision preservation; validate a separately approved capped provider run.
- [ ] Higgsfield callbacks: signature, replay and durable receipt handling implemented; validate real signing-secret configuration and exclude-data-from-training setting.
- [ ] Spend reconciliation: obtain actual invoice/charge evidence or approve a manual process; estimated usage alone is insufficient.
- [ ] Private downloads: signed links and background category/full-kit ZIPs implemented; finish managed-preview CI plus hosted expiry, mobile and large-file checks.
- [ ] Privacy, terms, refunds and AI notices: draft pages implemented; resolve legal operator, verified contact, retention and refund details.
- [ ] Account deletion: guarded retryable cleanup implemented; verify disposable hosted provider/storage/Auth cleanup and isolation before enabling.
- [ ] Halal/advertising claims: text and prompt checks implemented; review merchant attestation and human creative checks with pilot examples.
- [ ] Release readiness: resolve Vercel failures; review stacked PRs, rehearse backup/restore and rollback; execute separate live cutover only after explicit release approval.

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

Latest observed checks on PR #37 at `3a6020b`: verification, confirmed-auth journey and managed-preview all passed; both Vercel project checks failed. Local combined code previously passed 102 tests and the production build. The updated export acceptance script passed TypeScript. These results do not satisfy hosted release acceptance.

Next execution: restore access to the intended Vercel project, validate the hosted preview, then advance the phase gates. Track completion evidence in GAME_PLAN_PROGRESS.md and update this checklist; do not silently mark access or owner decisions complete.
