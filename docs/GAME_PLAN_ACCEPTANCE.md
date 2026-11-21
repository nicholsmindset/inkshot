# Inkshot game plan — execution and acceptance register

Goal started: 20 November 2026 (Singapore). Work immediately; no schedule.

Source: user-uploaded `INKSHOT_GAME_PLAN(4).md`, 217 lines, prepared 19 November 2026. `Pasted text(6).txt` contains the same requirements.

## Goal and completion rule

Complete every approved requirement in the source plan, from launch reliability through a measured paid pilot and validation of the research add-on. Preserve completed implementation. Each row must have evidence before it is marked done.

Conditional items are not automatic build instructions. Apify automation requires demand validation and legal clearance. Meta Insights and other items marked Later remain deferred until that decision changes. Items marked Do not build stay excluded.

Payments off, mock generation, branch-only code changes, and no production changes remain in force. Hosted sandbox configuration and migrations were separately authorized and performed. Real spend and production activation require the relevant approval; continue independent work while those gates are pending.

## Status register

| ID | Scope from source file | Status | Evidence required to close |
| --- | --- | --- | --- |
| P1-1 | Schema guard and clear startup diagnosis | Implemented; preview startup passed | Existing negative-schema tests plus passing hosted restricted-role startup; PR merge remains separate |
| P1-2 | Alerts and protected ops status | Implemented; delivery pending | Unauthorized rejection; forced failure received within five minutes; redaction verified |
| P1-3 | Merchant-photo first frame; ten-second default; saved motion prompt; approval cost display | Implemented; provider acceptance pending | Mock payload assertions and approved capped real run showing photo fidelity, duration and recovery |
| P1-4a | Signed raw webhooks; timestamp/replay checks; durable receipts; polling recovery | Implemented; hosted provider acceptance pending | Forgery, duplicate, missed callback and expiry recovery checks |
| P1-4b | Actual-charge reconciliation and ops report | Blocked on billing evidence | Invoice/charge feed or approved manual process; do not treat usage estimates as actual charges |
| P1-5 | Private expiring links; background ZIP; category downloads and caption files | Implemented in part; hosted acceptance pending | Confirm caption inclusion; cross-workspace denial; expiry; full-video ZIP; mobile and cancellation tests |
| P1-6a | Privacy, terms, cancellation/refunds and AI notice | Draft implemented | Confirm operator, controlled support contact, retention and refund terms; check footer/signup links |
| P1-6b | Idempotent account/data deletion | Implemented; disabled pending acceptance | Disposable hosted account cleanup across database, storage, Auth and provider; session and isolation checks |
| P1-6c | Certification evidence; claims and deterministic overlay checks | Implemented; human review pending | Unsupported claims blocked; no invented offers; human review of generated images and certification marks |
| P1-7 | Separate live project and cutover runbook | Runbook prepared | Reviewed runbook; backup/restore and rollback rehearsal; separately approved cutover |
| P1 gate | Hosted signup → brief → approval → nine mock assets → download | In progress | Hosted confirmation, reset and returning login; two-workspace isolation; complete mock campaign; alerts acceptance |
| P2-1a | Per-asset quality checklist before export | Pending | Offer/price, claims, logo, safe area, caption and landing URL checks; revisions invalidate approval |
| P2-1b | Burned-in captions and SRT; deterministic text/price/CTA/logo | Pending | Caption output files; timing and mobile legibility; export stays blocked until approval |
| P2-2 | Optional premium product-photo image preset | Pending; feature flag off | Verify current provider capability; estimate before approval; separate credits; eligible-photo checks and fallback |
| P2-3 | Server pricing config; SGD price; video regeneration cap | Pending | Agreed currency/price; period and credit costs; default cap proposal of eight; renewals, cancellation and duplicate-event tests |
| P2-4 | Postgres funnel events and asset rating | Pending | Signup, verification, brief saved, approval, checkout, download and second campaign; yes/with-edits/no rating; privacy and deduplication |
| Pilot | 10–15 consenting Humble Halal merchants | Pending after acceptance and spend approval | Counts, cohort dates, creative quality, costs, payment conversion, repeat usage and feedback |
| P3-1 | Manual Ad Evidence Board | Validate first | Competitor deep links; URL/screenshot intake; untrusted-input defenses; sourced pattern cards; workspace ownership; PDF/CSV test plan |
| P3-1 ranking | Evidence strength and uncertainty | Validate first | Transparent components; no implication that frequency or longevity proves performance |
| P3-2 | Apify adapter and bounded automated retrieval | Conditional, not approved to activate | Legal clearance and pilot demand; recheck Actor capability/pricing; run/ monthly limits; webhook/poll recovery; deduplication; safe private media handling |
| P3-3 | Refresh alerts, Meta Insights, fatigue observations | Deferred | Separate scope decision after core pilot and research validation |

## Design requirements carried forward

Keep Instrument Serif and Geist, paper/graphite/yellow styling, keyboard access, reduced motion and layouts down to 360 px. Verify readable contrast, clear progress/error states and mobile preview/export behavior. Source video safe-area percentages are starting assumptions; verify against the selected placement before release.

## Commercial assumptions to validate

The source proposes S$49 for 300 credits, eight video regenerations per month, and a separately priced research add-on. These are hypotheses, not approved prices. Recalculate margins using actual provider charges, writing, retries/failures, storage, delivery and payment processing. Recheck all quoted provider prices before implementation; do not enforce a fixed credit price for premium video without cost evidence.

Pilot targets from the source:

| Measure | Target |
| --- | --- |
| URL to approved kit | Median ≤20 minutes |
| Brief fields accepted unchanged | ≥80% |
| Assets rated would publish | ≥5 of 9 per kit |
| Halal or unsupported-claim errors | Zero observed; report incidents explicitly |
| Second campaign within 30 days | ≥50% |
| Pays after free first kit | ≥30% |
| Paid customers requesting evidence board | ≥25% |

Always show numerator, denominator and observation window alongside percentages. If paid conversion is below target, investigate price, niche and creative usefulness before automating research.

## Excluded scope

Do not build winning-ad scores, copying competitor creative, logged-in scraping or unlimited plans. Do not offer higher-resolution/audio video at existing low credit prices without validated economics and approval.

## Execution order

1. Hosted authentication and campaign acceptance.
2. Alerts, download privacy/recovery and disposable deletion acceptance.
3. Legal/contact/provider decisions and capped real-output acceptance.
4. Phase 2 review controls, captions, pricing configuration and measurement.
5. Approved paid pilot and cohort report.
6. Manual evidence-board validation; only then decide on automation.

Maintain completion evidence in `GAME_PLAN_PROGRESS.md` and the concise goal checklist in `COMPLETION_GOAL.md`. Do not reimplement completed Phase 1 features.
