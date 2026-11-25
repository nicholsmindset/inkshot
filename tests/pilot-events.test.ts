import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { briefFingerprints, editedBriefFields, websiteFailureReason } from "../server/events.js";

test("brief fingerprints reveal edits without keeping text; failure reasons are text-free codes", () => {
  const brand = { name: "Bakery", description: "We bake bread.", audience: "Locals", proof: [], voice: "" };
  const fields = briefFingerprints(brand);
  assert.deepEqual(Object.keys(fields).sort(), ["audience", "description", "name"], "empty fields do not count");
  assert(!JSON.stringify(fields).includes("bread"));
  assert.deepEqual(editedBriefFields(fields, brand), []);
  assert.deepEqual(editedBriefFields(fields, { ...brand, audience: "Everyone" }), ["audience"]);
  assert.equal(websiteFailureReason(new Error("There is very little readable text on this page.")), "too_little_text");
  assert.equal(websiteFailureReason(new Error("We could not read that page. Try your homepage")), "unreadable");
  assert.equal(websiteFailureReason(new Error("Only public websites can be read.")), "invalid_url");
});

test("pilot events record once per action, stay inside the workspace and feed the pilot report", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-events-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR", "PILOT_INVITE_ONLY", "ENABLE_EXPORT_REVIEW"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER; delete process.env.PILOT_INVITE_ONLY; delete process.env.ENABLE_EXPORT_REVIEW;
  Object.assign(process.env, { BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const { recordEvent } = await import("../server/events.js");
  const { buildPilotReport } = await import("../server/pilot-report.js");
  const db = await createDatabase(dir, true);
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
  });
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api`;
  async function signup(email: string) {
    const response = await fetch(`${origin}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Merchant", email, password: "a-long-test-password" }) });
    assert.equal(response.status, 201);
    return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  const call = (cookie: string, route: string, body?: object, method?: string) => fetch(origin + route, {
    method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const [a, b] = [await signup("a@example.test"), await signup("b@example.test")];
  const workspaces = (await db.query<{ workspace_id: string }>("SELECT workspace_id FROM users ORDER BY email")).rows.map(r => r.workspace_id);
  const count = async (workspace: string, event: string) =>
    Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM product_events WHERE workspace_id=$1 AND event=$2", [workspace, event])).rows[0].n);

  assert.equal(await count(workspaces[0], "signup_completed"), 1);
  assert.equal(await count(workspaces[1], "signup_completed"), 1);

  // Brief save compares against the last website read by fingerprint.
  const brand = { name: "Bakery", website: "https://bakery.example.test", description: "We bake bread.", audience: "Locals", voice: "Warm", offer: "Fresh loaves", color: "#29483d", proof: [], sources: [] };
  const { briefFingerprints } = await import("../server/events.js");
  await recordEvent(db, { workspaceId: workspaces[0], event: "website_read_succeeded", props: { fields: briefFingerprints(brand) } });
  assert.equal((await call(a, "/brand", { ...brand, audience: "Families" }, "PUT")).status, 200);
  assert.equal((await call(a, "/brand", { ...brand, audience: "Families" }, "PUT")).status, 200);
  assert.equal(await count(workspaces[0], "brief_saved"), 2);
  const edit = (await db.query<{ props: { edited: number; total: number; fields: string[] } }>("SELECT props FROM product_events WHERE event='brief_fields_edited' ORDER BY created_at DESC LIMIT 1")).rows[0].props;
  assert.deepEqual(edit, { edited: 1, total: 5, fields: ["audience"] });
  assert.equal(await count(workspaces[1], "brief_saved"), 0, "another workspace is untouched");

  // A downloaded asset, then the "Would you publish this?" answer (changeable, never for another workspace's asset).
  const campaign = randomUUID(), asset = randomUUID(), version = randomUUID(), file = path.join(dir, "ad.jpg");
  await writeFile(file, "creative");
  await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES($1,$2,'Launch','sales','[]',$3,true)", [campaign, workspaces[0], JSON.stringify(brand)]);
  await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,caption,current_version_id) VALUES($1,$2,$3,'image','Loaf','1:1','c',$4)", [asset, workspaces[0], campaign, version]);
  await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,status,prompt,headline,cta,mock,file_path,preview_path) VALUES($1,$2,$3,1,'ready','SECRET PROMPT','Fresh','Order',true,$4,$4)", [version, asset, workspaces[0], file]);
  assert.equal((await call(a, `/media/${version}?download=true`)).status, 200);
  assert.equal((await call(a, `/media/${version}?download=true`)).status, 200);
  assert.equal(await count(workspaces[0], "download_completed"), 1, "repeat downloads of a version record once");
  assert.equal((await call(a, `/assets/${asset}/publish-answer`, { versionId: version, answer: "no" })).status, 200);
  assert.equal((await call(a, `/assets/${asset}/publish-answer`, { versionId: version, answer: "no", reason: "looks_ai_made" })).status, 200);
  assert.equal((await call(b, `/assets/${asset}/publish-answer`, { versionId: version, answer: "yes_as_is" })).status, 404);
  assert.equal((await call(a, `/assets/${asset}/publish-answer`, { versionId: version, answer: "no", reason: "bad" })).status, 400);
  let answers = (await db.query<{ props: { answer: string; reason: string } }>("SELECT props FROM product_events WHERE event='publish_answer'")).rows;
  assert.equal(answers.length, 1);
  assert.deepEqual([answers[0].props.answer, answers[0].props.reason], ["no", "looks_ai_made"]);
  assert.equal((await call(a, `/assets/${asset}/publish-answer`, { versionId: version, answer: "yes_with_edits" })).status, 200);
  answers = (await db.query("SELECT props FROM product_events WHERE event='publish_answer'")).rows as never;
  assert.equal(answers.length, 1, "an answer is replaced, not duplicated");
  assert.equal(answers[0].props.answer, "yes_with_edits");

  // The follow-up appears only seven days after the first download, once, and is workspace-scoped.
  assert.deepEqual(await (await call(a, "/pilot/followup")).json(), { pending: null });
  await db.query("UPDATE product_events SET created_at=now()-interval '8 days' WHERE event='download_completed'");
  const pending = (await (await call(a, "/pilot/followup")).json() as { pending: { campaignId: string; assets: { id: string }[] } }).pending;
  assert.equal(pending.campaignId, campaign); assert.equal(pending.assets[0].id, asset);
  assert.deepEqual(await (await call(b, "/pilot/followup")).json(), { pending: null });
  assert.equal((await call(b, "/pilot/followup", { campaignId: campaign, posted: true })).status, 404);
  assert.equal((await call(a, "/pilot/followup", { campaignId: campaign, posted: true, assetId: asset, platform: "instagram", spend: 20, results: "Six messages", clicks: 40 })).status, 200);
  assert.equal((await call(a, "/pilot/followup", { campaignId: campaign, dismissed: true })).status, 200);
  const followups = (await db.query<{ props: Record<string, unknown> }>("SELECT props FROM product_events WHERE event='posted_followup'")).rows;
  assert.equal(followups.length, 1);
  assert.equal(followups[0].props.selfReported, true); assert.equal(followups[0].props.clicks, 40);
  assert.deepEqual(await (await call(a, "/pilot/followup")).json(), { pending: null });

  // No prompts or text in any event.
  assert.equal((await db.query("SELECT 1 FROM product_events WHERE props::text ILIKE '%SECRET PROMPT%' OR props::text ILIKE '%We bake bread%'")).rows.length, 0);

  // Report on seeded data.
  const w = workspaces[0];
  await db.query("INSERT INTO provider_spend(request_key,input_hash,usd) VALUES($1,'h',1.25)", [`${version}:image`]);
  await recordEvent(db, { workspaceId: w, event: "website_read_started" });
  await recordEvent(db, { workspaceId: w, event: "website_read_failed", props: { reason: "blocked" } });
  await recordEvent(db, { workspaceId: w, event: "campaign_approved", campaignId: campaign, dedupeKey: `campaign_approved:${campaign}` });
  await recordEvent(db, { workspaceId: w, event: "checkout_completed", dedupeKey: "checkout_completed" });
  await db.query("UPDATE product_events SET created_at=now()-interval '10 minutes' WHERE event='website_read_started'");
  await db.query("UPDATE product_events SET created_at=now()-interval '5 days' WHERE event='signup_completed'");
  const report = await buildPilotReport(db);
  const merchant = report.merchants.find(m => m.workspaceId === w)!;
  assert.equal(merchant.kitsApproved, 1);
  assert.equal(merchant.publishableAssetsPerKit, 1);
  assert.equal(merchant.estimatedProviderCostPerKitUsd, 1.25);
  assert.equal(merchant.briefAcceptedPct, 80);
  assert.equal(merchant.paid, true);
  assert(merchant.minutesToApprovedCampaign! >= 9 && merchant.minutesToApprovedCampaign! <= 11);
  assert.deepEqual(merchant.failureReasons, { "website:blocked": 1 });
  assert.equal(report.overall.merchants, 2);
  assert.equal(report.overall.conversionToPaidPct, 50);
  assert.equal(report.overall.returningWithin30Days, 1, "activity on a later day within 30 days of signup");
  assert(report.definitions.some(d => /self-reported/.test(d)));
});
