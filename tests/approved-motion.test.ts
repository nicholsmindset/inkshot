import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { config } from "../server/config";
import { createDatabase } from "../server/db";
import { MODELS } from "../server/higgsfield";
import { runWorkerOnce } from "../server/worker";

test("worker submits approved first-frame and motion instructions and preserves legacy video behavior", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkshot-approved-motion-"));
  const db = await createDatabase(directory, true);
  const originalFetch = globalThis.fetch;
  const originalConfig = { liveAllowed: config.liveAllowed, hfKey: config.hfKey, hfSecret: config.hfSecret };
  const originalBudget = process.env.HF_DAILY_BUDGET_USD;
  const submissions: { model: string; body: Record<string, unknown>; key: string | null }[] = [];
  config.liveAllowed = true;
  config.hfKey = "test-key";
  config.hfSecret = "test-secret";
  process.env.HF_DAILY_BUDGET_USD = "10";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.higgsfield.ai");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.pathname.startsWith("/estimate/")) return Response.json({ usd: "0.1", credits: "1" });
    if (url.pathname.endsWith("/status")) {
      if (url.pathname.includes("image-")) {
        return Response.json({ status: "completed", images: [{ url: "https://example.test/approved-frame.jpg" }] });
      }
      return Response.json({ status: "in_progress" });
    }
    const model = url.pathname.slice(1);
    assert([MODELS.image, MODELS.video].includes(model));
    submissions.push({ model, body, key: new Headers(init?.headers).get("Idempotency-Key") });
    return Response.json({ request_id: `${model === MODELS.image ? "image" : "video"}-${submissions.length}`, status: "queued" });
  };
  try {
    await db.query("INSERT INTO workspaces(id,credits) VALUES('motion-workspace',100)");
    await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,status,concepts,brand,mock) VALUES('motion-campaign','motion-workspace','Campaign','Sales','generating','[]','{}',false)");
    const firstFrame = "A blue bicycle beside a cafe window at sunrise.";
    const motion = "0–3s hold on the bicycle. 3–10s track the rider leaving. 10–15s hold the cafe doorway.";
    for (const [index, approvedMotion] of [motion, null].entries()) {
      const version = `motion-version-${index}`;
      const asset = `motion-asset-${index}`;
      await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,current_version_id) VALUES($1,'motion-workspace','motion-campaign','video','Video','9:16',$2)", [asset, version]);
      await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,motion_prompt,headline,cta,credit_cost,mock) VALUES($1,$2,'motion-workspace',1,$3,$4,'Morning rides','Learn more',26,false)", [version, asset, firstFrame, approvedMotion]);
      await db.query("INSERT INTO jobs(id,version_id,workspace_id) VALUES($1,$2,'motion-workspace')", [`motion-job-${index}`, version]);
      assert(await runWorkerOnce(db));
      const imageRequest = submissions.find(request => request.key === `${version}:image`);
      const videoRequest = submissions.find(request => request.key === `${version}:video`);
      assert.equal(imageRequest?.body.prompt, firstFrame);
      assert.equal(videoRequest?.body.prompt, approvedMotion || `Slow deliberate camera movement. ${firstFrame}. No text or logos.`);
      assert.equal(videoRequest?.body.image_url, "https://example.test/approved-frame.jpg");
      assert.equal(videoRequest?.body.duration, 15);
      assert.equal((await db.query("SELECT state FROM jobs WHERE version_id=$1", [version])).rows[0].state, "queued");
    }
    assert.equal(submissions.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    if (originalBudget === undefined) delete process.env.HF_DAILY_BUDGET_USD;
    else process.env.HF_DAILY_BUDGET_USD = originalBudget;
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('approved merchant photo is the signed first frame, uses saved duration, and retries without changing its input', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkshot-photo-video-'));
  const db = await createDatabase(directory, true);
  const oldConfig = { ...config };
  const keys = ['HF_DAILY_BUDGET_USD', 'STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'INKSHOT_SHARED_PROJECT_LIVE', 'VIDEO_DURATION_SECONDS'];
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(config, { liveAllowed: true, hfKey: 'test-key', hfSecret: 'test-secret' });
  Object.assign(process.env, { HF_DAILY_BUDGET_USD: '10', STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://photo-fixture.supabase.co', SUPABASE_SECRET_KEY: 'secret-fixture', INKSHOT_SHARED_PROJECT_LIVE: 'false', VIDEO_DURATION_SECONDS: '8' });
  t.after(async () => {
    Object.assign(config, oldConfig);
    for (const key of keys) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; }
    await db.close(); await rm(directory, { recursive: true, force: true });
  });
  const submitted: Record<string, unknown>[] = [];
  const quoted: Record<string, unknown>[] = [];
  let signed = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.origin === 'https://photo-fixture.supabase.co') {
      assert.equal(url.pathname, '/storage/v1/object/sign/brand-uploads/merchant/photo.jpg');
      assert.equal(body.expiresIn, 600); signed++;
      return Response.json({ signedURL: '/object/sign/brand-uploads/merchant/photo.jpg?token=test-signed-photo' });
    }
    assert.equal(url.origin, 'https://api.higgsfield.ai');
    if (url.pathname.startsWith('/estimate/')) {
      assert.equal(url.pathname, '/estimate/' + MODELS.video); quoted.push(body);
      return Response.json({ usd: '0.1', credits: '1' });
    }
    if (url.pathname.endsWith('/status')) return Response.json({ status: 'in_progress' });
    assert.equal(url.pathname, '/' + MODELS.video, 'must not generate a replacement image');
    submitted.push(body);
    if (submitted.length === 1) throw new Error('simulated lost provider response');
    return Response.json({ request_id: 'merchant-video', status: 'queued' });
  });
  await db.query("INSERT INTO workspaces(id,credits) VALUES('merchant',74),('stranger',100)");
  await db.query("INSERT INTO uploads(id,workspace_id,file_path) VALUES('photo','merchant','supabase://brand-uploads/merchant/photo.jpg'),('foreign-photo','stranger','supabase://brand-uploads/stranger/photo.jpg')");
  async function queue(id: string, photoId: string) {
    await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,status,concepts,brand,mock) VALUES($1,'merchant','Campaign','Sales','generating','[]',$2,false)", [id, JSON.stringify({ name: 'Merchant', photoId })]);
    await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,current_version_id) VALUES($1,'merchant',$1,'video','Video','9:16',$1)", [id]);
    await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,motion_prompt,headline,cta,credit_cost,mock,video_duration_seconds) VALUES($1,$1,'merchant',1,'Original scene','Approved motion','Product','Shop',26,false,10)", [id]);
    await db.query("INSERT INTO jobs(id,version_id,workspace_id) VALUES($1,$1,'merchant')", [id]);
  }
  await queue('owned', 'photo');
  assert(await runWorkerOnce(db));
  await db.query("UPDATE jobs SET available_at=now() WHERE id='owned'");
  assert(await runWorkerOnce(db));
  assert.equal(signed, 1);
  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted[0], submitted[1]);
  assert.deepEqual(quoted[0], submitted[0]);
  assert.equal(submitted[0].duration, 10, 'worker must retain approved duration after config changes');
  assert.equal(submitted[0].prompt, 'Approved motion');
  assert.equal(submitted[0].image_url, 'https://photo-fixture.supabase.co/storage/v1/object/sign/brand-uploads/merchant/photo.jpg?token=test-signed-photo');
  assert.equal((await db.query('SELECT first_frame_source FROM versions WHERE id=$1', ['owned'])).rows[0].first_frame_source, 'merchant_photo');
  await db.query("UPDATE jobs SET state='done' WHERE id='owned'");
  await queue('foreign', 'foreign-photo');
  assert(await runWorkerOnce(db));
  assert.equal((await db.query('SELECT state FROM jobs WHERE id=$1', ['foreign'])).rows[0].state, 'failed');
  assert.equal(submitted.length, 2, 'foreign photo must never reach provider or trigger fallback');
  assert.equal(signed, 1);
});


test('HTTP video regeneration carries the requested revision into the provider motion prompt, including legacy versions', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkshot-revised-photo-'));
  const db = await createDatabase(directory, true);
  const oldConfig = { ...config };
  const keys = ['AUTH_PROVIDER', 'HF_DAILY_BUDGET_USD', 'STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'INKSHOT_SHARED_PROJECT_LIVE', 'VIDEO_DURATION_SECONDS'];
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(config, { production: false, mode: 'mock', liveAllowed: true, hfKey: 'test-key', hfSecret: 'test-secret' });
  delete process.env.AUTH_PROVIDER;
  Object.assign(process.env, { HF_DAILY_BUDGET_USD: '10', STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://photo-fixture.supabase.co', SUPABASE_SECRET_KEY: 'secret-fixture', INKSHOT_SHARED_PROJECT_LIVE: 'false', VIDEO_DURATION_SECONDS: '8' });
  const server = createApp(db).listen(0, '127.0.0.1');
  t.after(async () => {
    Object.assign(config, oldConfig);
    for (const key of keys) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close(); await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const localFetch = globalThis.fetch;
  const base = `http://127.0.0.1:${address.port}/api`;
  const session = await localFetch(base + '/auth/demo', { method: 'POST' });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const studio = await (await localFetch(base + '/studio', { headers: { cookie } })).json();
  const workspace = studio.user.workspaceId;
  const photo = randomUUID();
  await db.query('INSERT INTO uploads(id,workspace_id,file_path) VALUES($1,$2,$3)', [photo, workspace, `supabase://brand-uploads/${workspace}/product.jpg`]);
  const submitted: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.origin === 'https://photo-fixture.supabase.co') {
      assert.equal(url.pathname, `/storage/v1/object/sign/brand-uploads/${workspace}/product.jpg`);
      return Response.json({ signedURL: `/object/sign/brand-uploads/${workspace}/product.jpg?token=revised` });
    }
    assert.equal(url.origin, 'https://api.higgsfield.ai');
    if (url.pathname.startsWith('/estimate/')) {
      assert.equal(url.pathname, '/estimate/' + MODELS.video);
      return Response.json({ usd: '0.1', credits: '1' });
    }
    if (url.pathname.endsWith('/status')) return Response.json({ status: 'in_progress' });
    assert.equal(url.pathname, '/' + MODELS.video, 'approved product photo skips image generation');
    submitted.push(body);
    return Response.json({ request_id: `revised-video-${submitted.length}`, status: 'queued' });
  });
  for (const motion of ['Keep the camera steady for ten seconds.', null]) {
    const campaign = randomUUID(), asset = randomUUID(), source = randomUUID();
    await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,status,concepts,brand,mock) VALUES($1,$2,'Campaign','Sales','ready','[]',$3,false)", [campaign, workspace, JSON.stringify({ name: 'Merchant', photoId: photo })]);
    await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,current_version_id) VALUES($1,$2,$3,'video','Video','9:16',$4)", [asset, workspace, campaign, source]);
    await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,motion_prompt,headline,cta,credit_cost,mock,status,video_duration_seconds,first_frame_source) VALUES($1,$2,$3,1,'Original scene',$4,'Product','Shop',26,false,'ready',10,'merchant_photo')", [source, asset, workspace, motion]);
    const response = await localFetch(`${base}/assets/${asset}/revise`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: source, headline: 'Product', cta: 'Shop', note: 'Pan slowly toward the product.', regenerate: true }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const { versionId } = await response.json();
    assert(await runWorkerOnce(db));
    const request = submitted.at(-1)!;
    assert.equal(request.prompt, motion
      ? `${motion} Revision: Pan slowly toward the product.`
      : 'Slow deliberate camera movement. Original scene Revision: Pan slowly toward the product.. No text or logos.');
    assert.equal(String(request.prompt).split('Pan slowly toward the product.').length - 1, 1);
    assert.equal(request.duration, 10, 'regeneration retains the approved duration despite a changed default');
    assert.equal(request.image_url, `https://photo-fixture.supabase.co/storage/v1/object/sign/brand-uploads/${workspace}/product.jpg?token=revised`);
    const saved = (await db.query('SELECT motion_prompt,video_duration_seconds,first_frame_source FROM versions WHERE id=$1', [versionId])).rows[0];
    assert.equal(saved.motion_prompt, motion ? `${motion} Revision: Pan slowly toward the product.` : null);
    assert.equal(saved.video_duration_seconds, 10);
    assert.equal(saved.first_frame_source, 'merchant_photo');
    await db.query("UPDATE jobs SET state='done' WHERE version_id=$1", [versionId]);
  }
  assert.equal(submitted.length, 2);
});
