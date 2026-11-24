import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { planConfig } from "../server/plan.js";

test("plan configuration reads the environment, rejects inconsistent totals and keeps safe defaults", () => {
  const defaults = planConfig({});
  assert.deepEqual(defaults, { name: "Studio", currency: "usd", priceAmount: 3900, credits: 300, kitCredits: 100,
    versionCredits: { video: 26, image: 5, post: 2 }, videoRegenMonthlyCap: 8 });
  const sgd = planConfig({ PLAN_CURRENCY: "SGD", PLAN_PRICE_AMOUNT: "4900", VIDEO_REGEN_MONTHLY_CAP: "5" });
  assert.equal(sgd.currency, "sgd"); assert.equal(sgd.priceAmount, 4900); assert.equal(sgd.videoRegenMonthlyCap, 5);
  assert.throws(() => planConfig({ KIT_CREDITS: "90" }), /KIT_CREDITS/);
  assert.throws(() => planConfig({ PLAN_CURRENCY: "dollars" }), /PLAN_CURRENCY/);
  assert.throws(() => planConfig({ VIDEO_REGEN_MONTHLY_CAP: "-1" }), /VIDEO_REGEN_MONTHLY_CAP/);
});

test("video regeneration cap is enforced with the credit reservation, resets at renewal and holds under concurrency", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-plan-"));
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "BILLING_MODE", "GENERATION_MODE", "DATA_DIR", "VIDEO_REGEN_MONTHLY_CAP"];
  const before = keys.map(key => process.env[key]);
  delete process.env.AUTH_PROVIDER; delete process.env.STORAGE_PROVIDER;
  Object.assign(process.env, { BILLING_MODE: "off", GENERATION_MODE: "mock", DATA_DIR: dir, VIDEO_REGEN_MONTHLY_CAP: "2" });
  const { createApp } = await import("../server/app.js");
  const { createDatabase } = await import("../server/db.js");
  const { tokenHash } = await import("../server/auth.js");
  const { emptyBrand } = await import("../server/brand.js");
  const db = await createDatabase(dir, true);
  const workspace = randomUUID(), user = randomUUID(), campaign = randomUUID();
  await db.query("INSERT INTO workspaces(id,brand,credits) VALUES($1,$2,500)", [workspace, JSON.stringify(emptyBrand)]);
  await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash) VALUES($1,$2,'Merchant','plan@example.test','unused')", [user, workspace]);
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [tokenHash("plan-owner"), user]);
  await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES($1,$2,'Launch','sales','[]',$3,true)", [campaign, workspace, JSON.stringify(emptyBrand)]);
  const makeAsset = async (kind: string) => {
    const asset = randomUUID(), version = randomUUID();
    await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,caption,current_version_id) VALUES($1,$2,$3,$4,'Asset','9:16','c',$5)", [asset, workspace, campaign, kind, version]);
    await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,status,prompt,headline,cta,mock) VALUES($1,$2,$3,1,'ready','p','Fresh bread','Order',true)", [version, asset, workspace]);
    return { asset, version };
  };
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
  });
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/api`;
  const call = (route: string, body?: object, token = "plan-owner") => fetch(origin + route, {
    method: body ? "POST" : "GET", headers: { cookie: `inkshot_session=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const regenerate = (a: { asset: string; version: string }) => call(`/assets/${a.asset}/revise`, { versionId: a.version, headline: "Fresh bread", cta: "Order", note: "", regenerate: true });
  const finish = () => db.query("UPDATE versions SET status='ready' WHERE workspace_id=$1 AND status<>'failed'", [workspace]);
  const balance = async () => Number((await db.query<{ credits: number }>("SELECT credits FROM workspaces WHERE id=$1", [workspace])).rows[0].credits);

  // The public plan endpoint needs no session and mirrors the server configuration.
  const publicPlan = await (await fetch(`${origin}/plan`)).json() as { videoRegenMonthlyCap: number; credits: number };
  assert.equal(publicPlan.credits, 300);
  assert.equal((await (await call("/studio")).json() as { plan: { videoRegenMonthlyCap: number } }).plan.videoRegenMonthlyCap, 2);

  const video = await makeAsset("video");
  assert.equal((await regenerate(video)).status, 200);
  assert.equal(await balance(), 474);
  await finish();
  assert.equal((await regenerate(video)).status, 200);
  assert.equal(await balance(), 448);
  await finish();
  let usage = (await (await call("/studio")).json() as { videoRegen: { used: number; cap: number; resetsAt: string } }).videoRegen;
  assert.equal(usage.used, 2); assert.equal(usage.cap, 2);

  const blocked = await regenerate(video);
  assert.equal(blocked.status, 429);
  const message = (await blocked.json() as { error: string }).error;
  assert.match(message, /You've used all 2 video regenerations this month\. They reset on \d{1,2} \w+ \d{4}\./);
  assert.equal(await balance(), 448, "a refused regeneration reserves no credits");
  assert.equal((await db.query("SELECT id FROM versions WHERE asset_id=$1", [video.asset])).rows.length, 3);

  // Images and free text edits are unaffected by the video cap.
  const image = await makeAsset("image");
  assert.equal((await regenerate(image)).status, 200);
  await finish();
  assert.equal((await call(`/assets/${video.asset}/revise`, { versionId: video.version, headline: "Fresh bread", cta: "Order", note: "", regenerate: false })).status, 400, "a text edit is refused only for missing source media, never by the cap");

  // A failed (refunded) regeneration does not use the allowance.
  await db.query("UPDATE versions SET status='failed' WHERE asset_id=$1 AND n=3", [video.asset]);
  assert.equal((await regenerate(video)).status, 200);
  await finish();
  assert.equal((await regenerate(video)).status, 429);

  // A renewal resets the allowance.
  await db.query("INSERT INTO billing_accounts(workspace_id,status,last_allowance_invoice_created) VALUES($1,'active',$2)", [workspace, Math.floor(Date.now() / 1000) - 1]);
  await db.query("UPDATE versions SET created_at=now()-interval '1 hour' WHERE workspace_id=$1", [workspace]);
  usage = (await (await call("/studio")).json() as { videoRegen: { used: number; cap: number; resetsAt: string } }).videoRegen;
  assert.equal(usage.used, 0);
  assert(new Date(usage.resetsAt) > new Date());
  assert.equal((await regenerate(video)).status, 200);
  await finish();

  // Concurrent requests at the limit: exactly one more succeeds.
  const [a, b] = [await makeAsset("video"), await makeAsset("video")];
  const results = await Promise.all([regenerate(a), regenerate(b)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
  const regens = await db.query("SELECT v.id FROM versions v JOIN assets s ON s.id=v.asset_id WHERE s.kind='video' AND v.n>1 AND v.credit_cost>0 AND v.status<>'failed' AND v.created_at>now()-interval '30 minutes'");
  assert.equal(regens.rows.length, 2);
});

test("checkout accepts only a Stripe price matching the configured currency and amount", async t => {
  const keys = ["BILLING_MODE", "STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_STUDIO_PRICE_ID", "PLAN_CURRENCY", "PLAN_PRICE_AMOUNT"];
  const before = keys.map(key => process.env[key]);
  Object.assign(process.env, { BILLING_MODE: "sandbox", STRIPE_API_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_STUDIO_PRICE_ID: "price_sgd", PLAN_CURRENCY: "SGD", PLAN_PRICE_AMOUNT: "4900" });
  const { checkout } = await import("../server/billing.js");
  const { createDatabase } = await import("../server/db.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-plan-sgd-"));
  const db = await createDatabase(dir, true);
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]); });
  await db.query("INSERT INTO workspaces(id) VALUES ('sgd')");
  const user = { id: "u", workspaceId: "sgd", name: "M", email: "m@example.test", demo: false };
  let retrieved = "";
  const stripe = (currency: string, amount: number) => ({
    prices: { retrieve: async (id: string) => { retrieved = id; return { id, livemode: false, active: true, currency, unit_amount: amount, recurring: { interval: "month", interval_count: 1 } }; } },
    customers: { create: async () => ({ id: "cus_sgd" }) },
    subscriptions: { list: async () => ({ has_more: false, data: [] }) },
    checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://checkout.example.test" }) } },
  }) as never;
  await assert.rejects(checkout(db, user, () => stripe("usd", 3900)), /Configure/i);
  await assert.rejects(checkout(db, user, () => stripe("sgd", 3900)), /Configure/i);
  assert.deepEqual(await checkout(db, user, () => stripe("sgd", 4900)), { url: "https://checkout.example.test" });
  assert.equal(retrieved, "price_sgd");
});

test("GENERATION_PAUSED refuses new generation without touching credits", async () => {
  const { assertGenerationNotPaused } = await import("../server/plan.js");
  assert.doesNotThrow(() => assertGenerationNotPaused({}));
  assert.doesNotThrow(() => assertGenerationNotPaused({ GENERATION_PAUSED: "false" }));
  assert.throws(() => assertGenerationNotPaused({ GENERATION_PAUSED: "true" }), /paused/);
});
