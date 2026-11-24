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
