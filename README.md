# Inkshot

A small-business ad studio built from the Inkshot PRD and the revised SaaS plan. The agreed launch offer is **$39 USD/month for 300 credits, enough for three nine-asset kits**, with additional generations paid separately. Checkout is not active in this build.

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

- Password-based accounts with salted scrypt hashes and opaque, hashed, HTTP-only server sessions.
- Account-isolated brands, photo uploads, campaigns, versions, files and credit ledgers.
- Reading public HTTPS webpages, up to four pages, with pinned DNS resolution, private-IP rejection, redirects and response-size limits.
- Editable brand brief, sources, campaign goals and three campaign concepts.
- Approval before spending credits. One kit reserves exactly 100 preview credits and creates nine asset jobs.
- Durable PostgreSQL-backed jobs with leases and retries, independent of browser lifetime.
- Three sample MP4s, three image ads and three organic post images with captions.
- Rendered headlines and CTAs in the downloaded media, rather than browser-only overlays.
- Free text-edit versions, credit-priced sample regenerations, retained originals and version selection.
- Private per-asset downloads and ZIP downloads with captions and a sample disclosure.
- Credit usage history, $39 plan presentation, responsive layouts and reduced motion.

## Honest preview boundaries

This is a working development build, not a production launch. `GENERATION_MODE=mock` is the default. Sample outputs reuse an original AI-created candle photograph, or the customer's uploaded photo. Sample videos are five-second still-image MP4s, not Higgsfield motion. Mock revisions demonstrate the versioning workflow and do not interpret creative-direction notes. These limits are disclosed in the interface and sample downloads.

No subscription is active, no payment details are collected, and no paid generation calls are made in mock mode. Accounts receive 300 preview credits. Those credits have no monetary value. Paid top-ups are not configured; the build does not invent a top-up price.

The adapters for Claude brief/concept writing and Higgsfield image/video submission, polling and estimates are implemented but not account-tested. Live campaign creation is deliberately disabled in the API until account-level model validation, quotes and spending limits are completed. Setting environment keys alone does not silently enable paid generation.

`NODE_ENV=production` currently refuses startup. Remove that gate only after the launch requirements below have been implemented and tested.

## Architecture and storage

- React, TypeScript, Vite and local font assets.
- Separate Express API; no Vite dev-server API plugin.
- PostgreSQL schema in `server/schema.sql`. Local development uses PGlite persisted in `data/postgres`; `DATABASE_URL` switches the adapter to hosted PostgreSQL using `pg`.
- Durable job rows, credit transactions, workspace ownership checks and provider checkpoint records.
- Private local media in `data/media` and uploads in `data/uploads`, available only through authenticated API routes.
- Sharp renders image exports; FFmpeg renders video overlays and MP4 sample files.
- Server-only secrets. API responses do not include filesystem paths, passwords, provider credentials or session tokens.

Local PGlite is single-process. Do not run multiple API processes against the same local data directory. Production PostgreSQL permits separate API and worker processes, but the worker entrypoint and distributed provider concurrency control still need to be extracted and implemented. Current concurrency is process-local.

Media has a storage boundary in the API but currently uses local disk. Durable private cloud object storage is still required for hosted deployment. Back up both the database and media together; database backup alone does not preserve exports.

## Before accepting paying customers

1. Configure and validate Higgsfield and Claude accounts using server environment variables; never paste secrets into client code or chat. Confirm exact model bodies, portrait video output, durations, actual costs and product-photo fidelity.
2. Implement authenticated quotes and a per-workspace/provider dollar spending cap. Store estimates and reconciled provider spend separately from customer credits. Validate live retry, cancellation, output download and refund semantics.
3. Select a managed identity provider or finish email verification, password recovery, session/account lifecycle and abuse controls for the existing authentication implementation.
4. Add private cloud object storage, short-lived provider input URLs, backups and retention/deletion jobs.
5. Add Stripe Checkout and signed, deduplicated webhook fulfillment for the $39 subscription and approved top-up prices. Allocate credits after verified payment, never from the success URL. Add cancellation and customer portal handling. Use a dedicated sandbox first.
6. Validate source-photo/reference support before promising accurate product generation. Keep keyframe approval before video spend where product likeness matters.
7. Add live visual review, keyframe reuse for video revisions, editable captions/crops and additional brand templates. Current mock review notes are stored but not interpreted.
8. Add globally bounded workers, provider reconciliation, operations tooling and alerting. Recover copy/export failures independently of regeneration.
9. Check the provider's commercial-use terms, privacy disclosures, upload permissions and customer support process. Replace preview claims with measured production behavior.
10. Reassess the three-kit allowance with measured all-in costs. The $39 plan is agreed product positioning, not a claim about verified margins.

## Verification

`tests/core.test.ts` covers authentication boundaries, cross-origin mutations, password hashing, SSRF address rejection, isolated workspaces, duplicate kit requests, exact credit allocation, idempotent refunds, overdraft prevention and session invalidation. Browser verification covers sample onboarding, campaign approval, nine completed sample assets, revisions, downloads and responsive layouts.

## Sample asset provenance

`public/examples/candle.png` was created with the built-in image-generation tool for this project. It represents a fictional candle business and is labelled sample content throughout the app. Prompt: “Create a single photorealistic editorial product photograph for a fictional small artisan candle studio sample campaign. Portrait composition. One unbranded warm ivory ceramic candle with a tiny natural flame resting on a pale travertine table, beside a subtle olive branch and softly draped natural linen, soft afternoon sunlight and lovely architectural shadows across a muted warm plaster wall. Extremely tasteful independent lifestyle magazine photography, tactile materials, 50mm lens, natural color. Main candle centered in lower middle with generous negative space in upper third for text to be added by software. No text, no logos, no UI, no watermark.”

The original planning document is `inkshot-saas-plan.md`. This README records what the first implementation actually supports and what remains before launch.
