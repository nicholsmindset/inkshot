// Platform copy limits. These are RECOMMENDED DISPLAY LENGTHS from vendor help pages and
// secondary sources, not hard maxima, and they change. Keep every number here (never in
// prompts), bump SPECS_VERSION when edited, and re-verify quarterly against Meta's Ads Guide,
// TikTok's Business Help Center, LinkedIn's ad specs, Google Ads Help, X Business and Pinterest.
// Sources and known conflicts: docs/copy/PLATFORM_COPY.md.
export const SPECS_VERSION = "2026-11-24";
export const SPECS_REVERIFY_BY = "2027-02-24";

export type Stage = "cold" | "warm" | "hot";
export type FieldLimit = { max: number | Record<Stage, number>; visible?: number; note?: string };
export type PlatformSpec = {
  label: string;
  // Enabled by default; the rest need COPY_PLATFORMS to include them.
  defaultEnabled: boolean;
  fields: Record<string, FieldLimit>;
  ctaButtons?: readonly string[];
  hashtags: { max: number; allowedIn?: string[] };
  // Fields where emoji, links, @ mentions or hashtags must not appear (e.g. TikTok non-Spark ad text).
  plainTextFields?: string[];
  // A link counts as this many characters (X).
  linkCost?: number;
  // Safe zone for 9:16 video overlays, as fractions of the frame.
  safeZone?: { top: number; bottom: number; side: number; note: string };
  placements: string[];
};

const META_CTAS: readonly string[] = ["SHOP_NOW", "LEARN_MORE", "BOOK_NOW", "SIGN_UP", "ORDER_NOW", "GET_OFFER", "CONTACT_US", "SEND_MESSAGE", "WHATSAPP_MESSAGE", "CALL_NOW", "GET_DIRECTIONS"];

export type PlatformId = "facebook" | "instagram" | "tiktok" | "linkedin" | "youtube_shorts" | "x" | "pinterest" | "threads";
export const platformSpecs: Record<PlatformId, PlatformSpec> = {
  facebook: {
    label: "Facebook", defaultEnabled: true, placements: ["feed", "reels", "stories", "carousel"],
    fields: {
      primary_text: { max: { cold: 125, warm: 500, hot: 500 }, visible: 125, note: "first 40 characters must work alone in Reels" },
      headline: { max: 40, visible: 27 },
      description: { max: 25 },
      reel_hook: { max: 40 },
    },
    ctaButtons: META_CTAS, hashtags: { max: 2 },
    safeZone: { top: 0.14, bottom: 0.35, side: 0.06, note: "Meta 9:16: keep text and logos out of the top 14%, bottom 35% and 6% each side" },
  },
  instagram: {
    label: "Instagram", defaultEnabled: true, placements: ["feed", "reels", "stories", "carousel"],
    fields: {
      primary_text: { max: { cold: 125, warm: 500, hot: 500 }, visible: 125, note: "about 44 characters show on Reels and Stories" },
      headline: { max: 40 },
      organic_caption: { max: 2200, visible: 125, note: "line 1 must hook before the 'more' cut" },
      reel_cover_text: { max: 40, note: "aim for 6 words or fewer" },
    },
    ctaButtons: META_CTAS, hashtags: { max: 5 },
    safeZone: { top: 0.14, bottom: 0.35, side: 0.06, note: "same Meta 9:16 safe zone" },
  },
  tiktok: {
    label: "TikTok", defaultEnabled: true, placements: ["in_feed", "spark", "organic"],
    fields: {
      ad_text: { max: 100, note: "4 lines displayed; about 50 for Chinese, Japanese and Korean" },
      spark_caption: { max: 150, visible: 80 },
      display_name: { max: 20 },
    },
    ctaButtons: ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "BOOK_NOW", "SIGN_UP", "CONTACT_US", "GET_QUOTE", "VISIT_STORE", "DOWNLOAD", "APPLY_NOW"],
    hashtags: { max: 4, allowedIn: ["spark_caption"] }, plainTextFields: ["ad_text"],
    safeZone: { top: 0.07, bottom: 0.25, side: 0.13, note: "TikTok publishes templates, not pixels: keep key text in the centre 70% of the frame" },
  },
  linkedin: {
    label: "LinkedIn", defaultEnabled: false, placements: ["single_image", "video", "carousel", "document", "thought_leader_post", "company_post"],
    fields: {
      intro_text: { max: 600, visible: 150 }, headline: { max: 70 }, description: { max: 100 },
      thought_leader_post: { max: 1300 }, document_title: { max: 70 },
    },
    ctaButtons: ["LEARN_MORE", "DOWNLOAD", "SIGN_UP", "REGISTER", "REQUEST_DEMO", "GET_QUOTE", "CONTACT_US", "APPLY", "SUBSCRIBE"], hashtags: { max: 3 },
  },
  youtube_shorts: {
    label: "YouTube Shorts", defaultEnabled: false, placements: ["shorts"],
    fields: { headline: { max: 40 }, description: { max: 90 }, long_headline: { max: 90 } },
    ctaButtons: ["SHOP_NOW", "LEARN_MORE", "BOOK_NOW", "SIGN_UP", "GET_QUOTE", "VISIT_SITE"], hashtags: { max: 0 },
  },
  x: {
    label: "X", defaultEnabled: false, placements: ["post", "website_card"],
    fields: { post_text: { max: 280 }, card_headline: { max: 70 } }, hashtags: { max: 2 }, linkCost: 23,
  },
  pinterest: {
    label: "Pinterest", defaultEnabled: false, placements: ["pin"],
    fields: { pin_title: { max: 100, visible: 40 }, description: { max: 500 }, overlay_text: { max: 60, note: "10 words or fewer" } },
    hashtags: { max: 0 },
  },
  threads: {
    label: "Threads", defaultEnabled: false, placements: ["ad", "organic"],
    fields: { primary_text: { max: 500, visible: 160 }, headline: { max: 40 }, organic_post: { max: 500 } },
    hashtags: { max: 1 }, plainTextFields: ["primary_text"],
  },
};

export const allPlatforms = Object.keys(platformSpecs) as PlatformId[];

export function enabledPlatforms(env: NodeJS.ProcessEnv = process.env): PlatformId[] {
  const configured = env.COPY_PLATFORMS?.split(",").map(s => s.trim()).filter(Boolean);
  if (!configured?.length) return allPlatforms.filter(id => platformSpecs[id].defaultEnabled);
  const unknown = configured.filter(id => !(id in platformSpecs));
  if (unknown.length) throw new Error(`COPY_PLATFORMS names unknown platforms: ${unknown.join(", ")}`);
  return configured as PlatformId[];
}
export const limitFor = (limit: FieldLimit, stage: Stage) => typeof limit.max === "number" ? limit.max : limit.max[stage];
