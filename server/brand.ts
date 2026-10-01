import { z } from "zod";
import type { Brand, Concept } from "../shared/types.js";
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
  photoId: z.string().uuid().optional(),
});
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
      hook: offer || "Find your next favourite.",
      description:
        "A clear invitation with your chosen offer. No invented discounts or promises.",
      cta: "Explore the collection",
    },
  ];
}
