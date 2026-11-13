import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { renderMedia } from "../server/render.js";

test("finished image includes merchant photo, logo, exact accent, headline and CTA", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-brand-"));
  const source = path.join(dir, "photo.png"), logo = path.join(dir, "logo.png");
  const rendered: string[] = [];
  try {
    await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#339944" } }).png().toFile(source);
    await sharp({ create: { width: 80, height: 50, channels: 4, background: "#ff00ff" } }).png().toFile(logo);
    const base = { source, logo, kind: "image", format: "4:5", brandName: "Friday Bakery", brandColor: "#1484cc", mock: false };
    const exportImage = async (headline: string, cta: string) => {
      const result = await renderMedia({ ...base, headline, cta, id: randomUUID() });
      rendered.push(result.file_path, result.file_path.replace(/\.jpg$/, "-overlay.png"));
      return result.file_path;
    };
    const first = await exportImage("Fresh bakes for Friday", "Pre-order by Thursday");
    const changed = await exportImage("Bread for the weekend", "Reserve a loaf");
    const rgb = async (left: number, top: number) =>
      [...await sharp(first).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    for (const [x, y, expected] of [[300, 7, [20,132,204]], [72,43,[255,0,255]], [540,800,[51,153,68]]] as const) {
      const actual = await rgb(x, y);
      expected.forEach((channel, i) => assert(Math.abs(channel - actual[i]) < 6));
    }
    // Read the final encoded JPEGs; each copy change must affect its own text band.
    for (const [top, height] of [[155, 105], [1225, 72]]) {
      const region = { left: 75, top, width: 925, height };
      const before = await sharp(first).extract(region).raw().toBuffer();
      const after = await sharp(changed).extract(region).raw().toBuffer();
      assert(!before.equals(after));
    }
  } finally {
    await Promise.all(rendered.map(file => rm(file, { force: true })));
    await rm(dir, { recursive: true, force: true });
  }
});
