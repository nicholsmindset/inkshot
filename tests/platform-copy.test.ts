import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { demoBrand, sampleConcepts } from "../server/brand.js";
import { generatePlatformCopy, sampleCopy } from "../server/copy/pipeline.js";
import { platformSystemPrompt, SHARED_CORE } from "../server/copy/prompts.js";
import { enabledPlatforms, platformSpecs } from "../server/copy/specs.js";
import type { Brand } from "../shared/types.js";
import { countChars, errorsOf, validateSet, validateVariant, type Context, type Variant } from "../server/copy/validate.js";

const brand: Brand = { ...demoBrand, certifications: { muisHalal: "not_certified" } };
const concepts = sampleConcepts(brand, "Order by Friday for weekend delivery.").slice(0, 3);
const context: Context = { brand, offer: "Order by Friday for weekend delivery.", endDate: null, conceptIds: concepts.map(c => c.id), variantsPerConcept: 2 };
const variant = (fields: Record<string, unknown>, extra: Partial<Variant> = {}): Variant => ({
  variant_id: "A1", concept_id: concepts[0].id, placement: "feed", angle: "offer", funnel_stage: "cold", hook_type: "bold_claim",
  fields, ai_disclosure_required: false, needs_human_review: false, compliance_notes: [], ...extra });
const rules = (platform: Parameters<typeof validateVariant>[0], fields: Record<string, unknown>, ctx = context) => validateVariant(platform, variant(fields), ctx).map(v => v.rule);

test("platform specs are config: defaults are Facebook, Instagram and TikTok, overridable and validated", () => {
  assert.deepEqual(enabledPlatforms({}), ["facebook", "instagram", "tiktok"]);
  assert.deepEqual(enabledPlatforms({ COPY_PLATFORMS: "tiktok, x" }), ["tiktok", "x"]);
  assert.throws(() => enabledPlatforms({ COPY_PLATFORMS: "myspace" }), /unknown platforms/);
  // Limits are generated into the prompt from config, never typed into the prompt text.
  const prompt = platformSystemPrompt("tiktok");
  assert.match(prompt, /ad_text: at most 100 characters/);
  assert.match(SHARED_CORE, /untrusted data/);
  const spec = platformSpecs.tiktok.fields.ad_text; const original = spec.max;
  try { (spec as { max: number }).max = 90; assert.match(platformSystemPrompt("tiktok"), /ad_text: at most 90 characters/); }
  finally { (spec as { max: number }).max = original as number; }
});

test("validator counts graphemes and CJK, and enforces length, CTA, hashtags and plain-text fields", () => {
  assert.equal(countChars("Hi 👍🏽"), 4, "an emoji with a skin tone is one grapheme");
  assert.equal(countChars("清真"), 4, "CJK counts double");
  assert(rules("facebook", { primary_text: "x".repeat(126), headline: "ok", cta_button: "SHOP_NOW" }).includes("length"));
  assert(!rules("facebook", { primary_text: "x".repeat(125), headline: "Fresh loaves daily", cta_button: "SHOP_NOW" }).includes("length"));
  assert(rules("facebook", { primary_text: "Fresh", cta_button: "BUY" }).includes("cta"));
  assert(rules("instagram", { primary_text: "Fresh", cta_button: "SHOP_NOW", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }).includes("hashtags"));
  assert(!rules("instagram", { primary_text: "Fresh", cta_button: "SHOP_NOW", hashtags: ["#a", "#b", "#c", "#d", "#e"] }).includes("hashtags"));
  assert(rules("tiktok", { ad_text: "Fresh bread #sgfoodie", cta_button: "SHOP_NOW" }).includes("plain_text"));
  assert(rules("tiktok", { ad_text: "Fresh bread 🍞", cta_button: "SHOP_NOW" }).includes("plain_text"));
  assert(rules("tiktok", { ad_text: "Fresh bread at humblebakes.sg", cta_button: "SHOP_NOW" }).includes("plain_text"));
  assert(!rules("tiktok", { spark_caption: "Fresh bread 🍞 #sgfoodie", hashtags: ["#sgfoodie"], cta_button: "SHOP_NOW" }).includes("plain_text"), "Spark captions may carry emoji and hashtags");
  assert(rules("tiktok", { ad_text: "Fresh bread", cta_button: "SHOP_NOW", }).length === 0);
  assert(rules("tiktok", { ad_text: "Fresh", cta_button: "SHOP_NOW" }).length === 0);
  assert(validateVariant("tiktok", variant({ ad_text: "Fresh", cta_button: "SHOP_NOW" }, { video_script: { hook_0_3s: { on_screen_text: "one two three four five six seven eight" } } }), context).some(v => v.rule === "overlay"));
});

test("validator enforces policy: personal attributes, superlatives, urgency, free, halal and the claims guard", () => {
  const ok = { cta_button: "SHOP_NOW" };
  assert(rules("facebook", { ...ok, primary_text: "Are you struggling with debt?" }).includes("personal_attributes"));
  assert(rules("facebook", { ...ok, primary_text: "Do you have diabetes? Try this." }).includes("personal_attributes"));
  assert(!rules("facebook", { ...ok, primary_text: "New low-sugar loaves, baked daily." }).includes("personal_attributes"));
  assert(rules("facebook", { ...ok, primary_text: "The best in Singapore" }).includes("superlative"));
  assert(rules("facebook", { ...ok, primary_text: "Guaranteed fresh" }).includes("guarantee"));
  assert(rules("facebook", { ...ok, primary_text: "Limited time only" }).includes("urgency"));
  assert(!rules("facebook", { ...ok, primary_text: "Ends tonight" }, { ...context, endDate: "2026-12-01" }).includes("urgency"));
  assert(rules("facebook", { ...ok, primary_text: "Free cookies for everyone" }).includes("free"));
  assert(!rules("facebook", { ...ok, primary_text: "Free delivery with orders over 40 dollars" }).includes("free"));
  // Halal: refused without attestation, including the 'friendly' workaround.
  assert(rules("facebook", { ...ok, primary_text: "Halal cakes made fresh" }).includes("claims"));
  assert(rules("facebook", { ...ok, primary_text: "Halal-friendly cakes" }).includes("muslim_friendly"));
  const certified = { ...context, brand: { ...brand, certifications: { muisHalal: "attested" as const, certificateId: "7d0c9c7e-4f0b-4b8f-8d6b-0a1a2f3b4c5d" } } };
  assert(!rules("facebook", { ...ok, primary_text: "Halal cakes made fresh" }, certified).includes("claims"));
  assert(rules("facebook", { ...ok, primary_text: "Everything is only S$5" }).includes("claims"), "an unapproved price is blocked by the claims guard");
});

test("set validation requires 2 distinct variants per angle, with distinct hooks and openings", () => {
  const sets = concepts.flatMap((c, i) => [0, 1].map(j => variant({ primary_text: `Opening ${i}${j} words here`, cta_button: "SHOP_NOW" }, { variant_id: `V${i}${j}`, concept_id: c.id, hook_type: j ? "curiosity" : "offer_first" })));
  assert.equal(validateSet("facebook", sets, context).length, 0);
  assert(validateSet("facebook", sets.slice(1), context).some(v => v.rule === "coverage"));
  assert(validateSet("facebook", sets.map(v => ({ ...v, hook_type: "offer_first" })), context).some(v => v.rule === "diversity"));
  assert(validateSet("facebook", sets.map(v => ({ ...v, fields: { ...v.fields, primary_text: "Same three words" } })), context).some(v => v.rule === "diversity"));
});

test("sample copy for every platform follows its own limits and rules", () => {
  for (const platform of Object.keys(platformSpecs) as (keyof typeof platformSpecs)[]) {
    const sample = sampleCopy(platform, brand, concepts, "Enquiries");
    assert.equal(sample.variants.length, 6, platform);
    const violations = errorsOf([...sample.variants.flatMap(v => validateVariant(platform, v as Variant, context)), ...validateSet(platform, sample.variants as Variant[], context)]);
    assert.deepEqual(violations, [], `${platform}: ${JSON.stringify(violations)}`);
  }
});

test("live pipeline repairs once with the exact violations, then flags what remains instead of failing", async () => {
  const good = (platform: string, over = false) => ({
    platform, missing_inputs: [], variants: concepts.flatMap((c, i) => [0, 1].map(j => ({
      variant_id: `V${i}${j}`, concept_id: c.id, placement: "feed", angle: "offer", funnel_stage: "cold", hook_type: j ? "curiosity" : "offer_first",
      fields: { primary_text: `${over && !i && !j ? "x".repeat(130) : "Loaf"} batch ${i}${j} fresh today`, headline: "Fresh loaves daily", cta_button: "SHOP_NOW" },
    }))),
  });
  const calls: { system: string; input: unknown }[] = [];
  const fixed = await generatePlatformCopy({ platform: "facebook", brand, concepts, goal: "Sales", offer: context.offer, campaignMock: false, mode: "live",
    ask: async (system, input) => { calls.push({ system, input }); return calls.length === 1 ? good("facebook", true) : good("facebook"); } });
  assert.equal(calls.length, 2); assert.equal(fixed.repaired, true); assert.equal(fixed.needsReview, false);
  assert.match(calls[1].system, /Copy Critic/); assert.match(JSON.stringify(calls[1].input), /is 1\d\d characters/);
  assert.equal(fixed.aiDisclosure.required, true, "live campaigns need an AI-disclosure checklist");
  assert(fixed.aiDisclosure.steps.some(s => /AI-generated|AI disclosure/.test(s)));

  const stuck = await generatePlatformCopy({ platform: "facebook", brand, concepts, goal: "Sales", offer: context.offer, campaignMock: false, mode: "live", ask: async () => good("facebook", true) });
  assert.equal(stuck.needsReview, true); assert(errorsOf(stuck.violations).some(v => v.rule === "length"));
  await assert.rejects(generatePlatformCopy({ platform: "facebook", brand, concepts, goal: "Sales", offer: context.offer, campaignMock: false, mode: "live", ask: async () => ({ nope: true }) }), /another attempt/);
  await assert.rejects(generatePlatformCopy({ platform: "linkedin", brand, concepts, goal: "Sales", offer: "", campaignMock: true, mode: "mock", ask: async () => ({}) }), /not available/);
});

test("copy API: sample copy in preview, workspace isolation, rewrite cap and disabled platforms", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-copy-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR", "COPY_MAX_RUNS_PER_PLATFORM", "COPY_PLATFORMS"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER; delete process.env.COPY_PLATFORMS;
  Object.assign(process.env, { BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir, COPY_MAX_RUNS_PER_PLATFORM: "2" });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const db = await createDatabase(dir, true);
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
  });
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api`;
  async function merchant(email: string) {
    const response = await fetch(`${origin}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "M", email, password: "a-long-test-password" }) });
    return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  const call = (cookie: string, route: string, body?: object, method?: string) => fetch(origin + route, { method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const [a, b] = [await merchant("copy-a@example.test"), await merchant("copy-b@example.test")];
  await call(a, "/brand", { ...brand, name: "Humble Bakes", website: "https://humblebakes.example.test" }, "PUT");
  const created = await (await call(a, "/campaigns", { name: "Weekend cakes", goal: "Enquiries", offer: "Order by Friday for weekend delivery." })).json() as { id: string };

  const listing = await (await call(a, `/campaigns/${created.id}/copy`)).json() as { platforms: { id: string }[]; specsVersion: string; rewritesAllowed: number };
  assert.deepEqual(listing.platforms.map(p => p.id), ["facebook", "instagram", "tiktok"]);
  assert.equal(listing.rewritesAllowed, 2); assert(listing.specsVersion);

  const first = await call(a, `/campaigns/${created.id}/copy`, { platform: "tiktok" });
  assert.equal(first.status, 200);
  const result = await first.json() as { sample: boolean; variants: unknown[]; violations: { severity: string }[]; needsReview: boolean; aiDisclosure: { steps: string[] } };
  assert.equal(result.sample, true); assert.equal(result.variants.length, 6);
  assert.equal(result.violations.filter(v => v.severity === "error").length, 0); assert.equal(result.needsReview, false);
  assert((await call(a, `/campaigns/${created.id}/copy`, { platform: "tiktok" })).status === 200);
  const capped = await call(a, `/campaigns/${created.id}/copy`, { platform: "tiktok" });
  assert.equal(capped.status, 429); assert.match((await capped.json() as { error: string }).error, /used all 2 copy rewrites/);
  assert.equal((await call(a, `/campaigns/${created.id}/copy`, { platform: "facebook" })).status, 200, "the cap is per platform");

  assert.equal((await call(a, `/campaigns/${created.id}/copy`, { platform: "linkedin" })).status, 400, "disabled platforms are refused");
  assert.equal((await call(b, `/campaigns/${created.id}/copy`, { platform: "tiktok" })).status, 404, "another workspace cannot write copy");
  assert.equal((await call(b, `/campaigns/${created.id}/copy`)).status, 404, "or read it");
  const saved = await (await call(a, `/campaigns/${created.id}/copy`)).json() as { results: Record<string, { run: number }> };
  assert.equal(saved.results.tiktok.run, 2); assert(saved.results.facebook);
  assert.equal(Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM product_events WHERE event='copy_generated'")).rows[0].n), 3);
});

test("campaign_copy migration is additive, idempotent, in both namespaces, server-only", async t => {
  const { readFile } = await import("node:fs/promises");
  const { PGlite } = await import("@electric-sql/pglite");
  const sql = (file: string) => readFile(new URL("../" + file, import.meta.url), "utf8");
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app;");
  await db.exec(await sql("server/schema.sql"));
  await db.exec(await sql("supabase/migrations/20261114140000_deployment_environment.sql"));
  await db.exec(await sql("scripts/setup-shared-live.sql"));
  const migration = await sql("supabase/migrations/20261125090000_campaign_copy.sql");
  await db.exec(migration); await db.exec(migration);
  const tables = (await db.query<{ table_schema: string }>("SELECT table_schema FROM information_schema.tables WHERE table_name='campaign_copy' AND table_schema IN ('public','inkshot_live') ORDER BY 1")).rows.map(r => r.table_schema);
  assert.deepEqual(tables, ["inkshot_live", "public"]);
  assert.equal((await db.query("SELECT 1 FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated','service_role') AND table_name='campaign_copy'")).rows.length, 0);
});

test("market rules change the prompt, brief, defaults and validator for US, Canada and Australia", async () => {
  const { buildBrandBrief } = await import("../server/copy/brief.js");
  const { marketOf } = await import("../server/copy/markets.js");
  const us: Brand = { ...brand, market: "US" };
  assert.match(platformSystemPrompt("facebook", "US"), /United States[\s\S]*FTC[\s\S]*sales tax/);
  assert.match(platformSystemPrompt("facebook", "SG"), /Singapore[\s\S]*GST[\s\S]*WhatsApp/);
  assert.doesNotMatch(platformSystemPrompt("facebook", "US"), /MUIS for halal/);
  const sgBrief = buildBrandBrief({ ...brand, market: "SG" }, { goal: "Enquiries", offer: "" }, 2) as { offer: { currency: string; tax_inclusive: boolean | null }; brand_voice: { singlish_level: number }; campaign: { cta_channel: string } };
  const usBrief = buildBrandBrief(us, { goal: "Enquiries", offer: "" }, 2) as typeof sgBrief;
  assert.deepEqual([sgBrief.offer.currency, sgBrief.offer.tax_inclusive, sgBrief.brand_voice.singlish_level, sgBrief.campaign.cta_channel], ["SGD", true, 2, "whatsapp"]);
  assert.deepEqual([usBrief.offer.currency, usBrief.offer.tax_inclusive, usBrief.brand_voice.singlish_level, usBrief.campaign.cta_channel], ["USD", null, 0, "message"], "Singlish and WhatsApp are Singapore-only");
  assert.equal(marketOf({}), "SG", "existing workspaces stay Singapore");
  assert.equal(sampleCopy("facebook", brand, concepts, "Enquiries").variants[0].fields.cta_button, "WHATSAPP_MESSAGE");
  assert.equal(sampleCopy("facebook", us, concepts, "Enquiries").variants[0].fields.cta_button, "SEND_MESSAGE");
  const usContext: Context = { ...context, market: "US", brand: us };
  assert(validateVariant("facebook", variant({ primary_text: "Our smoothie prevents colds", cta_button: "SHOP_NOW" }), usContext).some(v => v.rule === "health_claim"));
  assert(validateVariant("facebook", variant({ primary_text: "Prices are all-in, tax included", cta_button: "SHOP_NOW" }), usContext).some(v => v.rule === "tax_wording"));
  assert(validateVariant("facebook", variant({ primary_text: "Proudly Made in USA", cta_button: "SHOP_NOW" }), usContext).some(v => v.rule === "origin_claim"));
  assert(!validateVariant("facebook", variant({ primary_text: "Our smoothie prevents colds", cta_button: "SHOP_NOW" }), context).some(v => v.rule === "health_claim"), "market rules apply only outside the Singapore default context");
});
