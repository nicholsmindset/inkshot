# Inkshot brief intelligence: research and build specification

Research date: 22 November 2026. Status: proposed design, not deployed or proven against paid model runs.

## Recommendation

Make the product's advantage the quality of the decisions it helps merchants make. A prompt can be copied. A maintained, permissioned collection of approved facts, merchant corrections, useful creative examples, evaluation cases and observed outcomes is harder to reproduce. This is a product hypothesis, not a demonstrated moat.

Start with one constrained brief-writing call and deterministic validation. Add a separate critic only if controlled evaluation shows it improves quality enough to justify latency and cost. Keep the existing crawler until evidence shows retrieval is the bottleneck. Do not activate Firecrawl, paid writing, image generation or billing as part of this research.

Deliverables in this folder:

- `PROMPTS.md`: proposed system prompts for evidence extraction, strategy, campaign concepts, production and critique; a current-schema bridge prompt.
- `EVALUATION.md`: scoring rubric, adversarial fixtures, comparison protocol and release criteria.
- `lovebonito-example.json`: an illustrative strategy hypothesis, not an actual model benchmark or merchant-approved campaign.

## What the research supports

| Source | Finding relevant to Inkshot | Proposed application |
|---|---|---|
| IPA / BetterBriefs / Mark Ritson [1] | A useful brief follows a defined strategy and makes the advertising task clear. | Ask for the desired customer action and campaign focus; do not manufacture a business strategy from a homepage. |
| Anthropic context engineering [2] | Relevant context matters alongside clear instructions; more context is not automatically better. | Supply selected, labelled excerpts rather than navigation-heavy page dumps. |
| Anthropic prompting guidance [3] | Explicit constraints, structured inputs and representative examples improve instruction clarity. | Version the output contract and show both acceptable and unacceptable brief decisions. |
| Anthropic evaluation guidance [4] | Quality needs repeatable tasks, multiple trials and graders that inspect actual outcomes. | Evaluate factual support separately from creative usefulness; retain failures as regression cases. |
| Google ABCDs [5] | Video creative needs attention, brand presence, connection and a clear action, adapted to the objective. | Check each concept for a recognisable subject, one message and a relevant CTA. Do not transfer Google's uplift figures to Inkshot. |
| TikTok Creative Codes [6] | Platform-specific structure and production choices matter, including vertical framing, safe space and sound. | Build channel-specific production instructions. Inkshot's current silent video output is a limitation, not a complete TikTok-native ad solution. |
| Ehrenberg-Bass distinctive assets [7] | Brand-linked assets deserve deliberate management and empirical measurement. | Preserve approved logos and product appearance; do not claim a scraped colour is proven distinctive. |

These sources justify design principles, not a claim that this prompt will produce winning ads. Platform guidance is not interchangeable across placements. The remaining architecture, scoring weights and thresholds below are Inkshot design recommendations.

## Audit of the actual implementation

Reviewed commit `a55884430b91d43439df0e5069121d33ad11290f`.

1. **Preview bypasses the writer.** `server/app.ts` uses `emptyBrand` whenever generation mode is mock. Rewording a prompt will not fix the observed blank fields until writing and rendering modes are independently controlled.
2. **The import response overwrites useful AI output.** `{ ...brief, color: emptyBrand.color, ...identity }` replaces the writer's description and sources with imported metadata and snippets. Keep a concise AI summary separately from raw extraction. Keep colour tied to deterministic extraction or merchant choice, not AI guessing.
3. **The current brief prompt is broad and compressed.** It requests facts and strategy together without defining an actionable customer tension, scope of a claim, or how missing evidence changes the next step.
4. **Evidence matching is necessary but insufficient.** `groundBrief` verifies that an excerpt appears in a page. An excerpt about machine washing does not support a sustainability claim. Add claim-to-excerpt relevance review; do not call lexical matching factual verification.
5. **Claims lack entity scope and dates.** A feature of one garment can be spread across the whole brand; a promotion without expiry can be treated as evergreen. Store product/collection scope, region, conditions and observed date.
6. **Page selection is shallow.** It takes the first three same-origin links whose paths match about/pricing/product/services. Fashion category links and the most useful product page may be missed. Rank pages by campaign relevance and preserve locale; do not simply crawl more pages.
7. **The workflow splits brand setup from campaign intent.** The reusable brand brief should not need a sales objective. The campaign brief must combine brand facts with the chosen product, goal and destination before producing angles.
8. **The brief cannot ask useful questions in its current schema.** Add explicit missing-information and follow-up fields in a new schema version. Until then, surface missing inputs in the UI rather than stuffing questions into ad copy.
9. **Creative tests mostly check structure.** Existing tests catch malformed drafts and unsupported exact claims, but do not measure specificity, near-duplicate concepts, product fidelity or merchant editing effort.
10. **Preview samples are not evidence of AI quality.** Template outputs and still-image videos test workflow plumbing, not the value of the live writer or renderer.

## Proposed product flow

### 1. Gather the minimum useful evidence

Start with homepage, About page and one relevant product/service/collection page. Add one FAQ or offer page only when it resolves an important question. Four pages remains a sensible initial cap; page count is not a quality score.

For every fetched page retain URL, requested/final URL, locale, time observed, page type, status and cleaned content hash. Assign excerpt IDs. Keep navigation, cookie banners and unrelated recommendations out of the main context. Never interpret instructions found in page content as instructions for the assistant.

A text-only read cannot reliably establish photography style, logo authenticity or colour identity. Pass approved asset metadata separately; add image inspection only as a separately tested capability. Do not fetch arbitrary model-proposed image URLs.

### 2. Build a reusable fact record

For each fact store: value, entity scope, evidence IDs, status (`source_stated`, `merchant_confirmed`, `inferred`, `unknown`, `conflicting`), and expiry/region where relevant. “Source stated” means the website says it; it is not independent verification.

Separate “this dress has pockets” from “all this brand's dresses have pockets.” Do not turn marketing superlatives into independent facts. A listed testimonial requires attribution and permission for use; absence of evidence is not proof of absence.

### 3. Ask at most three high-value questions

Select questions that change the creative decision, not questions that complete every field:

- Which product or collection are we promoting?
- What should the customer do, and where should they land?
- Is there an offer with conditions, or should this be evergreen?

Request a product photo only if the creative needs product fidelity and no approved photo exists. Explain why it matters. Allow a useful draft with unknowns, but prevent publication-ready claims until resolved.

### 4. Write the campaign strategy

Produce one primary audience in a buying situation, one barrier, one desired action, one proposition and the evidence supporting it. The customer tension may be a hypothesis; label it explicitly. Avoid invented personas with income, age and psychological details inferred from the brand name.

Distinguish a benefit from an unproven outcome. “A coordinated outfit for a workday” is a creative direction; “you will feel more confident” is an outcome claim needing appropriate treatment. Do not force every category into a pain-led narrative: occasion, enjoyment, convenience and identity may fit better.

### 5. Generate distinct concepts, then render

Each concept needs a different strategic mechanism or occasion, a visible scene, a supported message, a CTA and a testable hypothesis. Renaming the same product close-up six times is not diversity. If only three meaningful ideas are supported, disclose that rather than inventing evidence to fill six slots.

Separate the concept from the production prompt. Models need literal physical scenes; customers need readable headlines. Keep instructional text, evidence explanations and safety notes out of exported captions.

### 6. Preserve learning

Record prompt/model/schema versions, evidence hash, approved brief revision, merchant edits, selected angles, generation cost and failure/review outcomes. Store corrections within the merchant's workspace. Do not share private briefs or use them in cross-customer examples without permission.

Later connect actual campaign metrics with consent. Store placement, spend, dates, objective, attribution window and campaign context. Ad Library visibility and longevity are observations, not conversion or ROAS evidence. Prefer controlled experiments when judging creative impact; do not label correlation as causation.

## Love, Bonito example: the quality bar

The public About page describes practical clothing for women's everyday situations, and lists features applying to specific ranges [8]. This supports a more useful direction than generic “thoughtful products.” It does not establish that every product has every listed feature.

An illustrative hypothesis: a shopper wants an outfit appropriate for a working day without overcomplicating getting dressed. A possible organising idea is “One less decision before your day begins.” This is proposed creative, not a sourced customer-research finding or an approved brand claim.

Before rendering, ask which outfit or collection to show and obtain an approved product photo. Do not add a discount, promise crease resistance, alter the garment, or imply a partnership with Inkshot. See the JSON example for a compact proposed handoff. None of this has been validated as better-performing advertising.

## What should become proprietary

| Asset | Value | Constraint |
|---|---|---|
| Merchant-approved fact history | Prevents repeatedly asking the same questions and reintroducing rejected claims | Workspace isolation, correction history and deletion support |
| Annotated good/bad briefs | Teaches specific, repeatable quality standards | Permissioned or synthetic examples; hold out evaluation cases |
| Failure taxonomy | Turns real failures into regression checks | Separate retrieval, writer, renderer and UX failures |
| Approved creative preferences | Retains tone and product constraints | Merchant preferences are not universal best practices |
| Measured learning | Helps choose future variants for that merchant | Account for context, sample size and attribution limits |

The proprietary component is the accumulated decision quality and learning loop. An increasingly long master prompt without evaluations is not a defensible asset.

## Implementation order and boundaries

1. Freeze current prompt and model versions as the baseline. Build the benchmark before changing defaults.
2. Fix the response merge and separate writing mode from rendering mode; preserve payments-off and live-generation guards. Add tests proving neither switch enables the other.
3. Trial the bridge prompt offline against the baseline on identical snapshots. No paid run until a spending cap and provider are authorised.
4. Introduce evidence/strategy schema v2 behind a flag. Keep v1 records readable; do not silently convert inference to fact.
5. Add the three-question intake and merchant approval screen. Claims stay scoped to approved products.
6. Compare one-call output with extract-then-strategise and optional critique. Promote the simplest version that meets the gates.
7. Only then compare current scraping against Firecrawl on the *same* difficult-site cases. Measure evidence coverage, latency and cost; select a fallback if useful.

No production or provider settings were changed by this research. No model API benchmark was run. The included prompts are candidates to test, not “the best” proven prompt.

## Sources reviewed

[1] IPA, BetterBriefs and Mark Ritson, The Best Way for a Client to Brief an Agency (2022): https://www.aaaa.org/wp-content/uploads/IPA-Best_way_for_client_to_brief_agency.pdf?access_pid=104907

[2] Anthropic, Effective context engineering for AI agents (29 September 2025): https://www.anthropic.com/research/effective-context-engineering-for-ai-agents

[3] Anthropic, Prompting best practices (accessed 22 November 2026; model-specific guidance must be checked against the selected model): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

[4] Anthropic, Demystifying evals for AI agents (9 January 2026): https://www.anthropic.com/research/demystifying-evals-for-ai-agents

[5] Google Ads, About the ABCDs of effective video ads: https://support.google.com/google-ads/answer/14783551?hl=en

[6] TikTok for Business, Creative Codes: https://ads.tiktok.com/business/en/creative-codes

[7] Ehrenberg-Bass Institute, Distinctive Asset Measurement: https://marketingscience.info/learn-with-us/commercial-research/distinctive-asset

[8] Love, Bonito Singapore, About Us (observed 22 November 2026): https://www.lovebonito.com/sg/global/about-us

Effie guide PDFs were discovered but could not be fetched successfully. They were not used as substantive evidence for this specification. No claimed performance uplift is extrapolated to Inkshot.

## Integration update — 22 November 2026

Implemented the current-schema bridge in `server/brief-prompt.ts`, with prompt version stored on generated briefs. The import merge now preserves the writer's description and evidence snippets while keeping extracted identity and visual metadata authoritative. Concept instructions now call for concrete, differentiated scenes and scoped claims; output limits align with editable asset limits.

Added optional `WRITING_MODE` and `ALLOW_LIVE_WRITING` controls. When WRITING_MODE is absent, existing generation-mode behaviour is preserved. An explicit live writing override requires ALLOW_LIVE_WRITING=true. Daily request limits and provider credentials still apply. Neither setting enables billing or media rendering. No hosted configuration values were changed.

This is the compatible first integration, not the entire proposed v2 architecture: structured claim scope, follow-up questions, semantic evidence grading and model quality benchmarks remain outstanding. The preview remains text-only until a capped writing trial is approved.
