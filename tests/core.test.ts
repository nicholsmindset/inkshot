import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createDatabase, type Database } from "../server/db";
import { createApp } from "../server/app";
import { changeCredits } from "../server/credits";
import { isPublicIp } from "../server/scrape";
import { hashPassword, verifyPassword } from "../server/auth";
import { lines } from "../server/render";
let db: Database,
  server: Server,
  base: string,
  dir: string,
  cookieA: string,
  cookieB: string,
  workspace: string,
  campaignId: string;
async function call(
  route: string,
  body?: unknown,
  cookie = cookieA,
  method?: string,
) {
  return fetch(`${base}/api${route}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-test-"));
  db = await createDatabase(dir, true);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  const a = await call("/auth/demo", {}, "");
  cookieA = a.headers.get("set-cookie")!.split(";")[0];
  const b = await call("/auth/demo", {}, "");
  cookieB = b.headers.get("set-cookie")!.split(";")[0];
  workspace = (await (await call("/studio")).json()).user.workspaceId;
});
after(async () => {
  await new Promise<void>((r, e) =>
    server.close((err) => (err ? e(err) : r())),
  );
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
test("rejects unauthenticated access and hostile mutation origins", async () => {
  assert.equal((await call("/studio", undefined, "")).status, 401);
  const r = await fetch(`${base}/api/brand`, {
    method: "PUT",
    headers: {
      cookie: cookieA,
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
});
test("passwords are salted and verified without storing plaintext", async () => {
  const a = await hashPassword("a sufficiently long password");
  const b = await hashPassword("a sufficiently long password");
  assert.notEqual(a, b);
  assert(await verifyPassword("a sufficiently long password", a));
  assert(!(await verifyPassword("wrong", a)));
});
test("blocks private, loopback, mapped and metadata IP addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "192.168.0.1",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("8.8.8.8"), true);
});
test("campaign creation and repeated generation spend exactly 100 credits", async () => {
  const result = await call("/campaigns", {
    name: "Test campaign",
    goal: "Sales",
    offer: "Explore the collection",
  });
  assert.equal(result.status, 201);
  campaignId = (await result.json()).id;
  const responses = await Promise.all([
    call(`/campaigns/${campaignId}/generate`, { approved: true }),
    call(`/campaigns/${campaignId}/generate`, { approved: true }),
  ]);
  assert(responses.every((r) => r.ok));
  const studio = await (await call("/studio")).json();
  assert.equal(studio.balance, 200);
  assert.equal(studio.assets.length, 9);
  assert.equal(
    studio.assets.reduce(
      (sum: number, a: { versions: { credit_cost: number }[] }) =>
        sum + a.versions[0].credit_cost,
      0,
    ),
    100,
  );
  assert.equal((await db.query("SELECT id FROM jobs")).rows.length, 9);
});
test("isolates campaigns, versions and uploaded media between accounts", async () => {
  const other = await (await call("/studio", undefined, cookieB)).json();
  assert.equal(other.assets.length, 0);
  assert.equal(other.campaigns.length, 0);
  assert.equal(other.balance, 300);
  assert.equal(
    (
      await call(
        `/campaigns/${campaignId}/generate`,
        { approved: true },
        cookieB,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(`/campaigns/${campaignId}/download`, undefined, cookieB))
      .status,
    404,
  );
  const own = await (await call("/studio")).json();
  const vid = own.assets[0].versions[0].id;
  assert.equal((await call(`/media/${vid}`, undefined, cookieB)).status, 404);
  assert.equal(
    (
      await call(
        `/assets/${own.assets[0].id}/current`,
        { versionId: vid },
        cookieB,
        "PUT",
      )
    ).status,
    404,
  );
});
test("credit ledger deduplicates refunds and prevents overdrafts atomically", async () => {
  await db.transaction((tx) =>
    changeCredits(tx, workspace, 5, "refund", "Test refund", "test-refund"),
  );
  await db.transaction((tx) =>
    changeCredits(tx, workspace, 5, "refund", "Test refund", "test-refund"),
  );
  assert.equal((await (await call("/studio")).json()).balance, 205);
  await assert.rejects(
    db.transaction((tx) =>
      changeCredits(
        tx,
        workspace,
        -1000,
        "generation",
        "Too much",
        "test-overdraft",
      ),
    ),
  );
  assert.equal((await (await call("/studio")).json()).balance, 205);
});
test("logout invalidates the server session", async () => {
  assert((await call("/auth/logout", {}, cookieB)).ok);
  assert.equal((await call("/studio", undefined, cookieB)).status, 401);
});
test("free text edits retain originals and charge no credits", async () => {
  const studio = await (await call("/studio")).json();
  const asset = studio.assets.find((a: { kind: string }) => a.kind === "image");
  const original = asset.versions[0];
  await db.query(
    "UPDATE versions SET status='ready',source_path=$2 WHERE id=$1",
    [original.id, path.resolve("public/examples/candle.png")],
  );
  const response = await call(`/assets/${asset.id}/revise`, {
    versionId: original.id,
    headline: "A fresh headline",
    cta: "Discover more",
    note: "A free text edit",
    regenerate: false,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert(result.versionId);
  const next = await (await call("/studio")).json();
  assert.equal(next.balance, 205);
  const versions = next.assets.find(
    (a: { id: string }) => a.id === asset.id,
  ).versions;
  assert.equal(versions.length, 2);
  assert.equal(
    versions.find((v: { n: number }) => v.n === 1).headline,
    original.headline,
  );
  assert.equal(versions.find((v: { n: number }) => v.n === 2).credit_cost, 0);
});
test("long headlines wrap without dropping words", () => {
  const text =
    "A carefully written headline that tells your whole story and keeps every single word in the final exported creative.";
  assert.equal(lines(text).join(" "), text);
  assert(lines("a".repeat(100), 24).every((row) => row.length <= 24));
});

test('subscription invoice grants exactly once across duplicate event IDs', async()=>{
  const {applyPaymentFact}=await import('../server/billing');
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES($1,'cus_test_inkshot') ON CONFLICT(workspace_id) DO UPDATE SET customer_id='cus_test_inkshot'",[workspace]);
  const fact={eventId:'evt_paid_1',eventType:'invoice.paid',created:100,customerId:'cus_test_inkshot',subscriptionId:'sub_test',status:'active',invoiceId:'in_test_1',grantCredits:true};
  await applyPaymentFact(db,fact);await applyPaymentFact(db,fact);await applyPaymentFact(db,{...fact,eventId:'evt_paid_retry'});
  assert.equal(Number((await db.query<{credits:number}>('SELECT credits FROM workspaces WHERE id=$1',[workspace])).rows[0].credits),300);
});
test('unpaid and out-of-order billing events cannot grant credits or roll back status',async()=>{
 const {applyPaymentFact}=await import('../server/billing');
 const before=(await db.query<{credits:number}>('SELECT credits FROM workspaces WHERE id=$1',[workspace])).rows[0].credits;
 const fact={eventId:'evt_cancel',eventType:'customer.subscription.deleted',created:300,customerId:'cus_test_inkshot',subscriptionId:'sub_test',status:'canceled',grantCredits:false};
 await applyPaymentFact(db,fact);
 await applyPaymentFact(db,{...fact,eventId:'evt_old',created:200,status:'past_due'});
 assert.equal((await db.query<{status:string}>('SELECT status FROM billing_accounts WHERE workspace_id=$1',[workspace])).rows[0].status,'canceled');
 assert.equal((await db.query<{credits:number}>('SELECT credits FROM workspaces WHERE id=$1',[workspace])).rows[0].credits,before);
});
test('unknown billing customers are retried rather than assigned to another workspace',async()=>{
 const {applyPaymentFact}=await import('../server/billing');
 await assert.rejects(()=>applyPaymentFact(db,{eventId:'evt_unknown',eventType:'invoice.paid',created:400,customerId:'cus_unknown',subscriptionId:'sub_other',status:'active',invoiceId:'in_other',grantCredits:true}),/not linked/);
 assert.equal((await db.query("SELECT id FROM payment_events WHERE id='evt_unknown'")).rows.length,0);
});
test('Stripe webhook requires a signature',async()=>{
 assert.equal((await call('/webhooks/stripe',{type:'invoice.paid'},'')).status,400);
});
