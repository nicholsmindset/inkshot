# Inkshot — completion and launch plan

Updated: 20 November 2026, Singapore

## Goal

Deliver a reliable advertising studio that turns a merchant’s website and product photos into an editable brand brief, ad concepts, image ads, videos and social posts. Launch with a small, approved Humble Halal merchant pilot. Validate competitor research as a separate paid feature after the core product works.

This document consolidates the supplied game plan and verified implementation progress. It does not mark untested features as complete.

## Working rules

- Work on branches; review changes before merging.
- Keep payments off and generation in mock mode during preview testing.
- Do not change production or make paid provider calls without the relevant release approval.
- Keep keys, passwords and database URLs out of chat, documentation and Git.
- Maintain migrations for both the sandbox and existing live schema where applicable.
- Record evidence for each acceptance check. A successful build is not proof that signup, payment or generation works.
- Save owner-dependent decisions and continue work that does not depend on them.

## Project references

| Item | Reference |
| --- | --- |
| Repository | https://github.com/nicholsmindset/inkshot |
| Integration PR | https://github.com/nicholsmindset/inkshot/pull/37 |
| Working branch | `inkshot/phase-one-integration` |
| Deployed commit | `b40320fc7a9a3909453b67547b1dc9eca8fd3e61` |
| Preview login | https://inkshot-live-git-inksh-5e52e1-nicholsmindset-gmailcoms-projects.vercel.app/login |
| Vercel project | `inkshot-live` |
| Vercel team | `nicholsmindset-gmailcoms-projects` |
| Sandbox Supabase | https://supabase.com/dashboard/project/zdvniqffhiycyxxzchmi |
| Detailed implementation record | [GAME_PLAN_PROGRESS.md](GAME_PLAN_PROGRESS.md) |
| Completion checklist | [COMPLETION_GOAL.md](COMPLETION_GOAL.md) |

## Verified checkpoint

- [x] Restored connector access to the existing Vercel projects.
- [x] Configured the integration branch’s Preview environment, including the server key and encrypted database connection.
- [x] Enabled the restricted `inkshot_app` login; verified it has neither superuser nor RLS-bypass privileges.
- [x] Applied the four pending Phase 1 migrations to the fresh sandbox.
- [x] Verified RLS and runtime grants on the three new tables.
- [x] Deployed preview `dpl_EzL7W6NpotnLtEoeKiypa22DfsM4`; Vercel reports READY.
- [x] Confirmed hosted health returns HTTP 200: `ok=true`, `mode=mock`, `billingMode=off`.
- [x] Confirmed the preview login route returns HTTP 200 and the application shell.
- [x] Earlier combined implementation passed 102 local tests and the build; GitHub confirmed-auth and managed-preview checks subsequently passed.

**Remaining distinction:** the hosted login page loads, but successful signup, confirmation, returning-user login and password reset still need end-to-end verification. The product is not yet approved for live payments.

## Phase 1 — launch reliability

### 1. Finish signup and returning-user acceptance

Use disposable test accounts in the fresh sandbox.

- [ ] Complete signup and email confirmation through the hosted preview.
- [ ] Check callback URLs return to the correct preview origin.
- [ ] Sign out, then sign in again with the same account.
- [ ] Verify password reset, expired links and expired sessions.
- [ ] Check duplicate email and incorrect-password messages are useful and reveal no sensitive information.
- [ ] Verify two accounts cannot read or alter each other’s workspaces, campaigns or files.

Done when the full journey passes and the evidence is recorded. Do not treat a page response or a CI fixture as hosted acceptance.

### 2. Verify the website-to-campaign journey

- [ ] Read a merchant website and inspect extracted brand name, offer, audience, colours and logo.
- [ ] Show source pages and clearly distinguish extracted facts from inferred suggestions.
- [ ] Edit and save the brief, select among six ad angles and review prompts before generation.
- [ ] Upload a product photo and verify ownership checks.
- [ ] Generate a mock kit, refresh during processing and confirm progress survives.
- [ ] Retry or resubmit without creating duplicate jobs or charges.
- [ ] Verify video revisions preserve the approved duration and edited motion instructions.

Done when the journey works on desktop and mobile, with readable text, clear errors and no false claims about ad performance.

### 3. Operations and alerts

Protected status checks and redacted events are implemented.

- [ ] Choose an alert destination and configure it.
- [ ] Trigger controlled failure and stuck-job fixtures.
- [ ] Confirm receipt within five minutes and verify no credentials or customer prompts appear.
- [ ] Confirm status endpoints reject unauthorized requests.

### 4. Product-photo-first video and provider callbacks

Photo-first generation, a ten-second default, signed callbacks and duplicate-safe receipts are implemented.

- [ ] Confirm Higgsfield API access and the actual webhook signing secret.
- [ ] Enable the provider’s exclude-data-from-training setting.
- [ ] Verify forged, expired and duplicate callback handling in hosted tests.
- [ ] Separately approve a capped paid trial before using real generation.
- [ ] Confirm the provider can fetch the signed product-photo URL and returns the approved duration.
- [ ] Verify failure and recovery behavior without duplicate submission.

Do not enable paid generation merely because provider keys are present.

### 5. Reconcile provider cost

- [ ] Obtain actual invoice/charge data or agree a documented manual reconciliation process.
- [ ] Compare estimated and actual cost per completed job.
- [ ] Define handling for failed, retried and partially completed kits.

Higgsfield’s `/models/usage` reports estimated cost; it is not invoice evidence. Actual-charge reconciliation remains unresolved.

### 6. Downloads and exports

Short-lived owned media links and queued category/full-kit ZIP exports are implemented. Managed-preview CI passed.

- [ ] Download individual assets and category/full-kit ZIPs from the hosted preview.
- [ ] Verify expired links stop working and foreign accounts cannot obtain replacement links.
- [ ] Test mobile downloads and large files within the implemented limits.
- [ ] Verify interrupted exports recover and changed versions produce a new export.

### 7. Trust, claims and deletion

Draft policy pages, guarded deletion and advertising-claim checks are implemented.

- [ ] Confirm the legal operator, verified support address, retention policy and refund terms.
- [ ] Finalize privacy, terms and AI disclosures. Do not present `hello@inkshot.com` as verified until the domain and inbox are controlled.
- [ ] Review halal claims against merchant attestation and supporting evidence; require human creative review.
- [ ] Make clear that stored certificates are not independently authenticated by the current implementation.
- [ ] Test deletion using disposable hosted accounts, including retry, storage cleanup, Auth cleanup and workspace isolation.
- [ ] Verify active jobs and subscriptions block unsafe deletion.

Deletion remains disabled until acceptance. The implementation refuses shared-Auth live-schema deletion; use a separate live project for this capability.

### 8. Release review

- [ ] Review the stacked PRs in the order recorded below.
- [ ] Complete hosted acceptance and review any remaining security findings.
- [ ] Rehearse the intended release’s backup, restore and rollback process.
- [ ] Approve a separate production cutover with payments initially off.
- [ ] Enable payments only after billing and merchant-pilot gates pass.

## Phase 2 — paid Humble Halal merchant pilot

Start after Phase 1 acceptance.

| Work | Acceptance |
| --- | --- |
| Quality review before export | Merchant approves copy and creative; revisions invalidate prior approval. |
| Caption improvements | Captions match the approved offer, audience and tone without unsupported claims. |
| SGD pricing | Agree prices and margins before configuration; clearly show what each plan includes. |
| Monthly video-regeneration cap | Test limits, renewals, cancellations and duplicate billing events in Stripe test mode. |
| Pilot tracking | Track signup, brief approval, generation, export, failures and feedback with minimal personal data. |
| Premium-image option | Verify eligibility, visible cost, feature flag and fallback behavior. |
| Merchant pilot | Record quality, time to usable output, cost, failures and merchant feedback before expansion. |

- [ ] Complete and verify each row above.
- [ ] Approve live pricing and payment activation separately.
- [ ] Run the agreed pilot and review results before expanding.

## Phase 3 — validate competitor research

- [ ] Build a private manual board from merchant-supplied Meta Ad Library links.
- [ ] Store source URL, observed date, brand, format, hook, offer and merchant notes.
- [ ] Separate observable patterns from performance hypotheses.
- [ ] Never label an ad a proven winner based on longevity or visibility alone; those do not establish ROAS or sales.
- [ ] Test whether merchants find the research useful and will pay for it.
- [ ] Obtain legal advice before deciding on automated Apify collection.
- [ ] Define pricing, limits and source handling only after demand and the collection approach are validated.

## PR review order

Review current PR status before merging; this is the implementation stack, not a claim that all PRs remain open.

1. #27 — campaign planning and authentication diagnosis.
2. #28 — schema startup checks.
3. #29 — fresh-project setup.
4. #30 — operations and alerts.
5. #33 — product-photo-first video.
6. #32 — provider webhooks.
7. #34 — signed downloads and exports.
8. #35 — trust pages and account deletion.
9. #36 — claims guard.
10. #37 — combined integration and acceptance.
11. #31 — separate live-cutover runbook; review after its prerequisites.

## Owner-dependent decisions

| Decision | Why it is needed |
| --- | --- |
| Verified support contact and legal operator | Final policy pages and customer support. |
| Alert destination | Prove operational failures reach someone. |
| Writing-provider funding or approved alternative | Verify real brief and copy quality. |
| Higgsfield training preference and webhook secret | Validate provider privacy configuration and callbacks. |
| Capped paid-generation budget | Test real output without open-ended spending. |
| Actual billing evidence or manual reconciliation process | Establish cost and margin accuracy. |
| SGD prices and regeneration allowances | Configure and verify the paid pilot. |
| Production release approval | Move from preview testing to a controlled launch. |

## Next work, in order

1. Complete hosted signup, confirmation, returning-user login and reset.
2. Run website → brief → mock kit → download with two isolated accounts.
3. Finish alerts, private-download and disposable-deletion acceptance.
4. Resolve legal and provider dependencies; run only the approved capped real-provider test.
5. Review Phase 1 acceptance, then implement and verify the paid pilot.

The next milestone is a fully tested preview journey. The final goal remains a controlled paid launch, followed by a validated research add-on.
