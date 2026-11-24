# Ad copy in Inkshot

Research and implementation decision — 22 November 2026

## Recommendation

Include one matching copy set per selected ad concept in the kit price. Make it optional to view and use, rather than a separate fee for a headline or CTA. The merchant needs a complete usable ad, not only a visual. This is a product hypothesis to validate with merchants, not evidence of willingness to pay.

Test additional paid variation packs, localisation and experiment planning later. Do not advertise conversion optimisation or winning ads without campaign outcome data. Ad Library visibility and longevity cannot establish profitability.

## Current code versus missing work

`server/claude.ts` already generates headline and CTA for image/video/post drafts and caption for organic posts. It does not generate a separate paid-ad primary-text field, placement-specific copy profiles or copy exports. The brief prompt deliberately excludes ad copy. Keep that separation: factual brief first, approved campaign concept second, copy third.

## Proposed customer flow

1. Review extracted facts and select the actual product/service, goal and destination.
2. Approve an angle and choose placements.
3. Open **Ad copy included** beside the matching visual. Show primary text, headline and suggested CTA as separate editable fields, with copy buttons.
4. Preview the visual and copy together in clearly labelled platform mockups. Do not invent engagement, endorsements or publishing status.
5. Download assets plus copy.txt and copy.csv. Preserve concept ID, version, placement and destination in exports.

Start with a single default set per concept. Ask for more variants explicitly and show their cost before generating. Editing copy must not regenerate media. Editing factual claims should trigger review again, without silently undoing the merchant's changes.

## Placement rules

| Placement | Copy model | Verification |
|---|---|---|
| Facebook/Instagram paid feed | Separate primary text, headline, optional description, suggested CTA and destination | Meta's guide required login during this review. Do not encode guessed universal character limits or claim exact platform parity. Validate against the chosen placement before release. |
| Instagram organic | Caption separate from text rendered into the visual | Keep paid CTA and organic caption distinct; merchant controls hashtags and voice. |
| TikTok Non-Spark | Placement caption plus suggested CTA; account for UI safe zones | TikTok documents fixed caption styling and no clickable links/@/hashtags for this format. |
| TikTok Spark (Pull) | Existing organic caption as source | TikTok documents caption inheritance and a four-line display maximum for this flow. Do not apply this as a blanket rule to all Spark creation modes. |
| Google responsive display, future scope | Short headlines, long headline, descriptions and business name | Official limits: 30, 90, 90 and 25 characters respectively. Not the same profile as social copy. |

Sources accessed 22 November 2026:
- Google specs: https://support.google.com/google-ads/answer/17090561
- TikTok placement specs: https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?lang=en
- Meta guide attempted, access restricted: https://www.facebook.com/business/ads-guide/update/image/facebook-feed

## Candidate copy-stage contract

Input: approved brand facts with evidence IDs and scope, merchant-approved offer and conditions, selected concept ID, actual product details, placement, locale, objective and destination. Untrusted website text and internal test instructions must never become instructions to the model.

Output per concept/placement: primaryText, headline, optional description/caption, suggestedCta, claimEvidenceIds, assumptions and reviewWarnings. Store prompt/model version and edits. Treat generated copy as a draft; evidence IDs require semantic review, not only ID existence.

Prompt direction: write one clear proposition, lead with the customer-relevant message, match the visual, preserve conditions, use the approved voice, and end with one suitable action. No invented testimonials, urgency, savings, certifications, guarantees, product attributes or performance claims. Return missing facts as review warnings rather than filling gaps. Do not print internal notes in customer copy. Channel limits belong in versioned configuration, not scattered prompt text.

## Evaluation and monetisation

Compare image-only versus image-plus-copy export usefulness with pilot merchants. Track copy opened, copied/exported, edited, approved and time to usable kit; distinguish abandonment from deliberate non-use. Review factual accuracy, match to image, distinctness, clarity and platform fit before measuring conversion outcomes.

For paid variants, measure willingness to pay and contribution margin. Include model cost, retries, failed output, support and payment fees. No price is proposed until the capped trial establishes costs. Credit consumption and customer charges remain disabled during testing.

## Capped writing smoke trial

The offline preparation command is `node --import tsx scripts/prepare-writing-trial.ts`. It produces eight request specifications: four cases (Love, Bonito, bakery restrictions, ownership/certification, prompt injection), each with frozen baseline and current bridge prompt. One pass, no automatic retries, no critic or media calls. `--full` prepares 24 request specifications for all 12 cases; this is not authorisation to execute them.

The Love, Bonito fixture is deliberately a short verified source excerpt from https://www.lovebonito.com/sg/global/about-us, not a complete website scrape. Upgrade it to a frozen full crawl before claiming a realistic end-to-end benchmark. Remaining cases are synthetic. Dates and review requirements are recorded in fixtures.

Before execution: configure a dedicated provider key securely, verify a supported model and rates, set an approved provider-enforced monetary cap, then run sequentially with no retries. Reserve the worst-case cost before each call, stop on uncertain charges or exhausted allowance, and record actual usage. Existing application request quotas alone do not guarantee a monetary cap. Keep trial execution isolated from public writing endpoints.

Current result: requests prepared only; no paid calls, model scores or ad-copy customer UI released. Full multi-stage evaluation remains pending.
