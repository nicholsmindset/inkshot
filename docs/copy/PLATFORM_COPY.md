# Platform copy layer

Research and design for Inkshot's per-platform copy (Nov 2026). **Source of truth for the prompts is code:** `server/copy/prompts.ts` (wording), `server/copy/specs.ts` (limits, CTA lists, safe zones), `server/copy/validate.ts` (deterministic checks), `server/copy/pipeline.ts` (generation). This document explains why they are shaped the way they are, and what is not built yet.

## What ships now

Per campaign, per platform (Facebook, Instagram and TikTok on by default; LinkedIn, YouTube Shorts, X, Pinterest and Threads are specified and prompted but off until listed in `COPY_PLATFORMS`):

1. **Angles in:** the campaign's three chosen concepts are the angle matrix. No separate strategist call.
2. **One writer call per platform** with the platform prompt (shared core + platform section + a LIMITS block generated from `specs.ts`). Output is strict JSON: 2 variants per angle (6 total) with different hook types and different first three words.
3. **Deterministic validator (code, not an LLM):** grapheme-aware character counts (CJK double), length per field, CTA from the platform's list, hashtag limits, plain-text fields (TikTok non-Spark ad text: no hashtags, @, links or emoji), banned phrases, personal-attribute "you" pairings, urgency without a real end date, "free" without conditions, "halal-friendly", overlay cards over 7 words, set-level coverage and diversity, and the existing claims guard (`assertApprovedClaims`: halal/MUIS attestation, prices, testimonials, guarantees).
4. **One repair pass:** if the validator finds errors, a single "Copy Critic" call receives the exact violations and returns corrected JSON. Anything still failing is shown to the merchant as "needs your review", never silently dropped and never thrown away.
5. **Merchant UI:** a Platform copy panel on the campaign page: tabs per platform, every field with its live count against the limit, copy buttons, compliance flags, an AI-disclosure checklist and the list of brief gaps ("verified testimonials", "promotion end date", "usual price").
6. **Preview mode** writes deterministic sample copy that obeys the same limits and rules, with no provider spend. A banner says so.
7. **Higgsfield briefs:** the creative-director rules (hook visible in 2 s, safe zones, no model-rendered text, no certification marks, no fake customers) are appended to the nine-asset prompt writer (`CREATIVE_BRIEF_RULES`).

Controls: `COPY_PLATFORMS` (comma list), `COPY_MAX_RUNS_PER_PLATFORM` (default 3 writes per platform per campaign), the existing daily writing limits (every call goes through `reserveWritingRequest`), and `GENERATION_PAUSED`.

## Deliberate differences from the original research brief

| Research proposal | Built | Why |
| --- | --- | --- |
| Separate strategist call (5-6 angles) | Reuse the existing six concepts and the merchant's three selections | Already exists and the merchant already approved it |
| Separate Higgsfield creative-brief call | Rules appended to the existing asset-prompt call | One call fewer; same effect on first frames and motion prompts |
| Critic LLM call on every set | Critic only when code finds errors | Cost, and code catches the countable failures reliably |
| 3 variants for each of 9 assets | 2 variants for each of 3 angles | Output size and cost; assets share an angle |
| Limits inside prompts | Limits generated from config | They change and sources conflict |
| English, Mandarin, Malay, Tamil, Singlish slider | English only for now; Singlish level is accepted by the API (0 to 2, default 0) but not yet in the UI | Transcreation quality is unverified |
| Credits per rewrite | Free, capped at 3 writes per platform per campaign | Pricing is an owner decision (`docs/OWNER_DECISIONS.md`) |
| BRAND_BRIEF with testimonials, usual prices, end dates, MUIS expiry | Those fields are sent empty, so prompts avoid angles that need them | Inkshot does not collect them. Collecting them is the biggest quality lever left |
| Prompt text treats the brief as trusted | Brief, angles and assets are declared untrusted data | Website text is attacker-controlled |

## Not built yet (suggested order)

1. Collect verified testimonials, promo type, usual price with days charged, end date, and MUIS certificate expiry in the brief, then pass them through `buildBrandBrief`.
2. Add copy files (`copy/<platform>.txt`) to the ZIP export (needs a manifest change).
3. Quality eval: run the prompts on the 5-site quality trial and rate them like the creative (`docs/QUALITY_TRIAL.md`), then tune. Nothing here has been run against a live model.
4. Chinese, Malay and Tamil transcreations, a Singlish control, and the LinkedIn / YouTube / X / Pinterest / Threads UI polish.
5. A 7-11 call "strategist + critic" pipeline only if the trial shows the single writer plus repair is not enough.

## Platform facts (recommended display lengths, not hard maxima)

| Platform | Limits and rules used |
| --- | --- |
| Facebook | primary text 125 (cold; 500 for warm/hot), headline 40 (27 visible), description 25; first 40 characters must work alone in Reels; 9:16 safe zone: top 14%, bottom 35%, sides 6%; sound-off comprehension |
| Instagram | same Meta fields; about 44 characters show on Reels; caption 2,200; **5 hashtags maximum** (use 2-4 specific); reach comes from caption keywords, not tags |
| TikTok | ad text about 100 characters, 4 lines, no links/@/hashtags/emoji (non-Spark); Spark caption from the organic post; hook in 3 s, proposition by 6 s; text 5-10 words per second; 3-5 creatives per ad group |
| LinkedIn | intro 150 before "see more", headline 70, description 100; carousel intro 255, card 45; Thought Leader posts are the founder's organic post |
| YouTube Shorts | headline 40, description 90 |
| X | 280 characters; each link counts 23; emoji and CJK count 2 |
| Pinterest | title 100 (about 40 visible), description 500, overlay 10 words or fewer |
| Threads | ad text 80-160 recommended (500 maximum), no hashtags or URLs in ad text |

Why variety matters: Meta's guidance since 2024-25 treats creative diversity as the main lever for finding audiences, and ads that look alike are grouped as one creative. So variants differ in motivation (pain, outcome, proof, offer, objection, identity, curiosity), not wording.

## Compliance rules baked in

| Risk | Rule |
| --- | --- |
| Personal attributes (Meta) | Never pair "you/your" with health, body, money, religion, ethnicity, age, orientation, disability or record |
| Health, weight, finance | No guarantees, cures, before/after or income claims; regulated categories go to human review |
| AI disclosure | Live campaigns show a checklist: TikTok's "AI-generated content" switch and Meta's disclosure; never present AI people as real customers |
| Testimonials (SCAP) | Only verified, faithful quotes; the claims guard also requires exact approved wording |
| "Free" | Conditions in the same sentence |
| Sales, "was/now" | Usual price charged at least 28 consecutive days in the past 6 months; prices include GST |
| Urgency | "Limited time" needs a real end date |
| Comparisons | No "best/No.1/cheapest" without substantiation; no disparaging competitors |
| Halal | "Halal" only with MUIS attestation and a certificate on file; never "Muslim-friendly" or "halal-friendly" as a workaround; never draw certification marks |
| Sponsored/influencer | Disclose clearly and early (ASAS guidelines) |

## Caveats

- **Specs change and sources conflict.** Meta publishes recommendations, not maximums. TikTok publishes no caption count and no pixel safe zone (circulating numbers are third-party). Pinterest's description limit is cited as 500 by most guides and 800 by one. Re-verify `specs.ts` against Meta's Ads Guide, TikTok's Business Help Center, LinkedIn ad specs, Google Ads Help, X Business and Pinterest by `SPECS_REVERIFY_BY`, and bump `SPECS_VERSION` when you change a number.
- **Secondary sourcing.** Benchmarks quoted in the research (Motion's creative benchmarks, LinkedIn Thought Leader Ad CTRs, Meta detecting third-party AI tools from June 2026) come from vendor or agency write-ups. Treat them as directional. I could not re-verify the links when this layer was built.
- **SCAP and CPFTA.** The SCAP text referenced is the 2008 third edition hosted by ASAS, and paragraph numbering has reportedly changed. Verify against Singapore Statutes Online before quoting clauses to merchants.
- **Halal.** The MUIS offence covers the certification mark and issuing certificates, not the bare word "halal". Inkshot is deliberately stricter: it refuses the word without attestation.
- **Not legal advice.** Flags are guidance. Route regulated categories to human review.
- **Higgsfield.** Model capabilities were not independently verified. Overlay text is composited by Inkshot's renderer, never by the model.
- **Singlish and localisation evidence is thin.** Agency figures such as "+34% engagement" are unverified; A/B test before defaulting to Singlish.
