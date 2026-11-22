import { z } from "zod";
import type { Brand, Concept } from "../shared/types.js";
export const briefFields = ["description", "audience", "voice", "offer", "proof", "pain", "trigger", "visualDirection"] as const;
export const brandSchema = z.object({
  name: z.string().trim().min(1).max(100),
  website: z.string().max(2048).default(""),
  description: z.string().max(4000),
  audience: z.string().max(1000),
  voice: z.string().max(300),
  offer: z.string().max(500),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  proof: z.array(z.string().max(500)).max(12),
  sources: z
    .array(z.object({ url: z.string().max(2048), text: z.string().max(600) }))
    .max(12),
  pain: z.string().max(1000).optional(),
  trigger: z.string().max(1000).optional(),
  visualDirection: z.string().max(1500).optional(),
  evidence: z.array(z.object({
    field: z.enum(briefFields),
    sourceUrl: z.url().refine(value => value.startsWith("https://")),
    excerpt: z.string().trim().min(1).max(600),
  })).max(24).optional(),
  inferredFields: z.array(z.enum(briefFields)).max(8).optional(),
  certifications: z.object({
    muisHalal: z.enum(["not_certified", "attested"]),
    certificateId: z.string().uuid().optional(),
  }).refine(value => value.muisHalal !== "attested" || !!value.certificateId, { message: "Upload a certificate before attesting certification." }).optional(),
  photoId: z.string().uuid().optional(),
  logoId: z.string().uuid().optional(),
  logoUrl: z.url().max(2048).optional(),
}).refine(brand => {
  if (!brand.logoUrl) return true;
  try {
    const logo = new URL(brand.logoUrl);
    return logo.protocol === "https:" && !logo.username && !logo.password &&
      logo.origin === new URL(brand.website).origin;
  } catch {
    return false;
  }
}, { message: "Choose an HTTPS logo from the business website.", path: ["logoUrl"] });
export const emptyBrand: Brand = {
  name: "My business",
  website: "",
  description: "",
  audience: "",
  voice: "Warm, clear, thoughtful",
  offer: "",
  color: "#78745a",
  proof: [],
  sources: [],
};
export const demoBrand: Brand = {
  name: "Lumen & Ledger",
  website: "",
  description:
    "Thoughtfully made candles for slower, softer evenings. A fictional candle studio used to explore Inkshot.",
  audience: "People who enjoy creating a calm, welcoming home",
  voice: "Warm, considered, quietly playful",
  offer: "Explore the everyday collection",
  color: "#79755b",
  proof: ["Fictional sample brand"],
  sources: [],
};
export function previewOfferCopy(offer: string): string {
  const text = offer.trim();
  // Preview templates cannot reliably rewrite instructions into advertising copy.
  return text.length <= 120 && !/\b(preview|test only|instructions?|ignore|prompt|do not|don.t|no discount|introduce)\b/i.test(text) ? text : "";
}
export function sampleConcepts(brand: Brand, offer: string): Concept[] {
  return [
    {
      id: "ritual",
      title: "A little everyday ritual",
      hook:
        brand.name === "Lumen & Ledger"
          ? "Make room for slow."
          : `A moment for ${brand.name}.`,
      description: `An inviting introduction to ${brand.name}, built around the feeling customers are looking for.`,
      cta: "Discover more",
    },
    {
      id: "details",
      title: "It’s all in the details",
      hook: "Good things. Thoughtfully made.",
      description: `A closer look at the product or service, using the photos and facts you approve.`,
      cta: "Take a closer look",
    },
    {
      id: "offer",
      title: "Something worth discovering",
      hook: previewOfferCopy(offer) || `Discover ${brand.name}.`.slice(0, 120),
      description:
        offer ? `Build a clear invitation around the approved offer: ${offer}. Keep instructions out of customer-facing copy.` : `Introduce ${brand.name} using the approved description. No invented discounts or promises.`,
      cta: "Explore the collection",
    },
    {
      id: "problem",
      title: "The problem you solve",
      hook: "Make the everyday easier.",
      description: `Show a recognisable situation for ${brand.audience || "the customer"}. ${brand.pain || "Let the approved product or service provide the focus."}`,
      cta: "Find out more",
    },
    {
      id: "process",
      title: "Show how it works",
      hook: "See it in action.",
      description: `Show ${brand.name}'s product or service being used in a realistic setting. Use the approved offering without inventing results.`,
      cta: "Explore how it works",
    },
    {
      id: "occasion",
      title: "The moment it matters",
      hook: "For your next step.",
      description: `Build a scene around ${brand.trigger || "the moment a customer considers the offering"}. Keep the benefit grounded in the approved brief.`,
      cta: "Discover more",
    },
  ];
}
