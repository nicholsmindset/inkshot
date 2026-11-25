import type { Brand } from "../shared/types";

const text = (value: unknown): value is string => typeof value === "string" && value.length <= 12000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.length <= 100 && value.every(check);
function validBrand(value: unknown): value is Brand {
  if (!object(value)) return false;
  if (!["name", "website", "description", "audience", "voice", "offer", "color"].every(key => text(value[key]))) return false;
  if (!["pain", "trigger", "visualDirection", "photoId", "logoUrl", "logoId"].every(key => value[key] === undefined || text(value[key]))) return false;
  if (!list(value.proof, text) || !list(value.sources, item => object(item) && text(item.url) && text(item.text))) return false;
  if (value.evidence !== undefined && !list(value.evidence, item => object(item) && text(item.field) && text(item.sourceUrl) && text(item.excerpt))) return false;
  if (value.inferredFields !== undefined && !list(value.inferredFields, text)) return false;
  const certification = value.certifications;
  return certification === undefined || (object(certification) && (certification.muisHalal === "not_certified" || certification.muisHalal === "attested") && (certification.certificateId === undefined || text(certification.certificateId)));
}
type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const prefix = "inkshot-brand-draft:v1:";
export const brandDraftKey = (userId: string, workspaceId: string) => `${prefix}${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
export function readBrandDraft(storage: DraftStore, key: string, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > 500000) throw new Error("Draft exceeds recovery limit");
    const result: unknown = JSON.parse(raw);
    if (!object(result) || result.version !== 1 || result.owner !== key || typeof result.savedAt !== "number" || !Number.isFinite(result.savedAt) || result.savedAt > now || now - result.savedAt > 86400000 || typeof result.base !== "string" || !validBrand(result.brand))
      throw new Error("Invalid or expired draft");
    return { brand: result.brand, base: result.base };
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be blocked. */ }
    return null;
  }
}
export function writeBrandDraft(storage: DraftStore, key: string, value: Brand, base: Brand, now = Date.now()) {
  try {
    const serialized = JSON.stringify({ version: 1, owner: key, savedAt: now, base: JSON.stringify(base), brand: value });
    if (serialized.length > 500000) return false;
    storage.setItem(key, serialized);
    return true;
  } catch { return false; }
}
export function clearBrandDraft(storage: DraftStore, key: string) {
  try { storage.removeItem(key); } catch { /* Saving/signout must still work. */ }
}
