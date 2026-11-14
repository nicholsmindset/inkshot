# Inkshot production audit — 3 October 2026

**Decision: keep the public deployment in preview mode.** It is a working, hosted product preview, but accepting real subscription payments now would promise live creative output that the hosted app cannot yet deliver. This audit checks the customer path from website URL through identity, brief, generation, private media, billing, and export. It distinguishes code readiness from an actual paid launch.

## Verified boundaries

| Boundary | Evidence | Result |
| --- | --- | --- |
| Public/API | Hosted `/api/health` returned 200 in `mock` mode. Anonymous `/api/studio` and unsigned `/api/cron/worker` returned 401. | Working preview |
| Database | All 12 Inkshot tables in the existing Supabase project have RLS enabled; `anon` and `authenticated` have zero grants on those tables. The server uses the scoped database login. | Verified |
| Identity | Hosted Supabase Auth sign-in and workspace provisioning were exercised in the earlier hosted test. The UI lacks password recovery and account deletion flows. | Partial |
| Website import | Public HTTPS pages are fetched server-side with DNS pinning, private-address rejection, redirect and size limits. The customer sees extracted copy and must review before saving. | Verified, with an eight-reads-per-minute guard added in this audit |
| Media | Both Supabase buckets (`brand-uploads`, `generated-media`) are private. Hosted mock media export and ZIP download passed the previous end-to-end test. The local Higgsfield ZIP passes archive integrity checks. | Mock hosted and live local verified; live hosted still unverified |
| Higgsfield | Authenticated estimates for the configured 1080p image and 15-second video settings returned $0.006 and $1.260 respectively on this account. Nine images plus three videos estimate **$3.834 per kit** before retries, writing, rendering, storage, support and payment fees. | Estimate only; reconciled cost and production output quality unverified |
| Writing | OpenRouter credits endpoint returned $71.15 total credits against $71.310699305 usage, leaving a negative balance. Live brief and concepts cannot currently be trusted to complete. | **Blocked** |
| Billing | The existing $39 USD monthly Stripe price and signed webhook are active in **test mode**, with all seven relevant events subscribed. Prior hosted sandbox checkout granted exactly 300 credits once. No live Stripe key, price or webhook is configured. | **Sandbox only** |
| Dependencies/CI | `npm audit --omit=dev` returned zero reported vulnerabilities. Local tests and production build passed after audit changes. | Verified at audit time |

The Supabase advisor endpoints returned a permission error for this account, so automated security and performance advisor findings remain unchecked. The table grants, RLS settings and bucket privacy above were verified independently; an owner should run the advisors before launch.

## Changes made in this audit

- Added a fail-closed hosted launch check: live billing and live generation must be enabled together. Live mode also requires managed identity, private storage, a database, Higgsfield credentials, writing credentials, a positive provider spending limit, a live Stripe key, live price/webhook settings, and an HTTPS origin.
- Prepared Stripe billing to distinguish test and live keys, prices and webhook events. The currently deployed test configuration remains the default; no live charge is enabled by this code change.
- Updated billing and settings labels so a future live deployment does not describe genuine subscriptions as a sandbox. Removed claims about paid top-ups, which are not implemented, and hid the nonfunctional hosted sample-studio button.
- Added a stricter website-reader request limit and tests for billing environment mismatches.

## Release blockers, in order

1. **Fund and verify writing.** Replenish OpenRouter or configure a funded Anthropic account. Rotate the OpenRouter credential shared in chat before launch. Run a real hosted website-to-brief and campaign-concept test; check factual accuracy and model cost. Do not place credentials in client variables or the repository.
2. **Isolate live customers from sandbox data.** The current Supabase project holds test accounts, mock campaigns and sandbox credits. Use separate production Supabase and Vercel environments, or complete a reviewed migration that removes test entitlements before setting `BILLING_MODE=live`. Reusing sandbox customer IDs or preview credits for paying customers is unsafe.
3. **Provision live Stripe Billing.** Create an active $39 USD/month live Price, a live webhook to `/api/webhooks/stripe`, and a minimal-permission live API key. Verify checkout, invoice-paid credit grants, renewal, failed payment, cancellation, portal and duplicate/out-of-order events. Use Stripe sandbox for payment tests, including failures and retries. Verify the first genuine customer order during the live pilot. [Stripe testing guidance](https://docs.stripe.com/testing). Review tax registrations before enabling Stripe Tax; [Stripe's go-live checklist](https://docs.stripe.com/get-started/checklist/go-live) and [subscription tax guide](https://docs.stripe.com/billing/taxes/collect-taxes) apply.
4. **Complete one hosted live kit under a spending cap.** Verify three genuine 15-second videos, six images, overlays, private storage, all nine authenticated media URLs, ZIP export, failure refunds and provider-spend reconciliation. Load-test the serverless media download and ZIP path with full-size videos; it currently downloads private objects into temporary storage per request. Confirm the Higgsfield account has enough funds for the test and expected customer volume. Higgsfield says outputs may be removed after seven days, so retaining copies in private storage remains necessary ([billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention)).
5. **Finish customer controls and operations.** Add password recovery, account/data deletion request, backup and restore testing for database plus objects, retention policy, alerting for stuck jobs and failed webhooks, support contact, privacy policy, terms and a reviewed refund/cancellation policy. Verify the rights and permitted commercial use of generated and uploaded media.
6. **Close product-promise gaps.** Campaign concepts are shown for approval but not editable; post captions are assembled from the brand description; uploaded product photos are not yet a verified reference for live generations. Do not promise editable prompts, accurate product likeness, paid top-ups, or one-click posting until implemented and tested. The marketing site should remain `noindex` until release review.

**Cloudinary:** Not required for this release. Inkshot already stores original and rendered assets privately in Supabase and serves them through authenticated routes. Evaluate Cloudinary later if image/video transformation, adaptive streaming or public CDN delivery becomes a measured need; its [developer overview](https://cloudinary.com/documentation/cloudinary_developer_get_started) describes those features. Adding it now would duplicate the storage boundary and increase cost and vendor exposure.

Production activation is an explicit environment change after the above checks: set `GENERATION_MODE=live`, `ALLOW_LIVE_GENERATION=true`, `BILLING_MODE=live`, `ENABLE_BILLING_SANDBOX=false`, and matching funded provider/live Stripe settings in the isolated production environment; deploy, smoke-test, then remove `noindex`. Until then, the hosted preview must keep its current mock/sandbox settings.
