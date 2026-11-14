import { AppError, writingLimits } from "./config.js";
import type { Database } from "./db.js";

// Both increments commit before the paid request. A network timeout, invalid
// model response or server restart cannot return a possibly spent allowance.
export async function reserveWritingRequest(db: Database, workspaceId: string) {
  const limits = writingLimits();
  await db.transaction(async tx => {
    for (const [scope, limit] of [["global", limits.global], ["workspace:" + workspaceId, limits.workspace]] as const) {
      const result = await tx.query(
        `INSERT INTO writing_daily_usage (usage_day, scope, requests)
         VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $1, 1)
         ON CONFLICT (usage_day, scope) DO UPDATE SET requests = writing_daily_usage.requests + 1
         WHERE writing_daily_usage.requests < $2
         RETURNING requests`, [scope, limit]);
      if (!result.rows.length) throw new AppError(429, "The daily writing limit has been reached. Try again after midnight UTC.");
    }
  });
}
