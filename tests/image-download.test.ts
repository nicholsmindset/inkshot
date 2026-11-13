import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

test("a downloaded image uses the selected merchant photo and the approved asset CTA", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-image-"));
  process.env.DATA_DIR = dir;
  process.env.GENERATION_MODE = "mock";
  const { createApp } = await import("../server/app");
  const { createDatabase } = await import("../server/db");
  const { runWorkerOnce } = await import("../server/worker");
  const { renderMedia } = await import("../server/render");
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
  const login = await fetch(api + "/auth/demo", { method: "POST" });
  assert(login.ok);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const post = (url: string, body: unknown) => fetch(api + url, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // Give the uploaded photograph a distinctive color so fallback to the original fails.
  const picture = await sharp("public/examples/candle.png").tint("#307db1").png().toBuffer();
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array(picture)], { type: "image/png" }), "product.png");
  const upload = await fetch(api + "/uploads", { method: "POST", headers: { cookie }, body: form });
  assert.equal(upload.status, 201);
  const { id: photoId } = await upload.json();
  const response = await post("/campaigns", { name: "Merchant launch", goal: "Sales", offer: "Friday preorder" });
  assert.equal(response.status, 201);
  const { id, concepts } = await response.json();
  const approved = "Reserve the Friday batch";
  const drafts = concepts.flatMap((concept: { id: string; cta: string }, index: number) =>
    ["video", "image", "post"].map(kind => ({
      conceptId: concept.id, kind, cta: index === 0 && kind === "image" ? approved : concept.cta,
    })),
  );
  const generated = await post(`/campaigns/${id}/generate`, { approved: true, photoId, drafts });
  assert.equal(generated.status, 200);
  const target = (await db.query<{ id: string; format: string; name: string; photo: string }>(
    `SELECT v.id, a.format, c.brand->>'name' AS name, u.file_path AS photo
     FROM versions v JOIN assets a ON a.id=v.asset_id JOIN campaigns c ON c.id=a.campaign_id
     JOIN uploads u ON u.id=$2 WHERE c.id=$1 AND a.kind='image' AND a.title=$3`,
    [id, photoId, concepts[0].title],
  )).rows[0];
  assert(target);
  // Focus this worker run on one image. Video rendering belongs to another check.
  await db.query("UPDATE jobs SET available_at=now()+interval '1 hour' WHERE version_id<>$1", [target.id]);
  assert.equal(await runWorkerOnce(db), true);
  const result = await fetch(`${api}/media/${target.id}?download=true`, { headers: { cookie } });
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-disposition") || "", /attachment/);
  const downloaded = Buffer.from(await result.arrayBuffer());
  const meta = await sharp(downloaded).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1350);

  const expected = async (cta: string, label: string) => {
    const rendered = await renderMedia({
      id: label, source: target.photo, kind: "image", format: target.format,
      headline: concepts[0].hook, cta, brandName: target.name, mock: true,
    });
    return sharp(rendered.file_path).raw().toBuffer();
  };
  const pixels = await sharp(downloaded).raw().toBuffer();
  assert(pixels.equals(await expected(approved, "approved")), "download matches the approved image");
  assert(!pixels.equals(await expected("Alternate CTA", "control")), "changing CTA changes rendered pixels");
});
