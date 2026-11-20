import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignDraftSchema, currentDraft, requireDraftRevision, validateDraft } from "../server/campaign-drafts.js";
import type { Campaign, CampaignDraft } from "../shared/types.js";
import { demoBrand, sampleConcepts } from "../server/brand.js";
const campaign: Campaign = {
  id: "campaign", name: "Launch", goal: "Sales", offer: "", status: "draft",
  concepts: sampleConcepts(demoBrand, ""), brand: demoBrand, created_at: "", mock: true,
};
test("legacy campaigns have initial drafts without mutating saved campaign data", () => {
  const initial = currentDraft(campaign);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.selectedConceptIds, campaign.concepts.slice(0, 3).map(c => c.id));
  assert.equal(campaign.draft, undefined);
});
test("in-progress selection saves, complete validation rejects missing creative inputs", () => {
  const draft = campaignDraftSchema.parse({ revision: 0, selectedConceptIds: [], assets: [] });
  validateDraft(campaign, draft);
  assert.throws(() => validateDraft(campaign, draft, true));
  const selected = currentDraft(campaign).selectedConceptIds;
  const complete: CampaignDraft = {
    revision: 1, selectedConceptIds: selected,
    assets: selected.flatMap(conceptId => (["video", "image", "post"] as const).map(kind => ({
      conceptId, kind, headline: "", cta: "", prompt: "", motionPrompt: "", caption: "",
    }))),
  };
  validateDraft(campaign, complete);
  assert.throws(() => validateDraft(campaign, complete, true), /Complete every/);
});
test("draft rejects duplicated or foreign concept pairs and stale revisions", () => {
  const initial = currentDraft(campaign);
  assert.throws(() => validateDraft(campaign, { ...initial, selectedConceptIds: ["foreign"] }));
  assert.throws(() => validateDraft(campaign, { ...initial, selectedConceptIds: [initial.selectedConceptIds[0], initial.selectedConceptIds[0]] }));
  assert.throws(() => requireDraftRevision({ ...campaign, draft: { ...initial, revision: 2 } }, 1), /another session/);
  assert.throws(() => requireDraftRevision({ ...campaign, status: "generating" }, 0), /already started/);
});
