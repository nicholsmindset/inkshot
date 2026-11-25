# Inkshot production cutover

One numbered checklist. **You (the owner) run every step marked OWNER.** Nothing here has been executed. Names of variables only: never paste secret values into chat, a PR or a committed file. Record identifiers (project refs, deployment IDs), not secrets, in the release record at the bottom.

Prerequisites: PR #37 content merged; the hosted preview journey passed (LAUNCH_CHECKLIST.md gates 1, 4, 5); `docs/OWNER_DECISIONS.md` has no UNSET rows you still need (support email, price, regeneration cap, refund policy, alert destination).

## A. Safety facts to read first

- **A live-bound database cannot be run with the "off" switches.** The app derives its mode from `BILLING_MODE` / `GENERATION_MODE`, requires them to match (`LIVE_MODE_MISMATCH`), and refuses a live-marked database unless it runs live. Setting `BILLING_MODE=off`, `GENERATION_MODE=mock` or `ALLOW_LIVE_GENERATION=false` on the live project therefore stops the app from **starting** (`LIVE_PROVIDER_REQUIRED` or an environment refusal). They are rehearsal switches, not rollback switches. Use section H.
- `GENERATION_PAUSED=true` is the safe pause: new campaign approval and regeneration are refused with a clear message, credits untouched, the app stays up and in-flight work finishes.
- `ENABLE_LIVE_CHECKOUT=false` closes new subscriptions without touching generation.
- `scripts/bind-live-project.sql` refuses a populated project. Never edit the environment marker by hand.

## B. Create the live Supabase project (OWNER)

1. Supabase dashboard: new project, region Singapore (`ap-southeast-1`), strong DB password in your password manager. Note the 20-character project ref. Do not reuse `zdvniqffhiycyxxzchmi` unless it is empty (count users, workspaces, payment events, provider spend, storage objects first) and you want it live.
2. Install tooling once: `psql` (PostgreSQL client).

## C. Apply the migrations in order (OWNER)

Use the project's **direct** admin connection string as `ADMIN_DATABASE_URL` (shell variable only, not committed).

```bash
for f in supabase/migrations/*.sql; do echo "== $f"; psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break; done
```

Expect `COMMIT` per file and no `ERROR`. Order is the filename order: foundation, managed_services, capped_allowance, provider_receipts, deployment_environment, writing_limits, live_media_buckets, campaign_planning, shared_rate_limits, inkshot_runtime_access, photo_first_video, campaign_exports, provider_events, account_deletion, launch_safeguards, **pilot_access, product_events, campaign_copy**. (The last three are not covered by the startup guard; the preflight in section I checks all three.)

Bind the project to live (only on an empty project):

```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v project_ref=<YOUR_20_CHAR_REF> -f scripts/bind-live-project.sql
```

Expect `COMMIT`. `Refusing to bind a populated project` means stop and investigate.

## D. Runtime role, buckets and RLS checks (OWNER)

1. Give the unprivileged `inkshot_app` role a login password (generated, stored in the password manager only):

```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER ROLE inkshot_app WITH LOGIN PASSWORD '<GENERATED>'"
```

2. Build the runtime `DATABASE_URL` from the **pooler** connection with user `inkshot_app.<ref>` (Supabase dashboard > Connect). This is the only DB URL that goes in Vercel; the admin URL never does.
3. Verify (expect the stated result):

```bash
psql "$ADMIN_DATABASE_URL" -c "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT relrowsecurity"   # expect 0 rows
psql "$ADMIN_DATABASE_URL" -c "SELECT id, public FROM storage.buckets"   # brand-uploads and generated-media present, public = f
psql "$ADMIN_DATABASE_URL" -c "SELECT mode, project_ref FROM inkshot_environment"   # live | <your ref>
psql "$ADMIN_DATABASE_URL" -c "SELECT rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='inkshot_app'"   # all f
```

4. Supabase dashboard > Advisors: Security advisor shows no findings.

## E. Auth, email and support domain (OWNER)

1. Auth > URL configuration: Site URL = `https://<production origin>`; redirect allow-list: `<origin>/api/auth/callback` and `<origin>/api/auth/recovery-callback`. Nothing else.
2. Auth > Emails: paste `supabase/templates/confirmation.html` into **Confirm signup** (keeps the link and adds `{{ .Token }}`) and `supabase/templates/recovery.html` into **Reset password**. Stripe receipts are sent by Stripe: in the Stripe dashboard set the public business name and support email/URL under Settings > Business > Public details, and turn on successful-payment receipts under Settings > Customer emails.
3. Auth > SMTP: set your support-domain sender (SPF, DKIM and DMARC records published). Send yourself a signup and a password reset; both must arrive and render.
4. Auth > Providers > Email: "Confirm email" ON.

## F. Vercel production project and variables (OWNER)

Create (or reuse) a **separate** Vercel project for production; Preview and Production variables are configured independently. Mark each variable below Sensitive where it is a secret. None of these may use a `VITE_`/public prefix.

| Variable | Kind | Value |
| --- | --- | --- |
| `APP_ORIGIN` | public config | exact `https://` origin, no trailing slash |
| `AUTH_PROVIDER`, `STORAGE_PROVIDER` | config | `supabase` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | public-safe | from Supabase API settings |
| `SUPABASE_SECRET_KEY` | **server-only secret** | service key |
| `DATABASE_URL` | **server-only secret** | runtime `inkshot_app` pooler URL (D.2) |
| `CRON_SECRET` | **server-only secret** | 32+ random characters |
| `BILLING_MODE`, `GENERATION_MODE` | config | `live`, `live` (together) |
| `ALLOW_LIVE_GENERATION` | config | `true` |
| `ENABLE_LIVE_CHECKOUT` | config | `false` until section J step 8 |
| `STRIPE_API_KEY` (restricted live key), `STRIPE_WEBHOOK_SECRET` | **server-only secrets** | from Stripe |
| `STRIPE_STUDIO_PRICE_ID`, `STRIPE_PORTAL_CONFIGURATION_ID` | config | live IDs (section G) |
| `PLAN_CURRENCY`, `PLAN_PRICE_AMOUNT`, `PLAN_CREDITS`, `VIDEO_REGEN_MONTHLY_CAP` | config | from OWNER_DECISIONS (`sgd`, minor units) |
| `HF_API_KEY_ID`, `HF_API_KEY_SECRET`, `HF_WEBHOOK_SECRET` | **server-only secrets** | Higgsfield |
| `HF_WEBHOOKS_ENABLED`, `HF_DAILY_BUDGET_USD` | config | `true`, your daily cap |
| `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` | **server-only secret** | writing provider |
| `WRITING_DAILY_REQUEST_LIMIT`, `WRITING_WORKSPACE_DAILY_REQUEST_LIMIT` | config | your caps |
| `OPS_ALERTS_ENABLED`, `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_SECRET` | config / **secret** | `true`, HTTPS receiver |
| `PILOT_INVITE_ONLY` | config | `true` |
| `SUPPORT_EMAIL` | public config | the monitored support mailbox; shown in error messages and Help |
| `ENABLE_EXPORT_REVIEW`, `ENABLE_ACCOUNT_DELETION` | config | live always reviews; leave deletion `false` until hosted deletion acceptance |
| `INKSHOT_SHARED_PROJECT_LIVE` | config | `false` |

Domain: attach your domain in Vercel, wait for the certificate, then set `APP_ORIGIN` to it. Deploy from `main` after merge.

## G. Stripe (OWNER)

1. Dashboard in **live** mode: create product "Inkshot Studio", a recurring monthly price in the decided currency and amount (SGD if chosen). Copy the price ID into `STRIPE_STUDIO_PRICE_ID`. Rehearse the same objects in test mode first.
2. Billing portal configuration: cancel at period end, update payment method, invoice history. Copy its ID.
3. Developers > Webhooks: add **one** endpoint `<origin>/api/webhooks/stripe` with exactly these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`. API version `2026-08-26.dahlia`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Verify read-only (account id and portal id are in the script header; edit them if you use a different Stripe account):

```bash
STRIPE_API_KEY=<live restricted key> STRIPE_STUDIO_PRICE_ID=<live price> PLAN_CURRENCY=sgd PLAN_PRICE_AMOUNT=<minor units> npx tsx scripts/check-live-stripe.ts https://<origin>
```

Expect `Verified live Stripe catalogue, portal, webhook configuration and Inkshot health.`

## H. Higgsfield, alerts and monitoring (OWNER)

1. Higgsfield console: create the live API key; turn **Exclude data from training ON**; register the webhook `https://<origin>/api/webhooks/higgsfield` and copy its signing secret into `HF_WEBHOOK_SECRET`; fund the account only to your cap.
2. Alerts: pick a destination and set `OPS_ALERT_WEBHOOK_URL` (an HTTPS incoming-webhook URL; the sender is the app, not a mailbox). Prove delivery with `--send-alert` in section I.
3. Uptime monitor (UptimeRobot, Better Stack or similar) with two checks every minute: `GET https://<origin>/api/health` expecting 200 and `"ok":true`; and `GET https://<origin>/api/ops/status` with header `Authorization: Bearer <CRON_SECRET>` expecting 200 (503 means stuck jobs or database trouble). Alert both to the same destination.

## I. Preflight (read-only)

Pull the production variables locally (`vercel env pull` to an untracked file) or export them, then:

```bash
npx tsx scripts/preflight-production.ts https://<origin> --send-alert
```

Expect PASS on every line (env names, hosted configuration, schema + marker=live, Stripe, Higgsfield key, alert, headers, health and ops status) and `No failures`. A rehearsal against the sandbox preview (`BILLING_MODE` not `live`) prints `SKIP ... LIVE-ONLY` for Stripe and Higgsfield and must show no FAIL.

## J. Launch-day smoke test (15 minutes)

Keep `ENABLE_LIVE_CHECKOUT=false` until step 8. You need an invite code (`npm run invite -- --count 1`, run against the production `DATABASE_URL`) and your own card.

1. Open the site: pricing shows the decided price and the sign-up shows the invite field.
2. Sign up with an invite, with a mailbox you own; the confirmation email arrives from your support domain.
3. Confirm; you land in the studio. Reusing the same invite code is refused.
4. Paste one website URL and read it; check the brief for invented facts.
5. Select angles and approve a campaign (the cost shown matches the config).
6. Generation. **Gap:** the product only generates whole nine-asset kits (3 videos, 3 images, 3 posts), so a true "one live image only" test does not exist yet. To keep real spend near that, set `HF_DAILY_BUDGET_USD` to roughly one image's estimated cost for this step: budget checks refuse the videos and refund their credits automatically (this behaviour is covered by tests but not yet proven against the live provider). Restore the real cap afterwards. Alternatively accept one full kit within the US$30 cap from the quality trial.
7. Review the asset, download it, answer "Would you publish this?".
8. Set `ENABLE_LIVE_CHECKOUT=true`, redeploy, subscribe with your own card, confirm credits arrive, then refund the payment in Stripe. Expect a **spending hold** to appear (Usage & billing says generation is paused for review) and check the `charge.refunded` event delivered. Release the hold using the procedure agreed in LAUNCH_CHECKLIST gate 4.
9. Run `npx tsx scripts/pilot-report.ts` and see your own events.

## K. Rollback and kill switches

| Situation | Action |
| --- | --- |
| Stop new subscriptions | `ENABLE_LIVE_CHECKOUT=false`, redeploy |
| Stop new spend (any severity) | `GENERATION_PAUSED=true`, redeploy. Restore later by removing it |
| Stop new signups | `PILOT_INVITE_ONLY=true` and issue no codes |
| Bad code release | Vercel > Deployments: promote the previous production deployment (record its URL and ID before launch). Schema is additive, so older compatible code keeps working. Do not roll migrations back |
| Data concern | Pause (`GENERATION_PAUSED=true`, checkout false). Supabase: Database > Backups (daily backups; enable point-in-time recovery before launch if your plan allows). Restore to a **new** project, then reconcile `payment_events`, `provider_spend` and the ledger before any reopening; never restore over newer payment records |
| Do **not** | flip `BILLING_MODE`/`GENERATION_MODE`/`ALLOW_LIVE_GENERATION` back on the live database (the app will refuse to start) |

## L. Why the earlier `inkshot` and `inkshot-live` builds failed

I could not read Vercel build logs from this environment (the Vercel connector here cannot list projects or deployments), so this is derived from the repository. `vercel.json` runs `node --import tsx scripts/check-hosted-build.ts && npm run build`; any missing or invalid variable below aborts the build with `Inkshot deployment blocked: <name or code>`. Preview and Production are checked separately, so a variable set only for Production fails every Preview build. The known cause for `inkshot` is a missing preview `APP_ORIGIN` (LAUNCH_CHECKLIST). Compare the first `Inkshot deployment blocked` line in each failed build log with this table.

| Variable | Read by | Failure if missing or wrong |
| --- | --- | --- |
| `APP_ORIGIN` | build check; runtime origin | `Missing APP_ORIGIN...`; must be https origin, no path or trailing slash; live also `LIVE_BILLING_REQUIRED` |
| `SUPABASE_URL` | build check; runtime | `Missing SUPABASE_URL...`; https origin, no trailing path |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | build check | `Missing <name>...` |
| `DATABASE_URL` | build check; startup | `Missing DATABASE_URL...`; not PostgreSQL URL; `HOSTED_DATABASE_REQUIRED` |
| `AUTH_PROVIDER=supabase` | `assertHostedConfiguration` (build + startup) | `HOSTED_AUTH_REQUIRED` |
| `STORAGE_PROVIDER=supabase` | same | `HOSTED_STORAGE_REQUIRED` |
| `VIDEO_DURATION_SECONDS` (3 to 15, default 10) | same | `VIDEO_DURATION_REQUIRED` |
| `BILLING_MODE` and `GENERATION_MODE` equal | same | `LIVE_MODE_MISMATCH` |
| `STRIPE_API_KEY` (live key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_STUDIO_PRICE_ID`, https `APP_ORIGIN` | same, live only | `LIVE_BILLING_REQUIRED` |
| `ALLOW_LIVE_GENERATION`, `HF_API_KEY_ID`/`SECRET`, `HF_DAILY_BUDGET_USD` > 0, a writing key | same, live only | `LIVE_PROVIDER_REQUIRED` |
| `WRITING_DAILY_REQUEST_LIMIT`, `WRITING_WORKSPACE_DAILY_REQUEST_LIMIT` | same, live only | `WRITING_LIMITS_REQUIRED` |
| `PLAN_*`, `KIT_CREDITS`, `CREDIT_COST_*`, `VIDEO_REGEN_MONTHLY_CAP` | startup (`planConfig`) | startup error naming the variable; `KIT_CREDITS` must equal 3 x (video + image + post) + 1 |
| `CRON_SECRET` | `/api/cron/worker`, `/api/ops/status` | 401/503 at runtime (not a build failure) |
| Migrations applied | startup schema guard | `SCHEMA_*_REQUIRED` (build passes, runtime shows the unavailable page and a reference) |

## Release record

Fill in: commit SHA, Supabase project ref, Vercel project and deployment ID, migration list, Stripe price/endpoint IDs (not secrets), preflight output (pasted PASS/FAIL lines), previous deployment ID for rollback, smoke-test result, approved spend caps.
