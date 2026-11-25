import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBrand, mergeImportedBrief, brandSchema } from "../server/brand.js";
import { resolveWritingMode } from "../server/config.js";
import { BRIEF_PROMPT_VERSION } from "../server/brief-prompt.js";

const identity = { name: "Love, Bonito", website: "https://www.lovebonito.com/sg", description: "SEO description", sources: [{ url: "https://www.lovebonito.com/sg", text: "Imported page" }] };
test("AI summary and evidence survive website identity merge; colours are not invented", () => {
  const ai = { ...emptyBrand, description: "Grounded creative summary", color: "#abcdef", briefPromptVersion: BRIEF_PROMPT_VERSION, sources: [{ url: identity.website, text: "Supporting quote" }] };
  const merged = mergeImportedBrief(ai, identity, true);
  assert.equal(merged.description, ai.description);
  assert.deepEqual(merged.sources, ai.sources);
  assert.equal(merged.name, identity.name);
  assert.equal(merged.color, emptyBrand.color);
  assert.equal(brandSchema.parse(merged).briefPromptVersion, BRIEF_PROMPT_VERSION);
});
test("text-only import stays honest and extracted colours remain authoritative", () => {
  const merged = mergeImportedBrief(emptyBrand, { ...identity, color: "#123456" }, false);
  assert.equal(merged.description, identity.description);
  assert.deepEqual(merged.sources, identity.sources);
  assert.equal(merged.audience, "");
  assert.equal(merged.color, "#123456");
  assert.equal(merged.briefPromptVersion, undefined);
});
test("preview writing requires explicit opt-in without enabling media generation", () => {
  const env = { WRITING_MODE: "live", ALLOW_LIVE_WRITING: "true", GENERATION_MODE: "mock", ALLOW_LIVE_GENERATION: "false", BILLING_MODE: "off" };
  assert.equal(resolveWritingMode("mock", env), "live");
  assert.equal(env.GENERATION_MODE, "mock");
  assert.equal(env.ALLOW_LIVE_GENERATION, "false");
  assert.equal(env.BILLING_MODE, "off");
  assert.equal(resolveWritingMode("mock", { WRITING_MODE: "live" }), "mock");
  assert.equal(resolveWritingMode("live", { WRITING_MODE: "mock", ALLOW_LIVE_WRITING: "true" }), "mock");
  assert.equal(resolveWritingMode("mock", { WRITING_MODE: "typo", ALLOW_LIVE_WRITING: "true" }), "mock");
  assert.equal(resolveWritingMode("mock", {}), "mock");
  assert.equal(resolveWritingMode("live", {}), "live");
});
