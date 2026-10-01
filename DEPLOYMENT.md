# Inkshot infrastructure

The GitHub repository is private. GitHub Actions runs tests and a production frontend build on pushes and pull requests. Vercel hosts the frontend preview and uses the native GitHub integration for subsequent deployments.

## Current deployment boundary

The hosted frontend is a preview, not an operational paid SaaS. API calls return a deliberate JSON 503 until the hosted backend is connected. This avoids running the local embedded database and FFmpeg worker on ephemeral serverless instances. Local `npm run dev` continues to provide the functioning sample studio.

Next integration work:

1. Restore connector access to the existing Inkshot Supabase project `smpdzhxydnctiyjqojmp`.
2. Configure managed authentication, tenant-isolated database access, and private object storage.
3. Host the durable generation worker with FFmpeg and connect the authenticated API.
4. Set server-only Higgsfield, Anthropic, and Stripe sandbox credentials; verify generation quotes and signed payment events before live billing.
5. Replace the temporary API adapter and rewrite, test complete customer flows, and remove the preview noindex header when ready to launch.

Never commit `.env`, `.vercel`, generated customer media, or API credentials. Do not add secret keys with a `VITE_` prefix.
