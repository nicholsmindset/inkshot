import "dotenv/config";
import path from "node:path";
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || "http://localhost:5173",
  dataDir: path.resolve(process.env.DATA_DIR || "data"),
  production: process.env.NODE_ENV === "production",
  mode: (process.env.GENERATION_MODE === "live" ? "live" : "mock") as
    "live" | "mock",
  liveAllowed: process.env.ALLOW_LIVE_GENERATION === "true",
  hfKey: process.env.HF_API_KEY_ID,
  hfSecret: process.env.HF_API_KEY_SECRET,
  claudeKey: process.env.ANTHROPIC_API_KEY,
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
