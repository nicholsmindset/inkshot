// Run only against a disposable Supabase CLI stack (see managed-preview.yml).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

for (const key of ["DATABASE_URL", "SUPABASE_URL"]) {
  assert.equal(new URL(process.env[key] ?? "").hostname, "127.0.0.1", "Use the disposable local stack.");
}
assert.equal(process.env.GENERATION_MODE, "mock");
assert.equal(process.env.ALLOW_LIVE_GENERATION, "false");
process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "inkshot-managed-"));
const { assertHostedConfiguration } = await import("../server/config");
const { createApp } = await import("../server/app");
const { createDatabase } = await import("../server/db");
const { changeCredits } = await import("../server/credits");
const { emptyBrand } = await import("../server/brand");
const { runWorkerOnce } = await import("../server/worker");
assertHostedConfiguration();
const db = await createDatabase();
const server = createApp(db).listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function account() {
  const credentials = { email: `ci-${randomUUID()}@example.com`, password: randomUUID() };
  const post = (route: string, body: object) => fetch(base + route, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await post("/auth/signup", { ...credentials, name: "Test merchant" })).status, 201);
  const login = await post("/auth/login", credentials);
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  assert(cookie);
  const initial = await (await fetch(base + "/studio", { headers: { cookie } })).json();
  const logout = await fetch(base + "/auth/logout", { method: "POST", headers: { cookie } });
  assert.equal(logout.status, 200);
  assert(logout.headers.getSetCookie().some(value => value.includes("Max-Age=0")), "Sign-out must clear the browser session");
  assert.equal((await fetch(base + "/studio")).status, 401);
  assert.equal((await post("/auth/login", { ...credentials, password: "incorrect-password" })).status, 401);
  const returning = await post("/auth/login", { ...credentials, email: " " + credentials.email.toUpperCase() + " " });
  assert.equal(returning.status, 200);
  assert.equal(returning.headers.get("cache-control"), "no-store");
  const returningCookie = returning.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const resumed = await (await fetch(base + "/studio", { headers: { cookie: returningCookie } })).json();
  assert.equal(resumed.user.id, initial.user.id);
  assert.equal(resumed.user.workspaceId, initial.user.workspaceId);
  assert.equal((await db.query("SELECT id FROM users WHERE id=$1", [initial.user.id])).rows.length, 1);
  return returningCookie;
}
try {
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, "mock");
  const cookie = await account();
  const other = await account();
  const { checkPasswordRecovery } = await import("./check-password-recovery");
  await checkPasswordRecovery(base, cookie);
  const headers = { cookie };
  const get = (route: string) => fetch(base + route, { headers });
  const post = (route: string, body: object, method = "POST") => fetch(base + route, {
    method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const identity = await (await get("/studio")).json();
  assert.equal(identity.balance, 0);
  assert.equal(identity.user.demo, false);
  const form = new FormData();
  form.append("photo", new Blob([await readFile("public/examples/candle.png")], { type: "image/png" }), "product.png");
  const upload = await fetch(base + "/uploads", { method: "POST", headers, body: form });
  assert.equal(upload.status, 201);
  const { id: photoId } = await upload.json();
  assert.equal((await get("/uploads/" + photoId)).status, 200);
  assert.equal((await fetch(base + "/uploads/" + photoId, { headers: { cookie: other } })).status, 404);
  const ref = (await db.query<{ file_path: string }>("SELECT file_path FROM uploads WHERE id=$1", [photoId])).rows[0].file_path;
  assert(ref.startsWith("supabase://brand-uploads/"));
  const publicObject = await fetch(process.env.SUPABASE_URL + "/storage/v1/object/public/" + ref.slice("supabase://".length));
  assert(!publicObject.ok);
  await db.transaction(tx => changeCredits(tx, identity.user.workspaceId, 100, "test", "CI kit allowance", "ci:" + randomUUID()));
  assert((await post("/brand", { ...emptyBrand, name: "Test merchant", description: "Test product photo", photoId }, "PUT")).ok);
  const draft = await post("/campaigns", { name: "Test campaign", goal: "Sales", offer: "Order a sample" });
  assert.equal(draft.status, 201);
  const { id, concepts } = await draft.json();
  assert.equal(concepts.length, 6);
  const prompts = await post(`/campaigns/${id}/prompts`, {
    revision: 0, selectedConceptIds: concepts.slice(0, 3).map((concept: { id: string }) => concept.id),
  });
  assert.equal(prompts.status, 200);
  const savedDraft = await prompts.json();
  assert.equal(savedDraft.assets.length, 9);
  assert((await post(`/campaigns/${id}/generate`, { approved: true, draftRevision: savedDraft.revision })).ok);
  for (let i = 0; i < 9; i++) assert(await runWorkerOnce(db));
  const results = await (await get("/studio")).json();
  assert.equal(results.balance, 0);
  assert.equal(results.assets.length, 9);
  assert(results.assets.every((asset: { versions: { status: string }[] }) => asset.versions[0].status === "ready"));
  const media = (await db.query<{ file_path: string }>("SELECT file_path FROM versions WHERE workspace_id=$1", [identity.user.workspaceId])).rows;
  assert(media.every(v => v.file_path.startsWith("supabase://generated-media/")));
  const queued = await post(`/campaigns/${id}/exports`, {category:"all"});
  assert.equal(queued.status,202);
  const archive = await queued.json();
  assert(await runWorkerOnce(db));
  const status = await get(`/exports/${archive.id}`);
  assert.equal(status.status,200);
  assert.equal((await status.json()).state,"ready");
  const download = `/exports/${archive.id}/download`;
  assert.equal((await fetch(base + download)).status, 401);
  assert.equal((await fetch(base + download, { headers: { cookie: other } })).status, 404);
  const response = await get(download);
  assert.equal(response.status, 200);
  const zip = path.join(process.env.DATA_DIR, "kit.zip");
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  execFileSync("unzip", ["-tq", zip]);
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
  assert.equal(names.filter(n => n.endsWith(".mp4")).length, 3);
  assert.equal(names.filter(n => n.endsWith(".jpg")).length, 6);
  console.log("Fresh managed accounts, private upload, nine worker outputs and private ZIP passed.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.close();
  await rm(process.env.DATA_DIR, { recursive: true, force: true });
}
