import type { Brand, Concept } from "../../shared/types.js";
import { marketOf, marketRules } from "./markets.js";

// Maps what Inkshot actually knows (Brand + Campaign) onto the copy layer's BRAND_BRIEF.
// Fields Inkshot does not collect stay empty or unverified on purpose: the prompts then avoid
// angles that need them (testimonials, usual prices, end dates) and list them as missing_inputs.
const goalMap: Record<string, { goal: string; stage: "cold" | "warm" | "hot"; channel: string }> = {
  Sales: { goal: "sales", stage: "warm", channel: "website" },
  Bookings: { goal: "bookings", stage: "warm", channel: "booking" },
  Enquiries: { goal: "messages", stage: "cold", channel: "whatsapp" },
  Awareness: { goal: "awareness", stage: "cold", channel: "website" },
};

export function muisCertified(brand: Brand) {
  return brand.certifications?.muisHalal === "attested" && !!brand.certifications.certificateId;
}

export function buildBrandBrief(brand: Brand & { destinationUrl?: string }, campaign: { goal: string; offer: string; mock?: boolean }, singlishLevel = 0) {
  const goal = goalMap[campaign.goal] ?? goalMap.Awareness;
  const market = marketRules[marketOf(brand)];
  const offer = (campaign.offer || brand.offer || "").trim();
  return {
    schema_version: "1.0",
    business: { name: brand.name, category: "other", location: { country: market.code }, website: brand.website },
    offer: {
      primary: offer, currency: market.currency, tax_inclusive: market.priceIncludesTax,
      // Inkshot does not collect promo type, usual price or an end date. Nothing may imply them.
      promo: { type: "none", details: "", conditions: "", usual_price: null, usual_price_days_charged: null, end_date: null },
    },
    usp: brand.proof,
    products_services: [],
    audience: { personas: [{ name: "Primary customer", who: brand.audience, pains: brand.pain ? [brand.pain] : [], desires: [], objections: [], awareness_level: "problem" }], market_sophistication: 3 },
    proof: { testimonials: [], ratings: { value: null, count: null, source: "" }, stats: brand.proof, awards_certs: [], press: [] },
    brand_voice: { tone: brand.voice ? [brand.voice] : [], formality: "casual", singlish_level: market.singlishAllowed ? singlishLevel : 0, words_to_use: [], words_to_avoid: [], emoji_ok: true },
    language: { primary: "en", spelling: market.spelling, secondary: [], output_languages: ["en"] },
    campaign: { goal: goal.goal, funnel_stage: goal.stage, cta_url: brand.destinationUrl ?? "", cta_channel: market.code !== "SG" && goal.channel === "whatsapp" ? "message" : goal.channel, seasonal_hook: brand.trigger ?? "" },
    compliance: { muis_certified: muisCertified(brand), regulated_category: "none", special_ad_category: "none", substantiation_available: [], forbidden_claims: [] },
    description: brand.description,
    visual_direction: brand.visualDirection ?? "",
  };
}

export function buildAngles(concepts: Concept[]) {
  return concepts.map(({ id, title, hook, description, cta }) => ({ id, title, hook, description, cta }));
}
export const funnelStageFor = (goal: string) => (goalMap[goal] ?? goalMap.Awareness).stage;
