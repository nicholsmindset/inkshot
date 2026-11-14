import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Stripe from "stripe";
import { config } from "../server/config";
import { persistMedia, materializeMedia } from "../server/storage";
import { webhook } from "../server/billing";

test("shared live media and legacy media use distinct private buckets and workspace paths", async t => {
  const dir = await mkdtemp(join(tmpdir(), "inkshot-shared-media-"));
  const keys = ["BILLING_MODE", "INKSHOT_SHARED_PROJECT_LIVE", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "STORAGE_PROVIDER"];
  const saved = keys.map(key => process.env[key]);
  const originalDir = config.dataDir, originalMode = config.mode;
  t.after(async () => {
    keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]);
    Object.assign(config, { mode: originalMode, dataDir: originalDir });
    await rm(dir, { recursive: true, force: true });
  });
  Object.assign(process.env, { STORAGE_PROVIDER: "supabase", SUPABASE_URL: "http://localhost:54321", SUPABASE_SECRET_KEY: "test-only" });
  config.dataDir = dir;
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return init?.method === "POST"
      ? Response.json({ Key: "accepted" })
      : new Response("test media", { headers: { "Content-Type": "image/png" } });
  });
  const file = join(dir, "creative.png");
  await writeFile(file, "test media");
  const workspace = "workspace-1";
  for (const shared of [false, true]) {
    process.env.INKSHOT_SHARED_PROJECT_LIVE = String(shared);
    process.env.BILLING_MODE = shared ? "live" : "sandbox";
    config.mode = shared ? "live" : "mock";
    for (const kind of ["brand-uploads", "generated-media"] as const) {
      const bucket = (shared ? "inkshot-live-" : "") + kind;
      const ref = await persistMedia(file, workspace, kind);
      assert.equal(ref, `supabase://${bucket}/${workspace}/creative.png`);
      assert.match(calls.at(-1)!, new RegExp("/" + bucket + "/" + workspace + "/creative.png$"));
      assert.equal(await readFile(await materializeMedia(ref, workspace, kind), "utf8"), "test media");
      const callCount = calls.length;
      const otherBucket = (shared ? "" : "inkshot-live-") + kind;
      await assert.rejects(materializeMedia(ref.replace(bucket, otherBucket), workspace, kind), /does not exist/);
      await assert.rejects(materializeMedia(ref, "workspace-2", kind), /does not exist/);
      assert.equal(calls.length, callCount);
    }
  }
});

test("a correctly signed sandbox invoice cannot reach the live credit ledger", async t => {
  const values = { BILLING_MODE: "live", STRIPE_API_KEY: "sk_live_testfixture", STRIPE_STUDIO_PRICE_ID: "price_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture" };
  for (const [key, val] of Object.entries(values)) {
    const old = process.env[key];
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
    process.env[key] = val;
  }
  const payload = JSON.stringify({ id: "evt_fixture", object: "event", type: "invoice.paid", livemode: false, data: { object: {} } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: values.STRIPE_WEBHOOK_SECRET });
  await assert.rejects(webhook(null as never, Buffer.from(payload), signature), /environment does not match/);
});
