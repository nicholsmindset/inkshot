# Inkshot launch checklist

Updated 19 November 2026. This is the current release handoff; the October assessment in `PRODUCTION_AUDIT.md` is historical evidence, not a fresh production certification.

## Release being prepared

PR [#27](https://github.com/nicholsmindset/inkshot/pull/27) adds a sourced brand brief, six angles with three selected, nine editable prompts, saved drafts and exact-revision generation approval. It also improves the dashboard, library filters and revision feedback. Track remaining work in [#26](https://github.com/nicholsmindset/inkshot/issues/26).

The existing 15-second video product and credit prices remain unchanged. Preview deployments and sample generation do not prove paid fulfillment.

## Deployment order

1. Restore administrator access to the existing Inkshot Supabase project `smpdzhxydnctiyjqojmp`. The current connection returns permission denied for that project; it lists two other projects that must not be used as substitutes.
2. Confirm the intended sandbox/live namespaces and take the normal database backup. Apply `supabase/migrations/20261119090000_campaign_planning.sql`. It only adds `campaigns.draft` and `versions.motion_prompt` to `public` and an existing `inkshot_live` schema. It does not copy customer rows or credits.
3. Verify the columns below, plus the existing runtime-role grants, before deploying the branch. A live schema that has not been provisioned is a separate setup task; this migration does not create it.
4. Review the passing checks for the final PR commit, deploy the matching application version, and check authentication, saved drafts, private downloads and workspace isolation in the hosted environment.
5. Keep new live checkout closed until funded writing, hosted media delivery and signed Stripe fulfillment pass their acceptance checks. Deploying the application is separate from enabling checkout.

Read-only migration verification:

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'inkshot_live')
  AND ((table_name = 'campaigns' AND column_name = 'draft')
    OR (table_name = 'versions' AND column_name = 'motion_prompt'))
ORDER BY table_schema, table_name;
```

Expect `draft` as `jsonb` and `motion_prompt` as `text` in each provisioned namespace. Check as an administrator; a scoped runtime role is intentionally unable to inspect the other environment's tables.

## Paid acceptance evidence

## Account journey release checks

Vercel builds run `scripts/check-hosted-build.ts` before compiling the frontend. Missing Auth, database or private-storage configuration must fail the build instead of publishing a login form backed by an unavailable API. Configure Preview and Production independently. Passing this check proves configuration shape, not valid credentials or database connectivity.

For each served origin, set `APP_ORIGIN` to its exact HTTPS origin and allow its `/api/auth/callback` and `/api/auth/recovery-callback` URLs in that project's Supabase Auth configuration. A confirmation started on a preview cannot rely on a verifier cookie on a different production hostname. Do not copy live payment credentials into a preview to make its checks pass.

The dedicated `confirmed-auth-journey` CI job requires email confirmation using a disposable Supabase server and captured local mailbox. It checks signup, blocked login before confirmation, callback website continuation, first login, signout, returning login to the same workspace, incorrect passwords and single-use password recovery. Chrome checks also cover form state, a late anonymous response after signup and a failed signout followed by a successful retry.

Hosted startup failures emit only a safe stage/configuration code and customer reference. Match the reference in Vercel runtime logs to distinguish missing configuration, database access and application startup failures. Do not diagnose a customer's password from a generic service failure, or call the hosted issue resolved from local tests alone.

## Paid acceptance evidence

- Funded writing: read an owned public website, review the extracted facts and inferred suggestions, select three angles and save nine prompts. Confirm evidence excerpts match the source and unsupported claims are absent.
- Capped generation: approve the saved revision, then verify all three videos, three image ads and three posts. Confirm submitted first-frame and motion prompts match the saved approval, media is stored privately and the downloaded output matches its preview.
- Recovery: confirm retries reuse a provider request identity, failed assets receive the intended credit refund once, and a new deliberate generation is separately priced. Reconcile provider reservations against actual provider charges; estimates are not invoices.
- Billing: verify the intended live account/catalogue/webhook configuration read-only, test payment lifecycle cases in Stripe sandbox, then verify the first approved genuine live transaction and signed credit fulfillment. No test card should be used in live mode.
- Operations: check password recovery delivery, private object backup/restore, support contact, cancellation/refund terms and alerts for failed billing delivery or stuck jobs. Historical check results must be revalidated against the deployed configuration.

`scripts/check-live-stripe.ts` checks configuration without creating a payment. `scripts/verify-live-kit.ts` can incur provider spend and uses a local verification database; even a passing run does not replace hosted acceptance. Supply credentials through the established secret-management workflow, never a chat message or committed file.

Provider receipt recovery follows [Higgsfield's idempotency contract](https://docs.higgsfield.ai/docs/concepts/idempotency): replay the unchanged request with the original key, then poll the recovered request ID. Inkshot rejects changed inputs and leaves unresolved reservations from an earlier budget day for reconciliation. A replay is not a new creative revision.

## Saved access and spending decisions

- Supabase access to the exact Inkshot project is required for the migration.
- Current Vercel connector discovery does not expose Inkshot projects. GitHub-created preview checks are visible, but that is not permission to edit the production project's configuration.
- A capped funded provider run and live transaction still need an explicit amount/account decision. Continue code, tests and sandbox verification independently while these are pending.
