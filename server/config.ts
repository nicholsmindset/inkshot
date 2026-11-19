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

export function writingLimits() {
  const global = Number(process.env.WRITING_DAILY_REQUEST_LIMIT);
  const workspace = Number(process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT);
  if (![global, workspace].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647) || workspace > global)
    throw new AppError(503, "Daily writing limits are not configured.");
  return { global, workspace };
}

export const hostedConfigurationCodes = [
  "HOSTED_AUTH_REQUIRED", "HOSTED_STORAGE_REQUIRED", "HOSTED_DATABASE_REQUIRED",
  "LIVE_MODE_MISMATCH", "LIVE_BILLING_REQUIRED", "LIVE_PROVIDER_REQUIRED", "WRITING_LIMITS_REQUIRED",
] as const;
export class HostedConfigurationError extends Error {
  constructor(readonly code: typeof hostedConfigurationCodes[number], message: string) {
    super(message);
  }
}

export function assertHostedConfiguration() {
  if (process.env.AUTH_PROVIDER !== "supabase")
    throw new HostedConfigurationError("HOSTED_AUTH_REQUIRED", "Hosted identity is required.");
  if (process.env.STORAGE_PROVIDER !== "supabase")
    throw new HostedConfigurationError("HOSTED_STORAGE_REQUIRED", "Hosted private storage is required.");
  if (!process.env.DATABASE_URL)
    throw new HostedConfigurationError("HOSTED_DATABASE_REQUIRED", "A hosted database is required.");
  const liveBilling = process.env.BILLING_MODE === "live";
  const liveGeneration = config.mode === "live";
  if (liveBilling !== liveGeneration)
    throw new HostedConfigurationError("LIVE_MODE_MISMATCH", "Live billing and generation must be enabled together.");
  if (liveBilling && (process.env.ENABLE_BILLING_SANDBOX === "true" || !/^[sr]k_live_/.test(process.env.STRIPE_API_KEY || "") || !process.env.STRIPE_STUDIO_PRICE_ID || !process.env.STRIPE_WEBHOOK_SECRET || !config.origin.startsWith("https://")))
    throw new HostedConfigurationError("LIVE_BILLING_REQUIRED", "Live billing requires live Stripe settings and an HTTPS app origin.");
  if (liveGeneration && (!config.liveAllowed || !config.hfKey || !config.hfSecret || !Number.isFinite(Number(process.env.HF_DAILY_BUDGET_USD)) || Number(process.env.HF_DAILY_BUDGET_USD) <= 0 || (!config.claudeKey && !config.openrouterKey)))
    throw new HostedConfigurationError("LIVE_PROVIDER_REQUIRED", "Live generation requires provider access, writing access and a spending limit.");
  if (liveGeneration) {
    try {
      writingLimits();
    } catch {
      throw new HostedConfigurationError("WRITING_LIMITS_REQUIRED", "Daily writing limits are not configured.");
    }
  }
}
