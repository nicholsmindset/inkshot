import "dotenv/config";
import path from "node:path";
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || "http://localhost:5173",
  dataDir: path.resolve(process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/inkshot" : "data")),
  production: process.env.NODE_ENV === "production",
  mode: (process.env.GENERATION_MODE === "live" ? "live" : "mock") as
    "live" | "mock",
  liveAllowed: process.env.ALLOW_LIVE_GENERATION === "true",
  hfKey: process.env.HF_API_KEY_ID,
  hfSecret: process.env.HF_API_KEY_SECRET,
  claudeKey: process.env.ANTHROPIC_API_KEY,
  openrouterKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5",
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  concurrency: Math.max(
    1,
    Math.min(4, Number(process.env.GENERATION_CONCURRENCY) || 2),
  ),
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertHostedConfiguration() {
  if (process.env.AUTH_PROVIDER !== "supabase" || process.env.STORAGE_PROVIDER !== "supabase" || !process.env.DATABASE_URL)
    throw new Error("Hosted identity, database and private storage are required.");
  const liveBilling = process.env.BILLING_MODE === "live";
  const liveGeneration = config.mode === "live";
  if (liveBilling !== liveGeneration)
    throw new Error("Live billing and generation must be enabled together.");
  if (liveBilling && (process.env.ENABLE_BILLING_SANDBOX === "true" || !/^[sr]k_live_/.test(process.env.STRIPE_API_KEY || "") || !process.env.STRIPE_STUDIO_PRICE_ID || !process.env.STRIPE_WEBHOOK_SECRET || !config.origin.startsWith("https://")))
    throw new Error("Live billing requires live Stripe settings and an HTTPS app origin.");
  if (liveGeneration && (!config.liveAllowed || !config.hfKey || !config.hfSecret || !Number.isFinite(Number(process.env.HF_DAILY_BUDGET_USD)) || Number(process.env.HF_DAILY_BUDGET_USD) <= 0 || (!config.claudeKey && !config.openrouterKey)))
    throw new Error("Live generation requires provider access, writing access and a spending limit.");
}
