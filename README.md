# Inkshot

A small-business ad studio built from the Inkshot PRD and the revised SaaS plan. The planned launch offer is **$39 USD/month for 300 credits, enough for three nine-asset kits**. The hosted app is currently a preview with Stripe test checkout. See [DEPLOYMENT.md](DEPLOYMENT.md) for infrastructure and [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md) for the launch decision.

## Run locally

Requirements: Node 22+, npm and FFmpeg on PATH.

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:5173 and choose **Explore the sample studio**, or create an account. No API keys are needed for preview mode. FFmpeg is used for actual downloadable MP4 sample exports.

```sh
npm run build
npm test
```

`npm start` serves the built frontend and API on port 3001. Keep the server running to process jobs. The current local server binds to loopback.

## What works

- Supabase Auth for hosted accounts, with isolated workspaces. Local development can use salted scrypt hashes and opaque HTTP-only sessions.
- Account-isolated brands, photo uploads, campaigns, versions, files and credit ledgers.
- Reading public HTTPS webpages, up to four pages, with pinned DNS resolution, private-IP rejection, redirects and response-size limits.
- Editable brand brief, sources and campaign goals, with three campaign concepts for review.
- Approval before spending credits. One kit reserves exactly 100 preview credits and creates nine asset jobs.
- Durable PostgreSQL-backed jobs with leases and retries, independent of browser lifetime.
- Three sample MP4s, three image ads and three organic post images with captions.
- Rendered headlines and CTAs in the downloaded media, rather than browser-only overlays.
- Free text-edit versions, credit-priced sample regenerations, retained originals and version selection.
- Private per-asset downloads and ZIP downloads with captions and a sample disclosure.
- Credit usage history, $39 plan presentation, responsive layouts and reduced motion.

## Honest preview boundaries

This is a working hosted preview, not a paid production launch. `GENERATION_MODE=mock` is the default. Sample outputs reuse an original AI-created candle photograph, or the customer's uploaded photo. Sample videos are five-second still-image MP4s, not Higgsfield motion. Mock revisions demonstrate the versioning workflow and do not interpret creative-direction notes. These limits are disclosed in the interface and sample downloads.

Hosted checkout is in Stripe test mode: no real payment is collected. Test subscription invoices grant 300 preview credits; new hosted accounts otherwise start with zero. Local mock accounts receive 300 preview credits. Paid top-ups are not configured.

Higgsfield image/video generation completed a locally budget-capped kit, and the hosted mock flow completed a nine-asset ZIP. The live hosted writing/generation flow remains disabled because the configured OpenRouter account needs funding and live output/billing still needs verification. Setting environment keys alone does not enable paid generation.

The hosted Vercel functions run with managed Supabase services; the standalone local server still refuses production startup. Hosted live billing and live generation are guarded to activate together.

## Architecture and storage

- React, TypeScript, Vite and local font assets.
- Separate Express API; no Vite dev-server API plugin.
- PostgreSQL schema in `server/schema.sql`. Local development uses PGlite persisted in `data/postgres`; `DATABASE_URL` switches the adapter to hosted PostgreSQL using `pg`.
- Durable job rows, credit transactions, workspace ownership checks and provider checkpoint records.
- Local media in `data/media`; the hosted deployment persists customer files to private Supabase Storage buckets and serves them through authenticated API routes.
- Sharp renders image exports; FFmpeg renders video overlays and MP4 sample files.
- Server-only secrets. API responses do not include filesystem paths, passwords, provider credentials or session tokens.

Local PGlite is single-process. Do not run multiple API processes against the same local data directory. The hosted deployment uses PostgreSQL and a scheduled Vercel worker. Provider requests have a global database-backed daily dollar reservation, but reconciliation and alerting remain launch work.

Back up both the database and private media buckets; a database backup alone does not preserve exports.

## Before accepting paying customers

The ordered blockers, evidence and activation sequence are in [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md). Most urgently, fund and validate the writing provider, isolate production data from test credits, provision live Stripe Billing, complete a hosted live kit, and finish account recovery, data deletion, policies, backups and operational monitoring.

## Verification

`tests/core.test.ts` covers authentication boundaries, cross-origin mutations, password hashing, SSRF address rejection, isolated workspaces, duplicate kit requests, exact credit allocation, idempotent refunds, overdraft prevention and session invalidation. Browser verification covers sample onboarding, campaign approval, nine completed sample assets, revisions, downloads and responsive layouts.

## Sample asset provenance

`public/examples/candle.png` was created with the built-in image-generation tool for this project. It represents a fictional candle business and is labelled sample content throughout the app. Prompt: “Create a single photorealistic editorial product photograph for a fictional small artisan candle studio sample campaign. Portrait composition. One unbranded warm ivory ceramic candle with a tiny natural flame resting on a pale travertine table, beside a subtle olive branch and softly draped natural linen, soft afternoon sunlight and lovely architectural shadows across a muted warm plaster wall. Extremely tasteful independent lifestyle magazine photography, tactile materials, 50mm lens, natural color. Main candle centered in lower middle with generous negative space in upper third for text to be added by software. No text, no logos, no UI, no watermark.”

The original planning document is `inkshot-saas-plan.md`. This README records what the first implementation actually supports and what remains before launch.
