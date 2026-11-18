import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CampaignDraft, Concept } from "../shared/types.js";

test("approved campaign planning persists exact inputs and rejects stale or foreign edits", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkshot-planning-"));
  process.env.DATA_DIR = directory;
  process.env.GENERATION_MODE = "mock";
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const database = await createDatabase(directory, true);
  const server = createApp(database).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const session = async () => {
    const response = await fetch(base + "/auth/demo", { method: "POST" });
    assert(response.ok);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const owner = await session();
  const stranger = await session();
  const call = (route: string, body?: unknown, method = body ? "POST" : "GET", cookie = owner) =>
    fetch(base + route, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const created = await call("/campaigns", { name: "Autumn collection", goal: "Sales", offer: "Explore the collection" });
  assert.equal(created.status, 201);
  const campaign = await created.json() as { id: string; concepts: Concept[] };
  assert.equal(campaign.concepts.length, 6);
  const route = `/campaigns/${campaign.id}`;
  assert.equal((await call(route + "/generate", { approved: true })).status, 409);
  const initialResponse = await call(route + "/draft");
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json() as CampaignDraft;
  const selection = campaign.concepts.slice(3).map(concept => concept.id);
  assert.equal((await call(route + "/draft", undefined, "GET", stranger)).status, 404);
  assert.equal((await call(route + "/prompts", { revision: initial.revision, selectedConceptIds: selection }, "POST", stranger)).status, 404);
  const written = await call(route + "/prompts", { revision: initial.revision, selectedConceptIds: selection });
  assert.equal(written.status, 200);
  const generated = await written.json() as CampaignDraft;
  assert.equal(generated.assets.length, 9);
  assert.deepEqual(generated.selectedConceptIds, selection);
  assert(generated.assets.every(asset => selection.includes(asset.conceptId)));
  for (const kind of ["video", "image", "post"]) {
    assert.equal(generated.assets.filter(asset => asset.kind === kind).length, 3);
  }
  const assets = generated.assets.map((asset, index) => ({
    ...asset,
    prompt: `Approved scene ${index}: a candle on a dark table in soft daylight.`,
    ...(asset.kind === "video" ? { motionPrompt: `0–5s hold scene ${index}; 5–10s slowly pan; 10–15s hold the final frame.` } : {}),
    ...(asset.kind === "post" ? { caption: `Customer-approved organic caption ${index}.` } : {}),
  }));
  const edited = { ...generated, assets, destinationUrl: "https://example.com/collection" };
  assert.equal((await call(route + "/draft", edited, "PATCH", stranger)).status, 404);
  const savedResponse = await call(route + "/draft", edited, "PATCH");
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json() as CampaignDraft;
  assert.equal(saved.revision, generated.revision + 1);
  assert.equal((await call(route + "/draft", edited, "PATCH")).status, 409);
  assert.deepEqual(await (await call(route + "/draft")).json(), saved);
  const missingMotion = { ...saved, assets: saved.assets.map(asset => asset.kind === "video" ? { ...asset, motionPrompt: "" } : asset) };
  const incompleteResponse = await call(route + "/draft", missingMotion, "PATCH");
  assert.equal(incompleteResponse.status, 200);
  const incomplete = await incompleteResponse.json() as CampaignDraft;
  assert.equal((await call(route + "/generate", { approved: true, draftRevision: incomplete.revision })).status, 400);
  const restoredResponse = await call(route + "/draft", { ...saved, revision: incomplete.revision }, "PATCH");
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json() as CampaignDraft;
  assert.equal((await call(route + "/generate", { approved: true, draftRevision: generated.revision })).status, 409);
  assert.equal((await call(route + "/generate", { approved: true, draftRevision: saved.revision }, "POST", stranger)).status, 404);
  const approval = { approved: true, draftRevision: restored.revision };
  assert.equal((await call(route + "/generate", approval)).status, 200);
  assert.equal((await call(route + "/draft", restored, "PATCH")).status, 409);
  assert.equal((await call(route + "/generate", approval)).status, 200);
  const stored = (await database.query<{ prompt: string; motion_prompt: string | null; kind: string; caption: string }>(
    "SELECT v.prompt,v.motion_prompt,a.kind,a.caption FROM versions v JOIN assets a ON a.id=v.asset_id WHERE a.campaign_id=$1",
    [campaign.id],
  )).rows;
  assert.equal(stored.length, 9);
  for (const asset of assets) {
    const record = stored.find(item => item.prompt === asset.prompt);
    assert(record, `Missing approved input ${asset.prompt}`);
    if (asset.kind === "video") assert.equal(record.motion_prompt, asset.motionPrompt);
    if (asset.kind === "post") assert.equal(record.caption, asset.caption);
  }
  const studio = await (await call("/studio")).json();
  assert.equal(studio.balance, 200);
  assert.equal((await database.query("SELECT id FROM jobs")).rows.length, 9);

  // Existing persisted campaigns predate six-angle planning and have no saved draft.
  const legacyResponse = await call("/campaigns", { name: "Older draft", goal: "Sales", offer: "Browse the collection" });
  assert.equal(legacyResponse.status, 201);
  const legacy = await legacyResponse.json() as { id: string; concepts: Concept[] };
  await database.query("UPDATE campaigns SET concepts=$2,draft=NULL WHERE id=$1", [legacy.id, JSON.stringify(legacy.concepts.slice(0, 3))]);
  assert.equal((await call(`/campaigns/${legacy.id}/generate`, { approved: true })).status, 200);
  assert.equal((await database.query("SELECT id FROM assets WHERE campaign_id=$1", [legacy.id])).rows.length, 9);
});
