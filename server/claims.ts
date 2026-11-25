import type { Brand } from '../shared/types.js';
import type { Queryable } from './db.js';
import { AppError } from './config.js';

// NFKD plus removal of Latin combining accents (other scripts keep theirs) and invisible format characters (soft hyphen, joiners, bidi controls) so spacing and accent tricks do not hide a claim.
const normalize = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f\p{Cf}]/gu, '').replace(/\s+/g, ' ').toLowerCase().trim();
// 'halal' is matched without word boundaries so hashtags such as #halalfoodsg are caught too.
const certification = /halal|\bmuis\b|حلال|清真|ஹலால்|穆斯林|回教/iu;
const certificationMark = /\b(?:certification|certified|halal|muis)\s+(?:logo|mark|seal|badge|symbol)\b/iu;
const valueClaims = /(?:(?:s\$|us\$|sgd|usd|\$|£|€)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|sgd\b|usd\b))/giu;
const promise = /\b(?:guarantee(?:d|s)?|money[- ]back|risk[- ]free|half[- ]price|buy one get one|free (?:shipping|delivery)|\d+\s*(?:star|stars)|testimonial|customers? (?:say|said)|rated \d|best[- ]selling|number one)\b|(?:^|[^\w])#1\b/iu;

export async function requireOwnedCertificate(db: Queryable, workspaceId: string, brand: Brand, requireCurrent = false) {
  const id = brand.certifications?.certificateId;
  if (!id && brand.certifications?.muisHalal !== 'attested') return;
  if (!id || !(await db.query('SELECT id FROM uploads WHERE id=$1 AND workspace_id=$2', [id, workspaceId])).rows.length)
    throw new AppError(400, 'Upload the certificate to this workspace before enabling certification wording.');
  if (brand.photoId === id || brand.logoId === id)
    throw new AppError(400, 'Use a product photo or business logo for the artwork, not the certification document.');
  if (requireCurrent && brand.certifications?.muisHalal === 'attested') {
    const current = (await db.query<{ brand: Brand }>('SELECT brand FROM workspaces WHERE id=$1', [workspaceId])).rows[0]?.brand;
    if (current?.certifications?.muisHalal !== 'attested' || current.certifications.certificateId !== id)
      throw new AppError(400, 'Certification was changed or withdrawn. Create a campaign from the current brief.');
  }
}

// User-approved brief/offer are the only sources. Website excerpts and model output
// do not approve claims, nor does an uploaded document verify its authenticity.
export function assertApprovedClaims(text: string | undefined, brand?: Brand, campaignOffer = '') {
  const clean = normalize(text || "");
  if (!clean) return;
  if (certification.test(clean) && !(brand?.certifications?.muisHalal === 'attested' && brand.certifications.certificateId))
    throw new AppError(400, 'Your text mentions halal or MUIS certification. If you are MUIS-certified, confirm it under Your brand and upload your certificate. If not, remove that wording from your brief, offer or captions.');
  const facts = normalize([brand?.name, brand?.description, brand?.offer, ...(brand?.proof || []), campaignOffer].filter(Boolean).join('\n'));
  const approvedValues = new Set(facts.match(valueClaims) || []);
  for (const value of clean.match(valueClaims) || []) {
    if (!approvedValues.has(value)) throw new AppError(400, 'This price or discount is not in the approved brief or campaign offer. Update the brief first.');
  }
  for (const sentence of clean.split(/(?<=[.!?])\s+|\n+/)) {
    if ((promise.test(sentence) || /[“"]([^”"]{8,})[”"]/u.test(sentence)) && !facts.includes(sentence))
      throw new AppError(400, 'This testimonial or guarantee is not in the approved brief. Use the exact approved wording.');
  }
}

export function assertVisualClaims(text: string, brand?: Brand, campaignOffer = '') {
  assertApprovedClaims(text, brand, campaignOffer);
  // Certification marks never go to the model, even for an attested workspace.
  // Remove only these exact prohibitions, never an arbitrary "no ..." span:
  // "No text or logos. Add a MUIS seal" must still be refused.
  let clean = normalize(text);
  for (const prohibition of [
    'no rendered text, logos or watermarks', 'no rendered text or logos',
    'no text or logos', 'no text, no logos', 'no logos or watermarks',
    'never draw certification marks', 'no certification marks',
  ]) clean = clean.replaceAll(prohibition, '');
  if (certificationMark.test(clean) || (certification.test(clean) && /\b(?:logo|mark|seal|badge|symbol)s?\b/iu.test(clean)))
    throw new AppError(400, 'Remove certification marks from the visual prompt. Inkshot does not generate certification marks.');
}
