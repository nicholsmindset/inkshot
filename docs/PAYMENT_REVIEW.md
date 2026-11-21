# Payment refund and dispute review

## Purpose and current behavior

Inkshot pauses new generation spending and checkout after a verified Stripe `charge.refunded` or `charge.dispute.created` event for a linked customer. Any refund, including a partial refund, creates a review hold. The hold is separate from subscription status: a later active subscription or paid renewal does not release it. Deletion also waits for the review.

This is a conservative review mechanism, not an approved cash-refund policy. It does not calculate refund entitlement, subtract consumed credits, decide a dispute, or automatically release a hold after a dispute outcome. Existing known provider receipts can still be recovered and delivered. Same-day ambiguous provider submissions may be replayed with their unchanged idempotency key; this is not a new generation intent. Older unresolved submissions still require reconciliation.

## Triage

1. Confirm the environment, customer and workspace. Use the configured Stripe account and the correct sandbox/live database. Do not copy production credentials into a preview.
2. Inspect the triggering event and authoritative Stripe charge/refund/dispute. Record event, charge, invoice and subscription IDs in the private operator case; do not paste credentials or customer payment information into public issues.
3. Confirm the amount/currency and refund/dispute status, and whether multiple events describe the same charge. Identify the subscription invoice and the allowance it funded.
4. Review the credit ledger, remaining balance, generation reservations and completed/delivered work. A refund amount does not map automatically to credits already consumed.
5. Keep the hold while entitlement or provider charges are uncertain. Confirm there are no further unresolved refunds/disputes for the customer. A paid renewal alone is not sufficient evidence to release it.
6. Escalate the entitlement decision to the authorized operator under the approved refund/dispute policy. Record the decision, evidence, reviewer and timestamp. Never grant credits merely to make a blocked test pass.

## Read-only checks

Use parameterized queries through the approved database client. `$1` is the verified workspace ID. These examples do not release a hold or modify balances.

```sql
SELECT workspace_id, status, spend_blocked, spend_block_reason,
       customer_id, subscription_id, last_allowance_invoice_created
FROM billing_accounts WHERE workspace_id = $1;

SELECT credits FROM workspaces WHERE id = $1;

SELECT created_at, kind, amount, event_key, description
FROM ledger WHERE workspace_id = $1 ORDER BY created_at DESC;

SELECT id, version_id, state, attempts, created_at
FROM jobs WHERE workspace_id = $1 ORDER BY created_at DESC;
```

`payment_events` currently records event ID/type/time, not a full charge-to-credit reconciliation ledger. Retrieve the known event from Stripe using the private operator case. Do not infer refund economics from the event type alone.

## Release or adjustment

No self-service release endpoint is provided. Release requires an explicit operator-approved case with a recorded entitlement decision; do not use a blanket SQL update, automatic renewal event, or dispute-status change as authorization. Until the controlled release/audit workflow and refund policy are approved, retain the hold and keep paid launch gated.

If an adjustment is approved, implement it as an audited, idempotent ledger entry tied to the case, under the standard workspace→billing lock order. Preserve existing event receipts. Do not delete ledger history, reset provider spending, create negative balances or silently reuse an old case key. A later webhook retry must not undo the reviewed decision or duplicate an adjustment. Review release behavior against late events before enabling it.

## Configuration and acceptance

- The existing Stripe webhook endpoint must subscribe to `charge.refunded` and `charge.dispute.created` in addition to existing invoice/subscription/checkout events. Update it in place; do not create a duplicate endpoint. `check-live-stripe.ts` verifies the required set.
- `setup-stripe.ts` is a legacy sandbox creation script. Its old idempotency keys are not a migration mechanism; do not rerun it against an existing endpoint with changed creation parameters.
- Apply the billing-hold schema migration and verify schema readiness before deploying code that reads these columns.
- Test forged signatures, wrong environment, duplicate/refund/dispute delivery, partial refunds, later paid renewal, another workspace, checkout/deletion refusal and provider reservation recovery in sandbox.
- Add the approved operator release/reversal workflow and a real Stripe test-mode journey before accepting live money. No live refund, charge or dispute was performed by the implementation tests.
