import type { Brand, Market } from "../../shared/types.js";

// Market rules for the copy layer. Singapore is the pilot market; the others are first-pass
// guidance, NOT legal advice: have each market's rules reviewed by a local adviser before launch.
export type MarketRules = {
  code: Market; name: string; currency: string; spelling: "US" | "UK";
  priceIncludesTax: boolean | null; // null = tax is added at checkout, never imply a tax-inclusive price
  defaultCtas: Record<string, string>; // goal key -> preferred cta_button when the platform offers it
  singlishAllowed: boolean;
  regulators: string;
  rules: string[];            // prompt lines
  seasons: string[];
};

const CTA_DEFAULT = { sales: "SHOP_NOW", bookings: "BOOK_NOW", messages: "SEND_MESSAGE", awareness: "LEARN_MORE" };

export const marketRules: Record<Market, MarketRules> = {
  SG: {
    code: "SG", name: "Singapore", currency: "SGD", spelling: "UK", priceIncludesTax: true, singlishAllowed: true,
    defaultCtas: { ...CTA_DEFAULT, messages: "WHATSAPP_MESSAGE" },
    regulators: "ASAS/SCAP, CCCS (Consumer Protection (Fair Trading) Act), MUIS for halal",
    rules: [
      "Prices include GST. 'Free' needs its conditions in the same sentence (SCAP/CCCS). 'Was/now' prices need the higher price charged for 28 consecutive days in the past 6 months.",
      "WhatsApp is the normal messaging channel for food and services.",
    ],
    seasons: ["Ramadan and Hari Raya", "Chinese New Year", "Deepavali", "National Day", "payday (25th)", "GSS and 11.11 sales", "school holidays"],
  },
  US: {
    code: "US", name: "United States", currency: "USD", spelling: "US", priceIncludesTax: null, singlishAllowed: false,
    defaultCtas: CTA_DEFAULT,
    regulators: "FTC (Section 5, Endorsement Guides, Made in USA rule), FDA and state law for health and food claims, state privacy laws",
    rules: [
      "Prices exclude sales tax unless the brief says otherwise; never write 'tax included' or 'all-in'. Use US spelling, dollars and imperial units.",
      "Endorsements and reviews must be real, typical and disclosed when paid or gifted (FTC). Never fabricate or synthesize customer reviews.",
      "'Free' offers must state material conditions clearly. 'Made in USA' or 'American-made' only if the brief says so. No disease, treatment or prevention claims for food or supplements (FDA); no unproven health claims.",
      "Reference prices ('was $X') must be real prices the product recently sold for.",
    ],
    seasons: ["Valentine's Day", "Mother's Day", "Memorial Day", "4th of July", "Back to school", "Halloween", "Thanksgiving", "Black Friday and Cyber Monday", "Christmas", "New Year"],
  },
  CA: {
    code: "CA", name: "Canada", currency: "CAD", spelling: "UK", priceIncludesTax: null, singlishAllowed: false,
    defaultCtas: CTA_DEFAULT,
    regulators: "Competition Bureau (Competition Act: misleading advertising and regular-price claims), Ad Standards, CASL for email, Quebec's Charter of the French Language",
    rules: [
      "Prices exclude GST/HST/PST unless the brief says otherwise. Use Canadian spelling (colour, centre) and dollars.",
      "Price claims such as 'was/regular price' must be genuine. Testimonials must be real and typical. No misleading 'free' offers.",
      "If the business serves Quebec, note in missing_inputs that French advertising may be required; do not write French unless asked.",
    ],
    seasons: ["Family Day", "Victoria Day", "Canada Day", "Thanksgiving (October)", "Halloween", "Black Friday", "Boxing Day", "Christmas", "back to school"],
  },
  AU: {
    code: "AU", name: "Australia", currency: "AUD", spelling: "UK", priceIncludesTax: true, singlishAllowed: false,
    defaultCtas: CTA_DEFAULT,
    regulators: "ACCC (Australian Consumer Law), Ad Standards, TGA for therapeutic claims, Spam Act for email",
    rules: [
      "Display one price that includes GST. Use Australian spelling (colour, organise) and dollars.",
      "Do not make false or misleading claims; 'free' offers need clear conditions; reference ('was') prices must be genuine; 'Made in Australia' claims need substantiation in the brief.",
      "No therapeutic or health-outcome claims for food or products (TGA).",
    ],
    seasons: ["Australia Day", "Easter", "Anzac Day", "Mother's Day", "EOFY sales (June)", "Black Friday", "Christmas and Boxing Day", "back to school"],
  },
};

export const defaultMarket = (): Market => {
  const value = process.env.DEFAULT_MARKET?.trim().toUpperCase();
  return value && value in marketRules ? (value as Market) : "SG";
};
export const marketOf = (brand: Pick<Brand, "market">): Market => brand.market ?? defaultMarket();

export function marketBlock(market: Market) {
  const m = marketRules[market];
  return `MARKET: ${m.name} (${m.code}). Currency ${m.currency}; ${m.spelling} spelling. Regulators and codes to respect: ${m.regulators}.\n${m.rules.map(r => `- ${r}`).join("\n")}\n- Seasonal moments to use only when real and relevant: ${m.seasons.join("; ")}.\n- Guidance only, not legal advice: when unsure, add the doubt to missing_inputs and set needs_human_review.`;
}
