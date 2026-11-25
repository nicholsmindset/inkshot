# Marketing Studio integration decision

Research verified 21 November; implementation checkpoint 22 November 2026.

## Confirmed capability

Official model documentation describes `marketing-studio/image` for generation
and image editing. Direct editing accepts `image_urls`. Enhanced mode takes a
product image and a selected preset; an optional second image is a model
reference. It does not create a presenter automatically.

Fetch currently usable presets through the authenticated
`GET /marketing-studio/image/presets?size=50` endpoint; follow its cursor and use
the selected item's ID. Do not hardcode example IDs. The documentation states
that enhanced requests cost 10% more than equivalent direct requests.

Sources:
- https://open.higgsfield.ai/models/marketing-studio/image/api-reference
- https://open.higgsfield.ai/models/marketing-studio/image/playground
- https://docs.higgsfield.ai/docs/llms.txt

Documented availability is not account-verified access. The Marketing Studio
website's full avatar library, editor and template experience are not established
as API capabilities by this image endpoint. The current app still uses Soul v2
and Kling v3; no Marketing Studio option has been enabled.

## Next implementation slice

1. Add a server-controlled, default-off `ENABLE_MARKETING_STUDIO_IMAGES` flag.
2. List and validate current presets server-side; never expose credentials.
3. Require a workspace-owned product photo, signed for provider input only.
4. Persist the chosen model, preset, quality and resolution with the approved
   version. A later catalogue change must not silently change an approved job.
5. Quote the exact configuration before approval. Enforce existing global spend
   reservations and per-workspace billing holds; reject unavailable presets.
6. Use the durable job lifecycle, idempotency, download validation and private
   storage already implemented. Do not fall back to another model after a
   paid request has been accepted.
7. Retain deterministic text overlays and mandatory human review before export.
8. Test with fake transports before an explicitly capped real-provider trial.

This slice is pending implementation. It should not be shown as a working paid
option on the homepage or sold before acceptance.

## Pricing decision

The implemented offer is USD 39 with a balance top-up to 300 Inkshot credits;
a nine-asset kit costs 100 credits. SGD 49 and a regeneration cap remain proposals.
Do not copy Higgsfield consumer subscription credits into Inkshot pricing.

Before setting premium credit costs, record exact model/configuration, quote,
provider request ID, actual charge, success/failure and any refund. Include
writing, failed attempts, storage, delivery and payment processing in the margin
calculation. Published starting prices are not actual cost evidence and vary
with quality/resolution. Keep premium generation disabled until this is reviewed.
