import { test } from "node:test";
import assert from "node:assert/strict";
import { brandSchema, demoBrand, sampleConcepts } from "../server/brand.js";
import { groundBrief, validateAssetPrompts } from "../server/claude.js";

test("legacy brands remain valid and unsupported source evidence is discarded", () => {
  assert(brandSchema.safeParse(demoBrand).success);
  const result = groundBrief({ ...demoBrand,
    offer: "Invented half price",
    proof: ["Open every day", "Invented award"],
    pain: "Finding a quiet moment",
    evidence: [
      { field: "proof", sourceUrl: "https://shop.example", excerpt: "Open every day" },
      { field: "pain", sourceUrl: "https://shop.example", excerpt: "Words never supplied" },
      { field: "audience", sourceUrl: "https://other.example", excerpt: "Open every day" },
    ],
  }, [{ url: "https://shop.example", text: "Open every day. Hand poured candles." }]);
  assert.equal(result.evidence?.length, 1);
  assert.deepEqual(result.proof, ["Open every day"]);
  assert.equal(result.offer, "");
  assert(result.inferredFields?.includes("pain"));
});

test("prompt plan must cover every selected angle and include video motion", () => {
  const suggestions = sampleConcepts(demoBrand, "");
  assert.equal(suggestions.length, 6);
  assert.equal(new Set(suggestions.map(item => item.id)).size, 6);
  const selected = suggestions.slice(0, 3);
  const drafts = selected.flatMap(concept => (["video", "image", "post"] as const).map(kind => ({
    conceptId: concept.id, kind, headline: concept.hook, cta: concept.cta,
    prompt: "A concrete scene", ...(kind === "video" ? { motionPrompt: "0–15s slow motion" } : {}),
  })));
  assert.equal(validateAssetPrompts(drafts, selected).length, 9);
  assert.throws(() => validateAssetPrompts([...drafts.slice(0, 8), drafts[0]], selected));
  assert.throws(() => validateAssetPrompts(drafts.map(item => ({ ...item, motionPrompt: undefined })), selected));
});

test("preview offers never become verbatim headlines or overflow the headline limit", () => {
  const instruction = "Preview test only: introduce womenswear. No discount or limited-time offer.";
  const concepts = sampleConcepts({ ...demoBrand, name: "Love, Bonito" }, instruction);
  assert(concepts.every(concept => !concept.hook.includes("Preview test only")));
  assert(concepts.every(concept => concept.hook.length <= 120));
  assert(concepts.find(concept => concept.id === "offer")?.description.includes(instruction));
});
