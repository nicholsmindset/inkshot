import assert from "node:assert/strict";
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
