import type { Brand } from "../../shared/types.js";
import { assertApprovedClaims } from "../claims.js";
import { AppError } from "../config.js";
import { limitFor, platformSpecs, type PlatformId, type Stage } from "./specs.js";

// Deterministic checks. LLMs miscount characters and forget rules, so these run in code
// before anything reaches the merchant, and again after any repair.
export type Violation = { variantId: string; field: string; rule: string; message: string; severity: "error" | "warn" };
export type Variant = {
  variant_id: string; concept_id: string; placement: string; angle: string; funnel_stage: Stage;
  framework?: string; hook_type: string; language?: string;
  fields: Record<string, unknown>;
  video_script?: unknown; self_scores?: Record<string, number>;
  ai_disclosure_required: boolean; needs_human_review: boolean; compliance_notes: string[];
};
export type Context = { market?: "SG" | "US" | "CA" | "AU"; brand: Brand; offer: string; endDate?: string | null; conceptIds: string[]; variantsPerConcept?: number };

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const cjk = /[⺀-鿿가-힯＀-￯぀-ヿ]/u;
// Graphemes (an emoji or accented letter is one), with CJK counted double as platforms do.
export function countChars(text: string) {
  let total = 0;
  for (const { segment } of segmenter.segment(text)) total += cjk.test(segment) ? 2 : 1;
  return total;
}
const emoji = /\p{Extended_Pictographic}/u;
const links = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|sg|co|net|org|io)\b/i;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

// Personal-attribute pairing (Meta): "you/your" + health, body, money, faith, ethnicity, age, orientation, disability, record.
const attributes = "(?:diabet\\w*|overweight|obese|fat|skinny|depress\\w*|anxi\\w*|sick|ill|disabled|disabilit\\w*|bankrupt|broke|in debt|debt|poor|unemployed|muslim|christian|buddhist|hindu|chinese|malay|indian|gay|lesbian|trans\\w*|single|divorced|pregnan\\w*|old|elderly|criminal|convicted|struggling with)";
const personal = new RegExp(`\\b(?:are you|do you have|have you got|you(?:'re| are| have|'ve)|your)\\s+(?:\\w+\\s+){0,2}${attributes}\\b|\\b(?:are you|do you)\\s+(?:struggle|suffer)\\w*`, "iu");
const banned: [string, RegExp, string, "error" | "warn"][] = [
  ["guarantee", /\bguarantee(?:d|s)?\b/iu, "Do not guarantee results.", "error"],
  ["cure", /\b(?:cures?|miracle|heal(?:s|ed)?)\b/iu, "No cure or medical claims.", "error"],
  ["superlative", /\b(?:best in|no\.?\s?1|number one|#1|cheapest|world[- ]class|unbeaten)\b/iu, "Superlatives need substantiation the brief does not contain.", "error"],
  ["before_after", /\bbefore (?:and|&|\/) ?after\b/iu, "No before/after framing.", "error"],
  ["income", /\b(?:earn|make)\s+\$?\d[\d,]*\s*(?:\/|per|a)\s*(?:day|week|month|hour)\b/iu, "No income promises.", "error"],
  ["competitor", /\b(?:unlike|better than|worse than)\s+(?:other|our competitors|them)\b/iu, "Do not disparage competitors.", "error"],
  ["muslim_friendly", /\b(?:muslim|halal)[- ]friendly\b/iu, "Do not imply certification with 'Muslim-friendly' or 'halal-friendly'.", "error"],
];
const healthClaims = /\b(?:treats?|prevents?|reverses?|detox(?:es|ify)?|boosts? (?:immunity|metabolism)|anti[- ]?inflammatory|lowers? (?:cholesterol|blood pressure)|fights? (?:disease|cancer))\b/iu;
const urgency = /\b(?:limited[- ]time|limited period|ends? (?:soon|today|tonight|tomorrow)|last chance|hurry|while stocks? last|only \d+ left|today only)\b/iu;
const freeWord = /\bfree\b/iu;
const freeConditions = /\b(?:with|when|over|above|min(?:imum)?|spend|orders? of|if you|for orders|terms|t&cs?|conditions?|while|from)\b/iu;

export function textFields(fields: Record<string, unknown>) {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") out.push([key, value]);
    else if (Array.isArray(value)) value.forEach((item, i) => {
      if (typeof item === "string") out.push([`${key}[${i}]`, item]);
      else if (item && typeof item === "object") for (const [k, v] of Object.entries(item)) if (typeof v === "string") out.push([`${key}[${i}].${k}`, v]);
    });
  }
  return out;
}

export function validateVariant(platform: PlatformId, variant: Variant, context: Context): Violation[] {
  const spec = platformSpecs[platform];
  const out: Violation[] = [];
  const add = (field: string, rule: string, message: string, severity: "error" | "warn" = "error") => out.push({ variantId: variant.variant_id, field, rule, message, severity });
  const texts = textFields(variant.fields);

  for (const [field, limit] of Object.entries(spec.fields) as [string, { max: number | Record<Stage, number> }][]) {
    const value = variant.fields[field];
    if (typeof value !== "string") continue;
    const max = limitFor(limit, variant.funnel_stage);
    const length = countChars(value) + (spec.linkCost ? (value.match(/https?:\/\/\S+/g) ?? []).reduce((n, l) => n + spec.linkCost! - countChars(l), 0) : 0);
    if (length > max) add(field, "length", `${field} is ${length} characters; the limit is ${max}.`);
  }
  const cta = variant.fields.cta_button;
  if (spec.ctaButtons) {
    if (typeof cta !== "string" || !(spec.ctaButtons as readonly string[]).includes(cta)) add("cta_button", "cta", `cta_button must be one of ${spec.ctaButtons.join(", ")}.`);
  }
  // Hashtags: explicit list plus any #tags written in text.
  const tagList = Array.isArray(variant.fields.hashtags) ? variant.fields.hashtags.filter((t): t is string => typeof t === "string") : [];
  const inline = texts.filter(([k]) => k !== "hashtags" && !k.startsWith("hashtags[")).flatMap(([, v]) => v.match(/(?<![\w&])#[\p{L}\p{N}_]+/gu) ?? []);
  if (new Set([...tagList, ...inline].map(t => t.toLowerCase())).size > spec.hashtags.max) add("hashtags", "hashtags", `Use at most ${spec.hashtags.max} hashtags on ${spec.label}.`);
  const plain = ("plainTextFields" in spec ? (spec.plainTextFields as readonly string[] | undefined) : undefined) ?? [];
  for (const [field, text] of texts) {
    const base = field.replace(/\[.*$/, "");
    if (plain.includes(base)) {
      if (/[#@]/.test(text) || links.test(text)) add(field, "plain_text", `${field} cannot contain hashtags, @ mentions or links.`);
      if (emoji.test(text)) add(field, "plain_text", `${field} cannot contain emoji.`);
    }
  }
  for (const [field, text] of texts) {
    if (field === "cta_button" || field === "hashtags") continue;
    if (personal.test(text)) add(field, "personal_attributes", "Do not pair 'you/your' with a personal attribute (health, body, money, religion, ethnicity, age, orientation, disability).");
    for (const [rule, pattern, message, severity] of banned) if (pattern.test(text)) add(field, rule, message, severity);
    if (urgency.test(text) && !context.endDate) add(field, "urgency", "Urgency needs a real end date in the brief.");
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) if (freeWord.test(sentence) && !freeConditions.test(sentence)) add(field, "free", "State the conditions of a 'free' offer in the same sentence.", "warn");
    if (context.market && context.market !== "SG") {
      if (healthClaims.test(text)) add(field, "health_claim", "No disease, treatment or health-outcome claims.");
      if (/\btax(?:es)?[- ]?(?:included|inclusive|incl\.?)\b|\ball[- ]in\b/iu.test(text) && (context.market === "US" || context.market === "CA")) add(field, "tax_wording", "Do not imply tax is included; tax is added at checkout.", "warn");
      if (/\bmade in (?:the )?(?:usa|u\.s\.a\.?|america|australia|canada)\b|\b(?:american|australian|canadian)[- ]made\b/iu.test(text) && !/made in|american-made|australian made|canadian/i.test(`${context.brand.description} ${context.brand.proof.join(" ")}`)) add(field, "origin_claim", "Origin claims such as 'Made in USA' need support in the brief.");
    }
    try { assertApprovedClaims(text, context.brand, context.offer); }
    catch (error) { add(field, "claims", error instanceof AppError ? error.message : "Claim is not supported by the approved brief."); }
  }
  // Overlay cards: at most 7 words each.
  const script = variant.video_script as { hook_0_3s?: { on_screen_text?: string }; body?: { on_screen_text?: string }[]; cta_close?: { on_screen_text?: string } } | undefined;
  const cards = [script?.hook_0_3s?.on_screen_text, ...(script?.body ?? []).map(b => b.on_screen_text), script?.cta_close?.on_screen_text].filter((c): c is string => typeof c === "string");
  cards.forEach((card, i) => { if (words(card).length > 7) add(`video_script.card${i + 1}`, "overlay", `On-screen text is ${words(card).length} words; keep each card to 7 or fewer.`); });
  for (const card of cards) {
    try { assertApprovedClaims(card, context.brand, context.offer); } catch (e) { add("video_script", "claims", e instanceof AppError ? e.message : "Claim is not supported."); }
  }
  return out;
}

// Set-level: every selected angle gets the expected number of variants, and variants differ.
export function validateSet(platform: PlatformId, variants: Variant[], context: Context): Violation[] {
  const out: Violation[] = [];
  const per = context.variantsPerConcept ?? 2;
  for (const id of context.conceptIds) {
    const mine = variants.filter(v => v.concept_id === id);
    if (mine.length !== per) out.push({ variantId: "*", field: "variants", rule: "coverage", severity: "error", message: `Expected ${per} variants for angle ${id}, got ${mine.length}.` });
  }
  for (const v of variants) if (!context.conceptIds.includes(v.concept_id)) out.push({ variantId: v.variant_id, field: "concept_id", rule: "coverage", severity: "error", message: `Unknown angle ${v.concept_id}.` });
  const key = (v: Variant) => `${v.concept_id}`;
  for (const id of new Set(variants.map(key))) {
    const group = variants.filter(v => key(v) === id);
    if (new Set(group.map(v => v.hook_type)).size < group.length) out.push({ variantId: group[0].variant_id, field: "hook_type", rule: "diversity", severity: "error", message: "Variants of one angle must use different hook types." });
  }
  const openings = variants.map(v => words(String(v.fields.primary_text ?? v.fields.ad_text ?? v.fields.spark_caption ?? v.fields.organic_caption ?? "")).slice(0, 3).join(" ").toLowerCase()).filter(Boolean);
  if (new Set(openings).size < openings.length) out.push({ variantId: "*", field: "primary_text", rule: "diversity", severity: "error", message: "No two variants may open with the same first three words." });
  void platform;
  return out;
}
export const errorsOf = (violations: Violation[]) => violations.filter(v => v.severity === "error");
