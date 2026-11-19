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

## Remaining before the app can use this project

1. Browser access to the existing `inkshot-live` project is now working. The Vercel connector still cannot see the project; use the connected browser, without recreating it.
2. Provision a strong password and enable login for `inkshot_app` through the dashboard/secure secret workflow. Put the resulting pooler connection in the intended preview's `DATABASE_URL`. Never use the database owner connection as the app runtime or commit/share credentials in chat.
3. Add the matching `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to the same preview branch scope as the settings below. Keep `BILLING_MODE=off`; no Stripe credentials or paid-provider credentials are required for this setup check.
4. Set the exact HTTPS `APP_ORIGIN`, allow that origin's `/api/auth/callback` and `/api/auth/recovery-callback` in Auth, enable confirmation, and apply `supabase/templates/confirmation.html`. Verify sender ownership, real delivery and recovery behaviour.
5. Deploy a preview of the reviewed branch and complete the hosted account/export checks in `LAUNCH_CHECKLIST.md`. New accounts will start fresh; old credentials and old workspaces have not been transferred.
6. Plan live activation separately. `scripts/bind-live-project.sql` refuses a populated project, so do not run acceptance fixtures in a database that must subsequently be bound as fresh live without first deciding how test identities/data will be handled. Prefer disposable acceptance environments and preserve a clean live target; never delete user records to bypass this guard without explicit approval.

## Validation

`tests/fresh-project-setup.test.ts` applies all migrations to disposable PostgreSQL, checks RLS/role privileges and private buckets, verifies repeatability, confirms anonymous/signed-in reads are denied, exercises server CRUD, refuses runtime marker writes/truncation, and checks the shared live schema remains isolated. No provider calls or hosted customer data are needed.

## Browser inspection and preview configuration — 19 November 2026

Inspected failed preview `HiwTtLGmrv2vQ9hw1EpVorEqH62F`, commit `a92dd2b`. The build stopped at the configuration preflight with `Missing APP_ORIGIN in this deployment environment`. The dashboard initially listed Production-only config and no linked shared variables. Searches found no `DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_SECRET_KEY`. Production `GENERATION_MODE` was `mock`, `ENABLE_BILLING_SANDBOX` was `false`, and there was no `BILLING_MODE` override. No secret values were revealed.

Saved the following config only for Preview branch `inkshot/fresh-project-setup`:

| Variable | Value |
| --- | --- |
| APP_ORIGIN | https://inkshot-live-git-inksh-c3d103-nicholsmindset-gmailcoms-projects.vercel.app |
| AUTH_PROVIDER | supabase |
| STORAGE_PROVIDER | supabase |
| SUPABASE_URL | https://zdvniqffhiycyxxzchmi.supabase.co |
| INKSHOT_SHARED_PROJECT_LIVE | false |
| GENERATION_MODE | mock |
| ALLOW_LIVE_GENERATION | false |
| BILLING_MODE | off |
| ENABLE_BILLING_SANDBOX | false |
| ENABLE_LIVE_CHECKOUT | false |

Vercel confirmed successful saving. Production settings and deployment were not modified. No redeploy was started because the three required connection values remain missing. The saved settings take effect on the next deployment; hosted signup/login has not passed yet.
