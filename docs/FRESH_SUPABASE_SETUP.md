# Fresh Inkshot Supabase setup

Verified 19 November 2026 against project `zdvniqffhiycyxxzchmi`, name `inkshot`, region `ap-southeast-1`. The owner explicitly authorised starting fresh on this project. The old project and the deployed site were not changed.

## Completed

- Confirmed the project was healthy and empty: no application tables, Auth users, storage objects or buckets before provisioning.
- Applied the nine existing application migrations, then the runtime-access migration below. The hosted runner assigns versions at application time; use this mapping instead of assuming the historical source filenames match the new project's migration history.
- Verified 15 application tables with RLS enabled. `anon` and `authenticated` have no table read/write privileges. Workspace isolation continues to be enforced in the server: the direct server runtime role can operate across workspaces and must never be exposed through browser credentials.
- Verified `campaigns.draft`, `versions.motion_prompt` and all shared rate-limit columns/types.
- Created four private buckets from the existing migrations: `brand-uploads`, `generated-media`, `inkshot-live-brand-uploads`, `inkshot-live-generated-media`. The latter pair supports the existing shared-project path and is currently unused; this project uses `public` with the default bucket pair.
- Created unprivileged `inkshot_app` with no login/password, no elevated capabilities, and no inherited role memberships. It has CRUD only on the 14 application data tables and read-only access to the environment marker.
- Removed public and signed-in execution grants from the existing `rls_auto_enable()` event-trigger function without disabling the trigger.
- Supabase security advisor returned zero findings after provisioning. This is not certification of the entire application or a paid-launch approval.
- Environment marker remains `sandbox`; no Auth users, workspaces, credits, Stripe activity or provider generations were created.

| Hosted version | Migration name | Source version |
| --- | --- | --- |
| 20261119142857 | inkshot_foundation | 20261001090000 |
| 20261119142911 | managed_services | 20261001091742 |
| 20261119142919 | capped_allowance | 20261113090000 |
| 20261119142926 | provider_receipts | 20261113093000 |
| 20261119142933 | deployment_environment | 20261114140000 |
| 20261119142940 | writing_limits | 20261114150000 |
| 20261119142947 | live_media_buckets | 20261115090000 |
| 20261119142955 | campaign_planning | 20261119090000 |
| 20261119143132 | shared_rate_limits | 20261119100000 |
| 20261119143158 | inkshot_runtime_access | 20261119143158 |

The local Supabase CLI was terminated by the execution environment before it could create a migration file. The hosted migration runner generated `20261119143158`; the matching SQL is saved under that returned version in the repository. Do not blindly replay the historical filenames with CLI push: first reconcile migration history against the mapping above, read-only, and confirm the intended target project.

## Preview setup completed — 20 November 2026

Vercel access is restored. `inkshot_app` now has a generated login credential, no superuser or RLS-bypass privileges, and an encrypted branch-specific Preview connection. Matching Supabase keys, exact preview origin and storage/auth providers are configured. `BILLING_MODE=off`, `GENERATION_MODE=mock`, and paid generation/checkout remain disabled.

The four subsequent Phase 1 migrations (photo-first video, exports, provider events and account deletion) were applied. New tables have RLS enabled and runtime grants. Hosted preview deployment `dpl_EzL7W6NpotnLtEoeKiypa22DfsM4` passed startup and health checks.

## Remaining acceptance

1. Verify the exact preview callback and recovery URLs in Auth, confirmation settings and `supabase/templates/confirmation.html`. Prove delivery using a controlled test mailbox.
2. Complete hosted signup, confirmation, returning login, recovery, session and export isolation checks. New accounts start fresh with zero credits; grant only explicit disposable sandbox test credits for mock campaign acceptance. Old users and workspaces were not transferred.
3. Verify the newly configured Preview worker secret after redeployment. Keep deletion and provider callbacks disabled until their acceptance checks pass.
4. Plan live activation separately. `scripts/bind-live-project.sql` refuses a populated project. Preserve a clean live target; do not delete test/user data to bypass this guard without approval.

## Validation

`tests/fresh-project-setup.test.ts` applies all migrations to disposable PostgreSQL, checks RLS/role privileges and private buckets, verifies repeatability, confirms anonymous/signed-in reads are denied, exercises server CRUD, refuses runtime marker writes/truncation, and checks the shared live schema remains isolated. No provider calls or hosted customer data are needed.
