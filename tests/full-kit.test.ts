import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ffmpeg from "ffmpeg-static";

test("sandbox allowance funds a private nine-asset kit and refunds a failed asset once", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-kit-"));
  process.env.DATA_DIR = dir;
  process.env.GENERATION_MODE = "mock";
  process.env.BILLING_MODE = "sandbox";
  assert(ffmpeg);
  process.env.FFMPEG_PATH = ffmpeg;
  const { createApp } = await import("../server/app");
  const { createDatabase } = await import("../server/db");
  const { runWorkerOnce } = await import("../server/worker");
  const { applyPaymentFact } = await import("../server/billing");
  const { emptyBrand } = await import("../server/brand");
  const db = await createDatabase(dir, true);
  const server = createApp(db).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const api = `http://127.0.0.1:${address.port}/api`;
  const signup = await fetch(api + "/auth/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test merchant", email: "merchant@example.test", password: "long-example-password" }),
  });
  assert(signup.ok);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0];
  const submit = (route: string, body: unknown, method = "POST") => fetch(api + route, {
    method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const studio = async () => (await fetch(api + "/studio", { headers: { cookie } })).json();
  const { user, balance } = await studio();
  // Local signup grants preview credits. Consume these before testing a paid allowance.
  const { changeCredits } = await import("../server/credits");
  await db.transaction(tx => changeCredits(tx, user.workspaceId, -balance, "generation", "Prior kits", "fixture:prior-kits"));
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES($1,'cus_kit')", [user.workspaceId]);
  const invoice = {
    eventId: "evt_paid", eventType: "invoice.paid", created: 100, customerId: "cus_kit",
    subscriptionId: "sub_kit", status: "active", invoiceId: "in_kit", grantCredits: true,
  };
  await applyPaymentFact(db, invoice);
  await applyPaymentFact(db, { ...invoice, eventId: "evt_duplicate" });
  assert.equal((await studio()).balance, 300);
  const website = "https://example.test/bakery";
  const description = "A neighbourhood bakery selling sourdough loaves for weekend collection.";
  assert((await submit("/brand", { ...emptyBrand, name: "Weekend Bakery", website, description,
    sources: [{ url: website, text: description }] }, "PUT")).ok);
  const destinationUrl = "https://example.test/bakery/friday?utm_source=social";
  const createKit = async () => {
    const draft = await submit("/campaigns", { name: "Friday pickup", goal: "Sales", offer: "Reserve a loaf" });
    assert.equal(draft.status, 201);
    const { id, concepts } = await draft.json();
    const prompts = await submit(`/campaigns/${id}/prompts`, {
      revision: 0, selectedConceptIds: concepts.slice(0, 3).map((concept: { id: string }) => concept.id),
    });
    assert(prompts.ok);
    const planned = await prompts.json();
    planned.assets = planned.assets.map((asset: { kind: string; caption?: string }) => ({
      ...asset,
      ...(asset.kind === "post" ? { caption: `${asset.caption}\n${destinationUrl}` } : {}),
    }));
    const save = (url: string) => submit(`/campaigns/${id}/draft`, { ...planned, destinationUrl: url }, "PATCH");
    assert.equal((await save("javascript:void(0)")).status, 400);
    const saved = await save(destinationUrl);
    assert(saved.ok);
    const { revision } = await saved.json();
    const generate = () => submit(`/campaigns/${id}/generate`, { approved: true, draftRevision: revision });
    assert((await generate()).ok);
    assert((await generate()).ok);
    assert.equal((await studio()).campaigns.find((campaign: { id: string }) => campaign.id === id).brand.destinationUrl, destinationUrl);
    return id as string;
  };
  const first = await createKit();
  assert.equal((await studio()).balance, 200);
  for (let i = 0; i < 9; i++) assert(await runWorkerOnce(db));
  assert.equal(await runWorkerOnce(db), false);
  const post = (await studio()).assets.find((a: { kind: string }) => a.kind === "post");
  const original = { versionId: post.current_version_id, caption: post.caption };
  const revised = await submit(`/assets/${post.id}/revise`, {
    versionId: original.versionId, headline: "Friday pickup is open", cta: "Reserve your loaf!", note: "Approved post wording",
  });
  assert(revised.ok);
  assert(await runWorkerOnce(db));
  const latestPost = (await studio()).assets.find((a: { id: string }) => a.id === post.id);
  const latestCaption = latestPost.caption;
  assert.equal(latestCaption, original.caption, "editing the image overlay preserves the approved social caption");
  const latestVersion = latestPost.versions.find((version: { id: string }) => version.id === latestPost.current_version_id);
  assert.notEqual(latestVersion.id, original.versionId);
  assert.equal(latestVersion.headline, "Friday pickup is open");
  assert.equal(latestVersion.cta, "Reserve your loaf!");
  const originalVersion = latestPost.versions.find((version: { id: string }) => version.id === original.versionId);
  assert.equal(originalVersion.headline, post.versions.find((version: { id: string }) => version.id === original.versionId).headline);
  const url = `${api}/campaigns/${first}/download`;
  assert.equal((await fetch(url)).status, 401);
  const other = await fetch(api + "/auth/demo", { method: "POST" });
  const foreign = other.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(url, { headers: { cookie: foreign } })).status, 404);
  const queued = await submit(`/campaigns/${first}/exports`, { category: 'all' });
  assert.equal(queued.status, 202);
  const exportJob = await queued.json();
  assert(await runWorkerOnce(db));
  const exportUrl = `${api}/exports/${exportJob.id}/download`;
  assert.equal((await fetch(exportUrl, { headers: { cookie: foreign } })).status, 404);
  const response = await fetch(exportUrl, { headers: { cookie } });
  assert.equal(response.status, 200);
  const archive = path.join(dir, "kit.zip");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("unzip", ["-tq", archive]);
  const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
  for (const kind of ["image", "post"]) assert.equal(names.filter(n => n.endsWith(`-${kind}.jpg`)).length, 3);
  const videos = names.filter(n => n.endsWith("-video.mp4"));
  assert.equal(videos.length, 3);
  for (const video of videos) {
    const bytes = execFileSync("unzip", ["-p", archive, video], { maxBuffer: 12 * 1024 * 1024 });
    assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    execFileSync(ffmpeg, ["-v", "error", "-xerror", "-i", "pipe:0", "-f", "null", "-"], { input: bytes });
  }
  const captions = execFileSync("unzip", ["-p", archive, "captions.txt"], { encoding: "utf8" });
  const posts = (await studio()).assets.filter((a: { kind: string }) => a.kind === "post");
  assert.equal(posts.length, 3);
  for (const post of posts) {
    assert(captions.includes(post.caption));
    assert(post.caption.endsWith(destinationUrl));
  }
  assert.equal(execFileSync("unzip", ["-p", archive, "destination-url.txt"], { encoding: "utf8" }).trim(), destinationUrl);
  assert(names.includes("SAMPLE-README.txt"));
  assert(captions.includes(latestCaption));
  assert((await submit(`/assets/${post.id}/current`, { versionId: original.versionId }, "PUT")).ok);
  assert.equal((await studio()).assets.find((a: { id: string }) => a.id === post.id).caption, original.caption);

  const second = await createKit();
  const failed = (await db.query<{ id: string; credit_cost: number }>(
    "SELECT v.id,v.credit_cost FROM versions v JOIN assets a ON a.id=v.asset_id WHERE a.campaign_id=$1 AND a.kind='image' LIMIT 1",
    [second],
  )).rows[0];
  // Exercise the worker's exhausted-retry path without waiting for five backoffs.
  await db.query("UPDATE versions SET source_path=$2 WHERE id=$1", [failed.id, path.join(dir, "missing.jpg")]);
  await db.query("UPDATE jobs SET available_at=now()+interval '1 hour' WHERE state='queued' AND version_id<>$1", [failed.id]);
  assert(await runWorkerOnce(db));
  const retry = (await db.query<{ state: string; attempts: number }>(
    "SELECT state,attempts FROM jobs WHERE version_id=$1", [failed.id],
  )).rows[0];
  assert.equal(retry.state, "queued");
  assert.equal(retry.attempts, 1);
  assert.equal((await studio()).balance, 100);
  await db.query("UPDATE jobs SET attempts=5,available_at=now() WHERE version_id=$1", [failed.id]);
  assert(await runWorkerOnce(db));
  assert.equal(await runWorkerOnce(db), false);
  assert.equal((await studio()).balance, 100 + failed.credit_cost);
  const refunds = await db.query<{ amount: number }>("SELECT amount FROM ledger WHERE event_key=$1", [`refund:${failed.id}`]);
  assert.deepEqual(refunds.rows.map(row => row.amount), [failed.credit_cost]);
});
