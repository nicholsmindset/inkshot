import {createHash,randomUUID} from 'node:crypto';
import type {Queryable} from './db.js';
import {briefFields} from './brand.js';

export const eventNames=[
  'signup_completed','email_verified','website_read_started','website_read_succeeded','website_read_failed',
  'brief_saved','brief_fields_edited','angles_selected','campaign_approved','generation_completed','generation_failed',
  'asset_reviewed','download_completed','second_campaign_started','checkout_started','checkout_completed',
  'publish_answer','posted_followup','copy_generated',
] as const;
export type EventName=(typeof eventNames)[number];

export type EventInput={
  workspaceId:string;userId?:string|null;event:EventName;campaignId?:string|null;assetId?:string|null;
  props?:Record<string,string|number|boolean|null|string[]|Record<string,string>>;
  // Same key in the same workspace records once. Omit for events that may repeat.
  dedupeKey?:string;
  // Replace the props of an earlier event with the same key (e.g. a changed answer).
  replace?:boolean;
};

// Best effort: measurement must never break the action being measured, so failures are logged and swallowed.
// Props must be small, structured values. Never pass website text, prompts or file contents.
export async function recordEvent(db:Queryable,input:EventInput){
  try{
    const props=JSON.stringify(input.props??{});
    if(props.length>4000)throw new Error('event props too large');
    await db.query(
      `INSERT INTO product_events(id,workspace_id,user_id,event,campaign_id,asset_id,props,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (workspace_id,dedupe_key) ${input.replace?'DO UPDATE SET props=EXCLUDED.props,created_at=now()':'DO NOTHING'}`,
      [randomUUID(),input.workspaceId,input.userId??null,input.event,input.campaignId??null,input.assetId??null,props,input.dedupeKey??null]);
  }catch(error){
    console.warn(JSON.stringify({level:'warn',message:'product event not recorded',event:input.event,reason:error instanceof Error?error.message.slice(0,120):'unknown'}));
  }
}

// Per-field fingerprints let us say whether a merchant edited an extracted brief field
// without keeping any of the extracted text.
const fieldValue=(brand:Record<string,unknown>,field:string)=>JSON.stringify(brand[field]??'');
const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,12);
export const trackedBriefFields=['name',...briefFields] as const;
export function briefFingerprints(brand:Record<string,unknown>){
  // Only fields that actually have content count towards "accepted without edits".
  return Object.fromEntries(trackedBriefFields.filter(field=>!['""','[]','null'].includes(fieldValue(brand,field))).map(field=>[field,fingerprint(fieldValue(brand,field))]));
}
export function editedBriefFields(extracted:Record<string,string>,saved:Record<string,unknown>){
  return trackedBriefFields.filter(field=>extracted[field]!==undefined&&extracted[field]!==fingerprint(fieldValue(saved,field)));
}
// Stable, text-free reason codes for a failed website read.
export function websiteFailureReason(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/very little readable text/i.test(message))return 'too_little_text';
  if(/could not read that page/i.test(message))return 'unreadable';
  if(/public HTTPS|Only public websites/i.test(message))return 'invalid_url';
  if(/redirected too many/i.test(message))return 'too_many_redirects';
  if(/timed out|timeout|abort/i.test(message))return 'timeout';
  if(/blocked|forbidden|403|401|denied/i.test(message))return 'blocked';
  if(/too many|rate/i.test(message))return 'rate_limited';
  return 'other';
}
