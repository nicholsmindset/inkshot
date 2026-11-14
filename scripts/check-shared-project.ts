// Disposable acceptance: run both application roles against the same local Auth,
// Postgres and Storage. Paid writing, generation and Stripe network calls are forbidden.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import type { PaymentFact } from "../server/billing.js";

const localDb = new URL(process.env.DATABASE_URL ?? "");
const authUrl = new URL(process.env.SUPABASE_URL ?? "");
assert.equal(localDb.hostname, "127.0.0.1");
assert.equal(authUrl.hostname, "127.0.0.1");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "external network disabled in this test",
  );
  return realFetch(input, init);
};

const ref = "smpdzhxydnctiyjqojmp";
type Fixture = {
  email: string;
  password: string;
  sandboxPassword: string;
  livePassword: string;
};
type Evidence = {
  userId: string;
  workspaceId: string;
  uploadId: string;
  campaignId: string;
};
const phase = process.argv[2] ?? "setup";
if (phase === "setup") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-shared-"));
  const test: Fixture = {
    email: `merchant-${randomUUID()}@example.com`,
    password: randomUUID(),
    sandboxPassword: randomUUID(),
    livePassword: randomUUID(),
  };
  const admin = new pg.Client({ connectionString: localDb.href });
  try {
    await admin.connect();
    // All passwords below are generated UUIDs, used only by this disposable stack.
    await admin.query(
      `CREATE ROLE inkshot_app LOGIN PASSWORD '${test.sandboxPassword}'`,
    );
    const tables = [
      "workspaces",
      "users",
      "sessions",
      "campaigns",
      "assets",
      "versions",
      "jobs",
      "ledger",
      "uploads",
      "billing_accounts",
      "payment_events",
      "provider_spend",
      "writing_daily_usage",
    ];
    for (const table of tables) {
      await admin.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON public.${table} TO inkshot_app`,
      );
      await admin.query(
        `CREATE POLICY fixture_runtime ON public.${table} TO inkshot_app USING (true) WITH CHECK (true)`,
      );
    }
    await admin.query(
      "GRANT SELECT ON public.inkshot_environment TO inkshot_app",
    );
    await writeFile(path.join(dir, "fixture.json"), JSON.stringify(test), {
      mode: 0o600,
    });
    const run = (step: string) =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", fileURLToPath(import.meta.url), step, dir],
        { stdio: "inherit" },
      );
    run("sandbox");
    // Apply the production bootstrap to a sandbox that already contains customer data.
    execFileSync("psql", [
      localDb.href,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "scripts/setup-shared-live.sql",
    ]);
    await admin.query(
      `ALTER ROLE inkshot_live_app LOGIN PASSWORD '${test.livePassword}'`,
    );
    run("live");
    run("sandbox-worker");
    run("live-recheck");
    console.log(
      "Shared project acceptance passed: one Auth identity, separate workspaces, balances, jobs, private media and exports.",
    );
  } finally {
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
} else {
  const dir = process.argv[3];
  const test: Fixture = JSON.parse(
    await readFile(path.join(dir, "fixture.json"), "utf8"),
  );
  const live = phase.startsWith("live");
  const role = live ? "inkshot_live_app" : "inkshot_app";
  process.env.GENERATION_MODE = live ? "live" : "mock";
  process.env.BILLING_MODE = live ? "live" : "sandbox";
  process.env.ALLOW_LIVE_GENERATION = "false";
  process.env.INKSHOT_SHARED_PROJECT_LIVE = live ? "true" : "false";
  process.env.DATA_DIR = path.join(dir, role);
  const { databaseFromPool } = await import("../server/db.js");
  const { createApp } = await import("../server/app.js");
  const { runWorkerOnce } = await import("../server/worker.js");
  const { applyPaymentFact } = await import("../server/billing.js");
  localDb.username = role;
  localDb.password = live ? test.livePassword : test.sandboxPassword;
  // The production resolver checks the canonical Supabase hostname. Only socket
  // transport uses loopback; Postgres authenticates the actual non-admin login.
  const pool = new pg.Pool({ connectionString: localDb.href, max: 3 });
  const db = await databaseFromPool(
    pool,
    live,
    `postgresql://${role}@db.${ref}.supabase.co/postgres`,
    `https://${ref}.supabase.co`,
    live,
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}/api`;
  let cookie = "";
  const request = (route: string, method = "GET", body?: unknown) =>
    fetch(base + route, {
      method,
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const studio = async () => {
    const res = await request("/studio");
    assert.equal(res.status, 200);
    return res.json();
  };
  const upload = async () => {
    const form = new FormData();
    form.append(
      "photo",
      new Blob([await readFile("public/examples/candle.png")], {
        type: "image/png",
      }),
      "candle.png",
    );
    const res = await fetch(base + "/uploads", {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    assert.equal(res.status, 201);
    return String((await res.json()).id);
  };
  const sandboxEvidence = async (): Promise<Evidence> =>
    JSON.parse(await readFile(path.join(dir, "sandbox.json"), "utf8"));
  const fixtureInvoice = (side: string): PaymentFact => ({
    eventType: "invoice.paid",
    eventId: "evt_ci_" + side,
    customerId: "cus_ci_" + side,
    subscriptionId: "sub_ci_" + side,
    invoiceId: "in_ci_" + side,
    status: "active",
    created: 1,
    grantCredits: true,
  });
  try {
    const credentials = { email: test.email, password: test.password };
    if (phase === "sandbox")
      assert.equal(
        (
          await request("/auth/signup", "POST", {
            ...credentials,
            name: "CI merchant",
          })
        ).status,
        201,
      );
    const login = await request("/auth/login", "POST", credentials);
    assert.equal(login.status, 200);
    cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const account = await studio();
    const workspaceId: string = account.user.workspaceId;
    if (phase === "sandbox") {
      assert.equal(account.balance, 0);
      const uploadId = await upload();
      await db.query(
        "INSERT INTO billing_accounts(workspace_id,customer_id) VALUES($1,$2)",
        [workspaceId, "cus_ci_sandbox"],
      );
      await applyPaymentFact(db, fixtureInvoice("sandbox"));
      assert.equal((await studio()).balance, 300);
      const { emptyBrand } = await import("../server/brand.js");
      assert.equal(
        (
          await request("/brand", "PUT", {
            ...emptyBrand,
            name: "CI merchant",
            description: "Example bakery",
            photoId: uploadId,
          })
        ).status,
        200,
      );
      const campaign = await request("/campaigns", "POST", {
        name: "Sandbox campaign",
        goal: "Sales",
        offer: "CI offer",
      });
      assert.equal(campaign.status, 201);
      const { id: campaignId } = await campaign.json();
      assert.equal(
        (
          await request(`/campaigns/${campaignId}/generate`, "POST", {
            approved: true,
            photoId: uploadId,
          })
        ).status,
        200,
      );
      assert.equal((await studio()).balance, 200);
      await writeFile(
        path.join(dir, "sandbox.json"),
        JSON.stringify({
          userId: account.user.id,
          workspaceId,
          uploadId,
          campaignId,
        }),
      );
    } else {
      const sand = await sandboxEvidence();
      assert.equal(account.user.id, sand.userId);
      if (live) {
        assert.notEqual(workspaceId, sand.workspaceId);
        assert.equal(account.campaigns.length, 0);
        assert.equal((await request("/uploads/" + sand.uploadId)).status, 404);
        assert.equal(
          (await request(`/campaigns/${sand.campaignId}/download`)).status,
          404,
        );
        assert.equal(
          await runWorkerOnce(db),
          false,
          "live worker must never claim a queued sandbox job",
        );
      }
      if (phase === "live") {
        assert.equal(account.balance, 0);
        await assert.rejects(
          applyPaymentFact(db, fixtureInvoice("sandbox")),
          /not linked/,
        );
        await db.query(
          "INSERT INTO billing_accounts(workspace_id,customer_id) VALUES($1,$2)",
          [workspaceId, "cus_ci_live"],
        );
        await applyPaymentFact(db, fixtureInvoice("live"));
        await applyPaymentFact(db, fixtureInvoice("live"));
        assert.equal((await studio()).balance, 300);
        const id = await upload();
        assert.equal((await request("/uploads/" + id)).status, 200);
        const { rows } = await db.query<{ file_path: string }>(
          "SELECT file_path FROM uploads WHERE id=$1",
          [id],
        );
        const bucket = "inkshot-live-brand-uploads";
        const prefix = "supabase://" + bucket + "/";
        assert(rows[0].file_path.startsWith(prefix + workspaceId + "/"));
        const key = rows[0].file_path.slice(prefix.length);
        const storage = createClient(
          authUrl.origin,
          process.env.SUPABASE_SECRET_KEY!,
        ).storage.from(bucket);
        const original = await storage.download(key);
        assert(original.data);
        const data = Buffer.from(await original.data.arrayBuffer());
        const backup = path.join(dir, "media-backup.jpg");
        await writeFile(backup, data);
        assert.equal((await storage.remove([key])).error, null);
        assert((await storage.download(key)).error);
        assert.equal(
          (
            await storage.upload(key, await readFile(backup), {
              contentType: "image/jpeg",
            })
          ).error,
          null,
        );
        const restored = await request("/uploads/" + id);
        assert.equal(restored.status, 200);
        assert(
          data.equals(Buffer.from(await restored.arrayBuffer())),
          "restored bytes must match the private original",
        );
        assert(
          !(
            await fetch(
              authUrl.origin +
                "/storage/v1/object/public/" +
                bucket +
                "/" +
                key,
            )
          ).ok,
        );
        await writeFile(
          path.join(dir, "live.json"),
          JSON.stringify({ id, workspaceId }),
        );
      } else if (phase === "sandbox-worker") {
        assert.equal(workspaceId, sand.workspaceId);
        const { id } = JSON.parse(
          await readFile(path.join(dir, "live.json"), "utf8"),
        );
        assert.equal((await request("/uploads/" + id)).status, 404);
        assert.equal(account.balance, 200);
        await assert.rejects(
          applyPaymentFact(db, fixtureInvoice("live")),
          /not linked/,
        );
        for (let i = 0; i < 9; i++) assert(await runWorkerOnce(db));
        assert.equal(
          (await request(`/campaigns/${sand.campaignId}/download`)).status,
          200,
        );
      } else {
        const liveState = JSON.parse(
          await readFile(path.join(dir, "live.json"), "utf8"),
        );
        assert.equal(workspaceId, liveState.workspaceId);
        assert.equal(account.balance, 300);
        assert.equal(account.assets.length, 0);
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
}
