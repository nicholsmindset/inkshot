import assert from "node:assert/strict";
import { test } from "node:test";
import { validateKitArchive, waitForReadyKit, type VerificationAsset } from "../scripts/live-kit-validation";

const readyAssets = (): VerificationAsset[] => ["video", "image", "post"].flatMap(kind =>
  Array.from({ length: 3 }, (_, index) => ({
    id: `${kind}-${index}`, kind, status: "ready", file_path: `${kind}-${index}.media`, mock: false, error: null,
  })),
);
const options = { timeoutMs: 1000, intervalMs: 1 };

test("live kit verification rejects incomplete, duplicated, failed and sample outputs", async () => {
  await assert.rejects(waitForReadyKit(async () => [], options), /nine distinct/);
  await assert.rejects(waitForReadyKit(async () => readyAssets().slice(1), options), /nine distinct/);
  const duplicate = readyAssets();
  duplicate[1] = duplicate[0];
  await assert.rejects(waitForReadyKit(async () => duplicate, options), /nine distinct/);
  const wrongKinds = readyAssets();
  wrongKinds[0].kind = "image";
  await assert.rejects(waitForReadyKit(async () => wrongKinds, options), /three video/);
  const failed = readyAssets();
  failed[0].status = "failed";
  failed[0].error = "Provider failed";
  await assert.rejects(waitForReadyKit(async () => failed, options), /Provider failed/);
  const sample = readyAssets();
  sample[0].mock = true;
  await assert.rejects(waitForReadyKit(async () => sample, options), /not a live generation/);
  const missingFile = readyAssets();
  missingFile[0].file_path = null;
  await assert.rejects(waitForReadyKit(async () => missingFile, options), /no output file/);
});

test("live kit verification fails at timeout and succeeds only after all outputs are ready", async () => {
  const pending = readyAssets();
  pending[0].status = "making";
  await assert.rejects(waitForReadyKit(async () => pending, { timeoutMs: 10, intervalMs: 1 }), /timed out/);
  let reads = 0;
  const complete = readyAssets();
  const result = await waitForReadyKit(async () => ++reads === 1 ? pending : complete, options);
  assert.equal(reads, 2);
  assert.deepEqual(result, complete);
});

test("archive validation rejects HTML, empty and truncated responses", () => {
  assert.throws(() => validateKitArchive(Buffer.alloc(0)), /empty/);
  assert.throws(() => validateKitArchive(Buffer.from("<html>Service unavailable</html>")), /not a populated ZIP/);
  assert.throws(() => validateKitArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04])), /empty/);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  assert.throws(() => validateKitArchive(header), /directory/);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);
  footer.writeUInt16LE(1, 10);
  validateKitArchive(Buffer.concat([header, footer]));
  assert.throws(() => validateKitArchive(Buffer.concat([header, footer.subarray(0, 21)])), /directory/);
});
