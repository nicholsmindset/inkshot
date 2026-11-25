// Launch-day live smoke test: ONE image through the real provider, hard-capped, never a full kit.
// Dry run by default (asks the provider for a quote only). Add --yes to spend.
//   ALLOW_LIVE_GENERATION=true HF_API_KEY_ID=... HF_API_KEY_SECRET=... \
//   npx tsx scripts/smoke-live-image.ts --max-usd 1 [--yes] [--prompt "..."]
// Uses a throwaway local database for the spend ledger, so it never touches production data,
// and refuses any quote above --max-usd. Prints the elapsed time and provider status, never a key.
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Database } from "../server/db.js";
import { submitBudgeted } from "../server/provider-budget.js";
import type { HFStatus } from "../server/higgsfield.js";

export type SmokeProvider = {
  estimate(model: string, input: unknown): Promise<{ usd: string; credits: string }>;
  submit(model: string, input: unknown, key: string): Promise<HFStatus>;
  status(id: string): Promise<HFStatus>;
};
export type SmokeResult = { outcome: "dry-run" | "refused" | "completed" | "failed" | "timeout"; quoteUsd: number; requestId?: string; seconds?: number; detail: string };

export async function runSmoke(options: { provider: SmokeProvider; db: Database; model: string; prompt: string; maxUsd: number; yes: boolean; pollMs?: number; timeoutMs?: number }): Promise<SmokeResult> {
  const { provider, db, model, prompt, maxUsd, yes } = options;
  const input = { prompt, resolution: "1080p", aspect_ratio: "1:1" };
  const quote = Number((await provider.estimate(model, input)).usd);
  if (!Number.isFinite(quote) || quote <= 0) return { outcome: "refused", quoteUsd: quote, detail: "The provider returned no usable quote." };
  if (quote > maxUsd) return { outcome: "refused", quoteUsd: quote, detail: `Quote US$${quote} is above the cap of US$${maxUsd}. Nothing was submitted.` };
  if (!yes) return { outcome: "dry-run", quoteUsd: quote, detail: `Would spend about US$${quote}. Re-run with --yes to submit one image.` };
  process.env.HF_DAILY_BUDGET_USD = String(maxUsd); // the shared budget guard enforces the same cap
  const started = Date.now();
  const { request_id: requestId } = await submitBudgeted(db, model, input, `smoke:${randomUUID()}`, { estimate: provider.estimate, submit: provider.submit });
  const deadline = started + (options.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    const status = await provider.status(requestId);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (status.status === "completed") {
      const url = status.images?.[0]?.url;
      return { outcome: url ? "completed" : "failed", quoteUsd: quote, requestId, seconds, detail: url ? `Image ready in ${seconds}s (host ${new URL(url).host}).` : "Completed without an image URL." };
    }
    if (["failed", "nsfw", "canceled"].includes(status.status)) return { outcome: "failed", quoteUsd: quote, requestId, seconds, detail: `Provider status: ${status.status}.` };
    await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 5000));
  }
  return { outcome: "timeout", quoteUsd: quote, requestId, detail: "Still running after the timeout. Check the Higgsfield console; the request may still be billed." };
}

async function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const maxUsd = Number(arg("max-usd") ?? 1);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 10) throw new Error("--max-usd must be above 0 and at most 10.");
  if (process.env.ALLOW_LIVE_GENERATION !== "true" || !process.env.HF_API_KEY_ID || !process.env.HF_API_KEY_SECRET)
    throw new Error("Set ALLOW_LIVE_GENERATION=true, HF_API_KEY_ID and HF_API_KEY_SECRET (never paste them into chat).");
  const hf = await import("../server/higgsfield.js");
  const { createDatabase } = await import("../server/db.js");
  // A throwaway ledger in the OS temp area; the operating system clears it. Nothing here touches production data.
  const db = await createDatabase(await mkdtemp(path.join(os.tmpdir(), "inkshot-smoke-")), true);
  try {
    const result = await runSmoke({ provider: hf, db, model: hf.MODELS.image, maxUsd, yes: process.argv.includes("--yes"),
      prompt: arg("prompt") ?? "A ceramic coffee mug on a wooden table by a window, soft morning light, plain background. No text, no logos." });
    console.log(`${result.outcome.toUpperCase()}: ${result.detail}${result.requestId ? ` (request ${result.requestId})` : ""}`);
    if (result.outcome === "completed" || result.outcome === "dry-run") return;
    process.exitCode = 1;
  } finally { await db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke test failed."); process.exitCode = 1; });
