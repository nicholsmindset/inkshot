# Inkshot infrastructure

The GitHub repository is private. GitHub Actions runs tests and a production frontend build on pushes and pull requests. Vercel hosts the frontend preview and uses the native GitHub integration for subsequent deployments.

## Current deployment boundary

The hosted frontend is a preview, not an operational paid SaaS. API calls return a deliberate JSON 503 until the hosted backend is connected. This avoids running the local embedded database and FFmpeg worker on ephemeral serverless instances. Local `npm run dev` continues to provide the functioning sample studio.

Next integration work:

1. Connect the runtime to Inkshot Supabase project `smpdzhxydnctiyjqojmp`. Its 11 tables and two private buckets are created and verified via the signed-in dashboard; all tables have RLS, with no anon/authenticated grants. Connector access still needs the correct organization.
2. Configure managed authentication, tenant-isolated database access, and private object storage.
3. Host the durable generation worker with FFmpeg and connect the authenticated API.
4. Set server-only Higgsfield, Anthropic, and Stripe sandbox credentials; verify generation quotes and signed payment events before live billing.
5. Replace the temporary API adapter and rewrite, test complete customer flows, and remove the preview noindex header when ready to launch.

Never commit `.env`, `.vercel`, generated customer media, or API credentials. Do not add secret keys with a `VITE_` prefix.

## Verified infrastructure — 1 October 2026

- Private repository: https://github.com/nicholsmindset/inkshot
- Vercel project: https://vercel.com/nicholsmindset-gmailcoms-projects/inkshot
- Hosted frontend preview: https://inkshot-omega.vercel.app
- Native Vercel GitHub integration connected. Initial GitHub Actions build/test run passed.
- Supabase schema applied through SQL Editor; verification returned 11 tables, 11 with RLS, zero client grants, two private buckets. Local migration file records the equivalent schema; dashboard SQL execution does not register CLI migration history.

## Integration verification update — 1 October 2026

- Added the twelfth table, `provider_spend`, with RLS and no client-role grants.
- With explicit user approval, created `inkshot_app`, limited to CRUD on the twelve application tables. It cannot create roles/databases, bypass RLS, or act as superuser. This is a trusted server role; application queries enforce workspace ownership.
- Saved its connection string in private `.env`. Verified an authenticated query through the transaction pooler with TLS certificate and hostname validation. The public CA file in `server/certs/supabase-ca.crt` came from the project's Database Settings certificate link.
- A local worker using real Higgsfield generation and Supabase private storage completed three videos and six images. `outputs/live-kit.zip` contains nine assets and captions. The provider estimate reservations total $3.834; this is not reconciled spend and excludes AI writing and infrastructure. Sample concepts were used because OpenRouter returned insufficient-credit errors.
- Thirteen local tests and the TypeScript/frontend production build pass.
- These integration changes are not yet deployed. Managed-auth URL configuration, hosted worker validation, Stripe sandbox checkout/webhook verification and a complete hosted customer flow remain outstanding. OpenRouter funding remains required for real campaign writing.
