import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Studio } from "../shared/types.js";

test("owned export reviews bind to saved copy and unsupported photo regeneration never debits credits", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-review-api-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "ENABLE_EXPORT_REVIEW", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER;
  Object.assign(process.env, { ENABLE_EXPORT_REVIEW: "true", BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const { tokenHash } = await import("../server/auth.js");
  const { emptyBrand } = await import("../server/brand.js");
  const { runExportOnce } = await import("../server/campaign-exports.js");
  const db = await createDatabase(dir, true);
  const workspace = randomUUID(), otherWorkspace = randomUUID();
  const campaign = randomUUID(), asset = randomUUID(), version = randomUUID(), photo = randomUUID();
  const file = path.join(dir, "fixture.jpg");
  await writeFile(file, "owned test creative");
  const brand = { ...emptyBrand, name: "Candles", photoId: photo, destinationUrl: "https://example.test/offer" };
  for (const [w, token] of [[workspace, "review-owner"], [otherWorkspace, "review-other"]]) {
    const user = randomUUID();
    await db.query("INSERT INTO workspaces(id,brand,credits) VALUES($1,$2,50)", [w, JSON.stringify(brand)]);
    await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash) VALUES($1,$2,'Merchant',$3,'unused')", [user, w, `${user}@example.test`]);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [tokenHash(token), user]);
  }
  await db.query("INSERT INTO uploads(id,workspace_id,file_path) VALUES($1,$2,$3)", [photo, workspace, file]);
  await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES($1,$2,'Launch','sales','[]',$3,true)", [campaign, workspace, JSON.stringify(brand)]);
  await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,caption,current_version_id) VALUES($1,$2,$3,'image','Candle','1:1','Original caption',$4)", [asset, workspace, campaign, version]);
  await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,status,prompt,headline,cta,mock,file_path,preview_path,source_path) VALUES($1,$2,$3,1,'ready','Photo of candle','A quiet moment','Explore',true,$4,$4,$4)", [version, asset, workspace, file]);
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
  });
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api`;
  const call = (route: string, body?: object, token = "review-owner") => fetch(origin + route, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { cookie: `inkshot_session=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const studio = async () => await (await call("/studio")).json() as Studio;
  const currentVersion = async (id: string = version) => (await studio()).assets.find(a => a.id === asset)!.versions.find(v => v.id === id)!;
  const checks = { product: true, offer: true, claims: true, logo: true, safeArea: true, caption: true, destination: true };
  const review = (fingerprint: string, versionId: string = version, token = "review-owner", assetId: string = asset) =>
    call(`/assets/${assetId}/review`, { versionId, fingerprint, checks }, token);

  assert.equal((await studio()).exportReviewRequired, true);
  const initial = await currentVersion(); assert(initial.reviewFingerprint); assert.equal(initial.reviewed, false);
  assert.equal((await call(`/media/${version}?download=true`)).status, 409);
  assert.equal((await call(`/media/${version}`)).status, 200, "review previews remain viewable");
  assert.equal((await call(`/media/${version}?download=true`, undefined, "review-other")).status, 404);
  assert.equal((await call(`/campaigns/${campaign}/exports`, { category: "all" })).status, 409);
  assert.equal((await review(initial.reviewFingerprint, version, "review-other")).status, 404);
  assert.equal((await review(initial.reviewFingerprint, version, "review-owner", randomUUID())).status, 404);
  assert.equal((await call(`/assets/${asset}/review`, { versionId: version, fingerprint: initial.reviewFingerprint, checks: { ...checks, product: false } })).status, 400);
  assert.equal((await review("0".repeat(64))).status, 409);
  assert.equal((await review(initial.reviewFingerprint)).status, 200);
  assert.equal((await currentVersion()).reviewed, true);
  assert.equal((await call(`/media/${version}?download=true`)).status, 200);
  const exportResponse = await call(`/campaigns/${campaign}/exports`, { category: "all" });
  assert.equal(exportResponse.status, 202);
  const archive = await exportResponse.json() as { id: string };
  assert(await runExportOnce(db));
  assert.equal((await call(`/exports/${archive.id}/download`)).status, 200);
  assert.equal((await call(`/exports/${archive.id}/download`, undefined, "review-other")).status, 404);

  const revise = { versionId: version, headline: initial.headline, cta: initial.cta, note: "Different background" };
  const regeneration = await call(`/assets/${asset}/revise`, { ...revise, regenerate: true });
  assert.equal(regeneration.status, 409);
  assert.equal((await studio()).balance, 50);
  assert.equal((await db.query("SELECT id FROM ledger")).rows.length, 0);
  assert.equal((await db.query("SELECT id FROM versions WHERE asset_id=$1", [asset])).rows.length, 1);

  const edit = await call(`/assets/${asset}/revise`, { ...revise, note: "Caption correction", caption: "Updated caption", regenerate: false });
  assert.equal(edit.status, 200);
  const revised = await edit.json() as { versionId: string };
  assert.equal((await studio()).balance, 50, "caption/text edits remain free");
  assert.equal((await studio()).assets.find(a => a.id === asset)!.caption, "Updated caption");
  assert.equal((await currentVersion()).reviewed, false, "caption changes invalidate previous review");
  assert.equal((await review(initial.reviewFingerprint)).status, 409);
  assert.equal((await call(`/media/${version}?download=true`)).status, 409);
  assert.equal((await call(`/exports/${archive.id}/download`)).status, 409);
  const updated = await currentVersion(); assert(updated.reviewFingerprint);
  assert.equal((await review(updated.reviewFingerprint)).status, 200);
  const staleArchive = await call(`/exports/${archive.id}/download`);
  assert.equal(staleArchive.status, 409, "re-reviewing does not revive an archive with stale captions");
  assert.match((await staleArchive.json()).error, /older copy/);
  assert.equal((await review((await currentVersion(revised.versionId)).reviewFingerprint!, revised.versionId)).status, 404, "queued versions cannot be approved");

  // Simulate completed rendering; this test exercises HTTP acceptance, not codecs.
  await db.query("UPDATE versions SET status='ready',file_path=$2,preview_path=$2 WHERE id=$1", [revised.versionId, file]);
  await db.query("UPDATE assets SET current_version_id=$2 WHERE id=$1", [asset, revised.versionId]);
  const rendered = await currentVersion(revised.versionId); assert(rendered.reviewFingerprint); assert.equal(rendered.reviewed, false);
  assert.equal((await review(rendered.reviewFingerprint, revised.versionId)).status, 200);
  const freshArchiveResponse = await call(`/campaigns/${campaign}/exports`, { category: "all" });
  assert.equal(freshArchiveResponse.status, 202);
  const freshArchive = await freshArchiveResponse.json() as { id: string };
  assert.notEqual(freshArchive.id, archive.id);
  assert(await runExportOnce(db));
  assert.equal((await call(`/exports/${freshArchive.id}/download`)).status, 200);
  await db.query("UPDATE campaigns SET brand=jsonb_set(brand,'{destinationUrl}',to_jsonb('https://example.test/new'::text)) WHERE id=$1", [campaign]);
  assert.equal((await currentVersion(revised.versionId)).reviewed, false, "destination changes also invalidate approval");
  assert.equal((await call(`/exports/${freshArchive.id}/download`)).status, 409);
});
