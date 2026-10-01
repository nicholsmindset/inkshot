# Inkshot infrastructure

Inkshot is in a private [GitHub repository](https://github.com/nicholsmindset/inkshot), deployed to [Vercel](https://vercel.com/nicholsmindset-gmailcoms-projects/inkshot) at [inkshot-omega.vercel.app](https://inkshot-omega.vercel.app). GitHub Actions runs the tests and production build on pushes and pull requests. Vercel hosts the frontend and authenticated API; a scheduled Vercel function drains generation jobs. The site remains `noindex` until launch.

## Verified on 1 October 2026

- Supabase project `smpdzhxydnctiyjqojmp` holds 12 application tables and two private media buckets. The tables have RLS and no client-role grants. The trusted server uses a scoped `inkshot_app` login, TLS certificate and hostname verification, and application-level workspace checks.
- Supabase Auth redirects allow the hosted callback and the two local callbacks. Hosted sign-in created and loaded a disposable test workspace.
- A homepage website URL now starts a server-side read automatically after sign-in. The reader fetches only public HTTPS pages, prioritizes main-page copy, and returns an editable draft; nothing is saved until the customer reviews it.
- Vercel serves `/api/health` with 200. Unauthenticated `/api/studio` and unsigned `/api/cron/worker` return 401. The production deployment uses `GENERATION_MODE=mock` and `ALLOW_LIVE_GENERATION=false`.
- Stripe is configured **only in sandbox** with a $39/month Studio test price and webhook. A disposable account completed test checkout and received exactly 300 credits through the hosted billing flow. No real payment was collected.
- The disposable hosted campaign spent 100 test credits and completed three sample videos, three image ads, and three posts. Its ZIP download returned 200 with all nine assets, captions, and a sample notice. A guard now refuses to run a managed-database worker without private cloud storage.
- A local, budget-capped Higgsfield integration completed three videos and six images, stored in private Supabase storage. The kit is in ignored `outputs/live-kit.zip`. Provider estimate reservations total $3.834; that is not reconciled spend and excludes writing and infrastructure.
- Thirteen local tests, the TypeScript/frontend build, and the latest GitHub Actions run passed.

## Launch boundary

The hosted app is still a **preview**, despite its working auth, storage, API, sample media export, and Stripe sandbox. Real campaign writing is unavailable because the configured OpenRouter account returned HTTP 402 for insufficient credit. Live generation remains disabled until writing, model pricing, provider budget accounting, full hosted live-media export, and paid billing are validated. Do not promote the Stripe sandbox configuration to live or remove `noindex` before those checks.

Private credentials belong in ignored `.env` and Vercel server-only environment variables. Never commit `.env`, `.vercel`, generated customer media, or API keys; do not use a `VITE_` prefix for secrets.
