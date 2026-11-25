import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Brand, Concept } from "../../shared/types.js";
import { AppError, writingMode } from "../config.js";
import type { Database, Queryable } from "../db.js";
import { marketOf, marketRules } from "./markets.js";
import { buildAngles, buildBrandBrief, funnelStageFor } from "./brief.js";
import { marketBlock } from "./markets.js";
import { COPY_PROMPT_VERSION, limitsBlock, platformSystemPrompt, REPAIR_PROMPT } from "./prompts.js";
import { enabledPlatforms, limitFor, platformSpecs, SPECS_VERSION, type PlatformId } from "./specs.js";
import { countChars, errorsOf, validateSet, validateVariant, type Context, type Variant, type Violation } from "./validate.js";

export type Ask = (system: string, input: unknown, maxTokens?: number) => Promise<unknown>;

const variantSchema = z.object({
  variant_id: z.string().min(1).max(20),
  concept_id: z.string().min(1).max(80),
  placement: z.string().max(40),
  angle: z.string().max(40),
  funnel_stage: z.enum(["cold", "warm", "hot"]),
  framework: z.string().max(40).optional(),
  hook_type: z.string().max(40),
  language: z.string().max(8).optional(),
  fields: z.record(z.string(), z.unknown()),
  video_script: z.unknown().optional(),
  self_scores: z.record(z.string(), z.number()).optional(),
  ai_disclosure_required: z.boolean().default(false),
  needs_human_review: z.boolean().default(false),
  compliance_notes: z.array(z.string().max(300)).default([]),
});
const resultSchema = z.object({
  platform: z.string(),
  variants: z.array(variantSchema).min(1).max(12),
  missing_inputs: z.array(z.string().max(200)).default([]),
});

export type CopyResult = {
  platform: PlatformId; specsVersion: string; promptVersion: string; sample: boolean;
  variants: (Variant & { charCounts: Record<string, number> })[];
  missingInputs: string[]; violations: Violation[]; repaired: boolean; needsReview: boolean;
  aiDisclosure: { required: boolean; steps: string[] };
};

const disclosureSteps: Record<string, string[]> = {
  tiktok: ["In TikTok Ads Manager switch on \"This ad contains AI-generated content\". Undisclosed AI ads can be rejected or restricted."],
  facebook: ["Tick Meta's AI disclosure where it is offered. Meta may add an \"AI info\" label to AI-generated media."],
  instagram: ["Tick Meta's AI disclosure where it is offered. Meta may add an \"AI info\" label to AI-generated media."],
};
const commonDisclosure = "Never present AI-generated people or scenes as real customers, real staff or real reviews.";

function trim(text: string, max: number) {
  if (countChars(text) <= max) return text;
  const cut = text.split(" ");
  while (cut.length > 1 && countChars(cut.join(" ")) > max) cut.pop();
  return cut.join(" ").replace(/[,;:\-–—]+$/, "");
}

// Deterministic sample copy: it follows the same limits and rules so the UI, validator and
// exports can be exercised with no provider spend. It is plain, not a quality claim.
export function sampleCopy(platform: PlatformId, brand: Brand, concepts: Concept[], goal: string): z.infer<typeof resultSchema> {
  const spec = platformSpecs[platform];
  const stage = funnelStageFor(goal);
  const wanted = marketRules[marketOf(brand)].defaultCtas[{ Sales: "sales", Bookings: "bookings", Enquiries: "messages", Awareness: "awareness" }[goal] ?? "awareness"];
  const buttons = spec.ctaButtons as readonly string[] | undefined;
  const cta = buttons ? (buttons.includes(wanted) ? wanted : buttons[0]) : undefined;
  const variants = concepts.flatMap((concept, i) => ([
    { text: concept.hook, hook: "bold_claim" }, { text: `${concept.title}: ${concept.cta}`, hook: "curiosity" },
  ]).map((option, j) => {
    const fields: Record<string, unknown> = {};
    for (const [field, limit] of Object.entries(spec.fields)) {
      const body = field === "display_name" ? brand.name : field.includes("caption") || field === "description" || field === "organic_post" || field === "thought_leader_post" || field === "intro_text" ? `${option.text} ${brand.description}` : option.text;
      fields[field] = trim(body.replace(/[#@]/g, "").replace(/\p{Extended_Pictographic}/gu, ""), limitFor(limit, stage));
    }
    if (cta) fields.cta_button = cta;
    fields.hashtags = [];
    return {
      variant_id: `${String.fromCharCode(65 + i)}${j + 1}`, concept_id: concept.id, placement: spec.placements[0], angle: j ? "curiosity_new" : "offer",
      funnel_stage: stage, framework: "Hook-Body-CTA", hook_type: option.hook, language: "en", fields,
      ai_disclosure_required: false, needs_human_review: false, compliance_notes: ["Sample copy: real copy is written when AI writing is on."],
    };
  }));
  return { platform, variants, missing_inputs: ["Verified testimonials", "Promotion end date", "Usual price"] };
}

function finalise(platform: PlatformId, parsed: z.infer<typeof resultSchema>, violations: Violation[], repaired: boolean, sample: boolean, campaignMock: boolean): CopyResult {
  const variants = parsed.variants.map(v => ({
    ...v, ai_disclosure_required: v.ai_disclosure_required,
    charCounts: Object.fromEntries(Object.entries(v.fields).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, countChars(x as string)])),
  })) as CopyResult["variants"];
  const required = !campaignMock;
  return {
    platform, specsVersion: SPECS_VERSION, promptVersion: COPY_PROMPT_VERSION, sample, variants,
    missingInputs: parsed.missing_inputs, violations, repaired,
    needsReview: errorsOf(violations).length > 0 || variants.some(v => v.needs_human_review),
    aiDisclosure: { required, steps: [...(required ? disclosureSteps[platform] ?? [] : []), commonDisclosure] },
  };
}

export async function generatePlatformCopy(input: {
  platform: PlatformId; brand: Brand & { destinationUrl?: string }; concepts: Concept[]; goal: string; offer: string; campaignMock: boolean;
  singlishLevel?: number; ask: Ask; mode?: "mock" | "live";
}): Promise<CopyResult> {
  const { platform, brand, concepts, goal, offer, ask } = input;
  if (!enabledPlatforms().includes(platform)) throw new AppError(400, "That platform is not available yet.");
  if (concepts.length !== 3) throw new AppError(409, "Choose your three angles first.");
  const market = marketOf(brand);
  const context: Context = { market, brand, offer, endDate: null, conceptIds: concepts.map(c => c.id), variantsPerConcept: 2 };
  const check = (variants: Variant[]) => [...variants.flatMap(v => validateVariant(platform, v, context)), ...validateSet(platform, variants, context)];

  if ((input.mode ?? writingMode()) !== "live") {
    const parsed = resultSchema.parse(sampleCopy(platform, brand, concepts, goal));
    return finalise(platform, parsed, check(parsed.variants as Variant[]), false, true, input.campaignMock);
  }
  const payload = {
    platform, market, brand_brief: buildBrandBrief(brand, { goal, offer, mock: input.campaignMock }, input.singlishLevel ?? 0),
    angles: buildAngles(concepts), placements: platformSpecs[platform].placements,
  };
  const parse = (raw: unknown) => {
    const result = resultSchema.safeParse(raw);
    if (!result.success) throw new AppError(502, "The copy needs another attempt. Please try again.");
    return result.data;
  };
  let parsed = parse(await ask(platformSystemPrompt(platform, market), payload, 7000));
  // The campaign goal decides the length limits, never the model's own funnel_stage.
  const stage = funnelStageFor(goal);
  parsed.variants.forEach(v => { v.funnel_stage = stage; });
  let violations = check(parsed.variants as Variant[]);
  let repaired = false;
  if (errorsOf(violations).length) {
    // One repair pass with the exact violations, then report whatever remains for human review.
    try {
      const fixed = parse(await ask(`${REPAIR_PROMPT}\n\n${marketBlock(market)}\n\n${limitsBlock(platform)}`,
        { ...payload, candidate: parsed, violations: errorsOf(violations) }, 7000));
      fixed.variants.forEach(v => { v.funnel_stage = stage; });
      parsed = fixed;
      violations = check(parsed.variants as Variant[]);
      repaired = true;
    } catch {
      // A failed repair must not throw away the first pass: show it with its violations for review.
    }
  }
  return finalise(platform, parsed, violations, repaired, false, input.campaignMock);
}

// --- persistence: one row per run; the latest ready run per platform is what the merchant sees.
export const maxRunsPerPlatform = () => {
  const n = Number(process.env.COPY_MAX_RUNS_PER_PLATFORM ?? 3);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 3;
};

export async function reserveRun(db: Database, workspaceId: string, campaignId: string, platform: PlatformId) {
  return db.transaction(async tx => {
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
    await tx.query("UPDATE campaign_copy SET status='failed' WHERE campaign_id=$1 AND platform=$2 AND status='running' AND created_at<now()-interval '5 minutes'", [campaignId, platform]);
    if ((await tx.query("SELECT id FROM campaign_copy WHERE campaign_id=$1 AND platform=$2 AND status='running'", [campaignId, platform])).rows.length)
      throw new AppError(409, "Copy for this platform is already being written.");
    const used = Number((await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM campaign_copy WHERE campaign_id=$1 AND platform=$2 AND status='ready'", [campaignId, platform])).rows[0].n);
    // Run numbers are unique per campaign and platform across every status, so a failed run never blocks the next attempt.
    const next = Number((await tx.query<{ n: string }>("SELECT (coalesce(max(run),0)+1)::text AS n FROM campaign_copy WHERE campaign_id=$1 AND platform=$2", [campaignId, platform])).rows[0].n);
    if (used >= maxRunsPerPlatform()) throw new AppError(429, `You've used all ${maxRunsPerPlatform()} copy rewrites for this platform on this campaign.`);
    const id = randomUUID();
    await tx.query("INSERT INTO campaign_copy(id,workspace_id,campaign_id,platform,run,status) VALUES($1,$2,$3,$4,$5,'running')", [id, workspaceId, campaignId, platform, next]);
    return { id, run: next };
  });
}
export const finishRun = (db: Queryable, id: string, result: CopyResult) =>
  db.query("UPDATE campaign_copy SET status='ready',result=$2 WHERE id=$1 AND status='running'", [id, JSON.stringify(result)]);
export const failRun = (db: Queryable, id: string) => db.query("UPDATE campaign_copy SET status='failed' WHERE id=$1", [id]);
export async function latestCopy(db: Queryable, workspaceId: string, campaignId: string) {
  const rows = (await db.query<{ platform: PlatformId; run: number; result: CopyResult; created_at: string }>(
    "SELECT DISTINCT ON (platform) platform,run,result,created_at FROM campaign_copy WHERE workspace_id=$1 AND campaign_id=$2 AND status='ready' ORDER BY platform,run DESC", [workspaceId, campaignId])).rows;
  const counts = (await db.query<{ platform: PlatformId; n: string }>("SELECT platform,count(*)::text AS n FROM campaign_copy WHERE workspace_id=$1 AND campaign_id=$2 AND status='ready' GROUP BY platform", [workspaceId, campaignId])).rows;
  return { results: Object.fromEntries(rows.map(r => [r.platform, { ...r.result, run: r.run, createdAt: r.created_at }])), runs: Object.fromEntries(counts.map(c => [c.platform, Number(c.n)])) };
}
