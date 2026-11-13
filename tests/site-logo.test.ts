import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { rasterizeSiteLogo } from "../server/site-logo";
import { fetchSiteLogo } from "../server/scrape";

const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#b7102a"/><text x="256" y="340" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="260" fill="white">SG</text></svg>';

test("the Smart Calculator reference rasterizes to a transparent branded PNG", async () => {
  const png = await rasterizeSiteLogo(Buffer.from(fixture), "image/svg+xml");
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512);
  const sample = async (left: number, top: number) => [...await sharp(png).extract({ left, top, width: 1, height: 1 }).raw().toBuffer()];
  // The background alone still renders on a host with missing fonts.
  const { data, info } = await sharp(png).extract({ left: 50, top: 110, width: 412, height: 270 })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240 && data[i + 3] === 255) whitePixels++;
  }
  assert.ok(whitePixels > 10000, "SG lettering must be legible in the imported logo");
  assert.equal((await sample(0, 0))[3], 0);
  assert.deepEqual(await sample(256, 48), [183, 16, 42, 255]);
});

test("unsupported SVG constructs, oversized dimensions and mislabeled inputs fail closed", async () => {
  for (const input of [
    fixture.replace("<rect", "<foreignObject/><rect"),
    fixture.replace('fill="#b7102a"', 'style="color:red"'),
    fixture.replace('width="512"', 'width="9999"'),
    fixture.repeat(300),
  ]) await assert.rejects(rasterizeSiteLogo(Buffer.from(input), "image/svg+xml"));
  await assert.rejects(rasterizeSiteLogo(Buffer.from(fixture), "image/png"));
  await assert.rejects(fetchSiteLogo("https://example.org", "https://other.example/logo.png"));
  await assert.rejects(fetchSiteLogo("https://127.0.0.1", "https://127.0.0.1/logo.png"));
});
