export type VerificationAsset = {
  id: string;
  kind: string;
  status: string | null;
  file_path: string | null;
  mock: boolean | null;
  error: string | null;
};

function validateAssets(assets: VerificationAsset[]) {
  if (assets.length !== 9 || new Set(assets.map(asset => asset.id)).size !== 9)
    throw new Error(`Expected nine distinct campaign assets, received ${assets.length}.`);
  for (const kind of ["video", "image", "post"]) {
    if (assets.filter(asset => asset.kind === kind).length !== 3)
      throw new Error(`Expected three ${kind} assets.`);
  }
  for (const asset of assets) {
    if (asset.mock !== false) throw new Error(`Asset ${asset.id} is not a live generation.`);
    if (!["queued", "making", "rendering", "ready"].includes(asset.status || ""))
      throw new Error(`Asset ${asset.id} cannot complete: ${asset.error || asset.status || "missing current version"}.`);
    if (asset.status === "ready" && !asset.file_path)
      throw new Error(`Ready asset ${asset.id} has no output file.`);
  }
}

export async function waitForReadyKit(
  readAssets: () => Promise<VerificationAsset[]>,
  options: { timeoutMs: number; intervalMs: number; onProgress?: (assets: VerificationAsset[]) => void },
): Promise<VerificationAsset[]> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const assets = await readAssets();
    if (Date.now() >= deadline) break;
    validateAssets(assets);
    options.onProgress?.(assets);
    if (assets.every(asset => asset.status === "ready")) return assets;
    await new Promise(resolve => setTimeout(resolve, Math.min(options.intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error("Live kit verification timed out before all nine assets were ready.");
}

export function validateKitArchive(bytes: Buffer) {
  // A populated ZIP starts with a local file header and ends with a central-directory record.
  if (bytes.length < 22 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    throw new Error("The downloaded kit is empty or is not a populated ZIP archive.");
  const directory = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (directory < 0 || directory + 22 > bytes.length || bytes.readUInt16LE(directory + 10) === 0)
    throw new Error("The downloaded kit has no complete ZIP directory.");
  const commentLength = bytes.readUInt16LE(directory + 20);
  if (directory + 22 + commentLength !== bytes.length)
    throw new Error("The downloaded kit has an incomplete ZIP footer.");
}
