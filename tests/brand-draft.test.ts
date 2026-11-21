import assert from "node:assert/strict";
import { test } from "node:test";
import { brandDraftKey, clearBrandDraft, readBrandDraft, writeBrandDraft } from "../src/brand-draft.js";
import { emptyBrand } from "../server/brand.js";

function store() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test("brand recovery is isolated by both user and workspace and preserves the saved baseline", () => {
  const storage = store(), key = brandDraftKey("merchant-a", "workspace-a");
  const edited = { ...emptyBrand, name: "Unsaved merchant", offer: "Draft offer", photoId: "owned-photo", certifications: { muisHalal: "not_certified" as const, certificateId: "owned-certificate" } };
  assert(writeBrandDraft(storage, key, edited, emptyBrand, 100));
  const recovered = readBrandDraft(storage, key, 101);
  assert.deepEqual(recovered?.brand, edited);
  assert.equal(recovered?.base, JSON.stringify(emptyBrand));
  assert.equal(readBrandDraft(storage, brandDraftKey("merchant-b", "workspace-a"), 101), null);
  assert.equal(readBrandDraft(storage, brandDraftKey("merchant-a", "workspace-b"), 101), null);
  // Moving a stored payload under another owner must not make it recoverable.
  const other = brandDraftKey("merchant-b", "workspace-b");
  storage.setItem(other, storage.getItem(key)!);
  assert.equal(readBrandDraft(storage, other, 101), null);
  assert.equal(storage.getItem(other), null);
  clearBrandDraft(storage, key);
  assert.equal(readBrandDraft(storage, key, 101), null);
});

test("expired, corrupt and incompatible drafts cannot crash the brand form", () => {
  const storage = store(), key = brandDraftKey("user", "workspace");
  writeBrandDraft(storage, key, emptyBrand, emptyBrand, 10);
  assert.equal(readBrandDraft(storage, key, 86400011), null);
  assert.equal(storage.getItem(key), null);
  for (const raw of ["not-json", JSON.stringify({ version: 1, owner: key, savedAt: 10, base: "{}", brand: { ...emptyBrand, proof: null } }), "x".repeat(500001)]) {
    storage.setItem(key, raw);
    assert.equal(readBrandDraft(storage, key, 11), null);
    assert.equal(storage.getItem(key), null);
  }
  writeBrandDraft(storage, key, emptyBrand, emptyBrand, 20);
  assert.equal(readBrandDraft(storage, key, 10), null);
});

test("blocked browser storage is reported without stopping save or signout", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(writeBrandDraft(blocked, "key", emptyBrand, emptyBrand), false);
  assert.equal(readBrandDraft(blocked, "key"), null);
  assert.doesNotThrow(() => clearBrandDraft(blocked, "key"));
});
