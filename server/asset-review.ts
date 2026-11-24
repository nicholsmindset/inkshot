import { createHash } from 'node:crypto';
import type { Queryable } from './db.js';
import { AppError, config } from './config.js';

export const exportReviewRequired = () => config.mode === 'live' || process.env.ENABLE_EXPORT_REVIEW === 'true';
export function reviewFingerprint(version: { id: string; headline: string; cta: string; prompt: string; motion_prompt?: string | null }, caption: string, destinationUrl?: string) {
  return createHash('sha256').update(JSON.stringify([version.id,version.headline,version.cta,version.prompt,version.motion_prompt ?? '',caption,destinationUrl ?? ''])).digest('hex');
}
export async function ownedReview(db: Queryable, workspaceId: string, versionId: string) {
  const row = (await db.query<{id:string;asset_id:string;status:string;headline:string;cta:string;prompt:string;motion_prompt:string|null;review_fingerprint:string|null;caption:string;brand:{destinationUrl?:string}}>(
    `SELECT v.id,v.asset_id,v.status,v.headline,v.cta,v.prompt,v.motion_prompt,v.review_fingerprint,a.caption,c.brand
     FROM versions v JOIN assets a ON a.id=v.asset_id AND a.workspace_id=v.workspace_id
     JOIN campaigns c ON c.id=a.campaign_id AND c.workspace_id=a.workspace_id
     WHERE v.id=$1 AND v.workspace_id=$2`, [versionId,workspaceId])).rows[0];
  if(!row || row.status!=='ready')throw new AppError(404,'That version is not ready.');
  const fingerprint=reviewFingerprint(row,row.caption,row.brand.destinationUrl);
  return {...row,fingerprint,reviewed:row.review_fingerprint===fingerprint};
}
export async function assertExportReviewed(db:Queryable,workspaceId:string,versionIds:string[]) {
  if(!exportReviewRequired())return;
  for(const versionId of versionIds) {
    if(!(await ownedReview(db,workspaceId,versionId)).reviewed)
      throw new AppError(409,'Review each selected creative before downloading. Check its product, offer, claims, logo, safe area, caption and destination.');
  }
}
