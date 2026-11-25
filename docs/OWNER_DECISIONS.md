# Inkshot owner decisions

Source of truth for commercial and operational decisions. Later work reads these values. Status: **DECIDED** or **UNSET** (owner must fill in; do not guess).

| Decision | Value | Status |
| --- | --- | --- |
| Legal operator | ONN Group LLP, Singapore | DECIDED |
| Support email | UNSET (a mailbox the owner controls) | UNSET |
| Pilot price | UNSET (e.g. US$39/month or S$49/month) for 300 credits, no rollover | UNSET (300 credits, no rollover decided) |
| Monthly video-regeneration cap per workspace | UNSET (e.g. 8) | UNSET |
| Default video | 10 seconds, 720p, sound off | DECIDED |
| Refund policy | UNSET (e.g. failed assets auto-refunded as credits; subscription refunds at owner discretion within 7 days) | UNSET |
| Alert destination | UNSET (email address, or Slack/Discord incoming-webhook env var name) | UNSET |
| Higgsfield cost reconciliation | Manual monthly comparison of the `provider_spend` table with the Higgsfield console CSV export (open.higgsfield.ai, Analytics). Replaces automated actual-charge reconciliation. | DECIDED |
| Paid quality trial budget | US$30 Higgsfield, US$10 writing provider, hard caps enforced in config | DECIDED |
| Pilot | 10-15 Humble Halal merchants in Singapore, invite-only | DECIDED |

Related environment defaults for all rehearsal work: `GENERATION_MODE=mock`, `BILLING_MODE=off`, `ENABLE_LIVE_CHECKOUT=false`, `ALLOW_LIVE_GENERATION=false`.

## Stripe objects (live account ONN GROUP LLP, created 25 Nov 2026)

Product `prod_VcriAoyQSsH5QA` "Inkshot Studio"; billing portal `bpc_1Ubc4cDjNCv7xF61XYQJpfqA`. Monthly prices, tax behaviour left unspecified (decide with an accountant before selling outside Singapore):

| Currency | Amount | Price ID | Lookup key |
| --- | --- | --- | --- |
| USD (primary) | 79.00 | `price_1UfZuXDjNCv7xF61iaMWu3SQ` | `inkshot_studio_monthly_usd_2026` |
| SGD | 109.00 | `price_1UfZvZDjNCv7xF61NnPs3RKL` | `inkshot_studio_monthly_sgd_2026` |
| CAD | 109.00 | `price_1UfZvdDjNCv7xF61swo866IT` | `inkshot_studio_monthly_cad_2026` |
| AUD | 119.00 | `price_1UfZvfDjNCv7xF612lULptUK` | `inkshot_studio_monthly_aud_2026` |

The older US$39 price `price_1UbbydDjNCv7xF61FEzeGu5I` is still active and unused by the new settings; archive it once nothing references it.

Settings (names and non-secret values):
`PLAN_CURRENCY=usd`, `PLAN_PRICES=usd:7900,sgd:10900,cad:10900,aud:11900`,
`STRIPE_PRICE_IDS=usd:price_1UfZuXDjNCv7xF61iaMWu3SQ,sgd:price_1UfZvZDjNCv7xF61NnPs3RKL,cad:price_1UfZvdDjNCv7xF61swo866IT,aud:price_1UfZvfDjNCv7xF612lULptUK`.

Not created yet: the Inkshot webhook endpoint (needs the final HTTPS origin) and a Stripe sandbox for test-mode rehearsal.
