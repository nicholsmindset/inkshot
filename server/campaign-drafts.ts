import { z } from "zod";
import { AppError, videoDurationSeconds } from "./config.js";
import type { Campaign, CampaignDraft } from "../shared/types.js";
import { isCampaignDestination } from "../shared/destination.js";

export const selectedConceptIdsSchema = z.array(z.string().min(1).max(80)).length(3);
export const assetDraftSchema = z.object({
  conceptId: z.string().min(1).max(80),
  kind: z.enum(["video", "image", "post"]),
  headline: z.string().trim().max(120),
  cta: z.string().trim().max(55),
  prompt: z.string().trim().max(4000),
  motionPrompt: z.string().trim().max(4000).optional(),
  caption: z.string().trim().max(4000).optional(),
});
export const campaignDraftSchema = z.object({
  videoDurationSeconds: z.number().int().min(3).max(15).optional(),
  revision: z.number().int().min(0),
  selectedConceptIds: z.array(z.string().min(1).max(80)).max(3),
  assets: z.array(assetDraftSchema).max(9),
  destinationUrl: z.string().trim().refine(isCampaignDestination, "Enter a full HTTPS destination URL.").optional(),
  photoId: z.string().uuid().optional(),
});
export function currentDraft(campaign: Campaign): CampaignDraft {
  if (campaign.draft) return { ...campaign.draft, videoDurationSeconds: campaign.draft.videoDurationSeconds ?? (campaign.draft.assets.length ? 15 : videoDurationSeconds()) };
  return {
    videoDurationSeconds: videoDurationSeconds(),
    revision: 0,
    selectedConceptIds: campaign.concepts.slice(0, 3).map(concept => concept.id),
    assets: [],
    ...(campaign.brand.photoId && { photoId: campaign.brand.photoId }),
    ...(isCampaignDestination(campaign.brand.destinationUrl || campaign.brand.website) && { destinationUrl: campaign.brand.destinationUrl || campaign.brand.website }),
  };
}
export function validateDraft(campaign: Campaign, draft: CampaignDraft, complete = false) {
  const validIds = new Set(campaign.concepts.map(concept => concept.id));
  if ((complete && draft.selectedConceptIds.length !== 3) || new Set(draft.selectedConceptIds).size !== draft.selectedConceptIds.length ||
      draft.selectedConceptIds.some(id => !validIds.has(id))) {
    throw new AppError(400, "Choose three different angles from this campaign.");
  }
  if (!draft.assets.length && !complete) return;
  if (draft.selectedConceptIds.length !== 3) throw new AppError(400, "Choose three angles before writing prompts.");
  const expected = new Set(draft.selectedConceptIds.flatMap(id => ["video", "image", "post"].map(kind => `${id}:${kind}`)));
  for (const asset of draft.assets) {
    if (!expected.delete(`${asset.conceptId}:${asset.kind}`))
      throw new AppError(400, "Review each selected campaign asset exactly once.");
    if (complete && (!asset.headline.trim() || !asset.cta.trim() || !asset.prompt.trim()))
      throw new AppError(400, "Complete every headline, call to action and visual prompt.");
    if (complete && asset.kind === "post" && !asset.caption?.trim())
      throw new AppError(400, "Add a caption for each organic post.");
    if (complete && asset.kind === "video" && !asset.motionPrompt?.trim())
      throw new AppError(400, "Add motion instructions for each video.");
  }
  if (expected.size) throw new AppError(400, "Write and review all nine prompts before continuing.");
}
export function requireDraftRevision(campaign: Campaign, revision: number) {
  if (campaign.status !== "draft") throw new AppError(409, "This campaign has already started generating.");
  if (currentDraft(campaign).revision !== revision)
    throw new AppError(409, "This draft changed in another session. Reload it before saving.");
}
