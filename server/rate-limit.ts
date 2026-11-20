import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { ipKeyGenerator } from "express-rate-limit";
import type { Options, Store, IncrementResponse } from "express-rate-limit";
import type { Queryable } from "./db.js";

export function clientRateLimitKey(req: {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
}) {
  const forwarded = req.headers["x-vercel-forwarded-for"];
  // Vercel overwrites this header. Never trust arbitrary forwarding headers on
  // a local/non-Vercel server, or accept multi-hop strings as a client identity.
  const address = process.env.VERCEL === "1" && typeof forwarded === "string" && isIP(forwarded)
    ? forwarded : req.socket.remoteAddress || "unknown";
  return ipKeyGenerator(address);
}

/** Shared counters use the database clock, including across cold starts. */
export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 0;

  constructor(private readonly db: Queryable, namespace: string) {
    if (!/^[a-z][a-z0-9:_-]{0,63}$/.test(namespace)) throw new Error("Invalid rate-limit namespace.");
    this.prefix = namespace + ":";
  }

  init(options: Pick<Options, "windowMs">) {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0)
      throw new Error("Invalid rate-limit window.");
    this.windowMs = options.windowMs;
  }

  private bucketKey(key: string) {
    // Pseudonymous storage: never retain the raw address/email in a counter.
    return createHash("sha256").update(this.prefix).update("\0").update(key).digest("hex");
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (!this.windowMs) throw new Error("Rate-limit store was not initialized.");
    // Lock our bucket before cleanup, then skip other active bucket locks. The
    // dependency on updated prevents competing cleanup/upsert lock inversions.
    const result = await this.db.query<{ hits: number; expires_at: Date | string }>(`
      WITH updated AS (
        INSERT INTO rate_limit_buckets (bucket_key, hits, expires_at)
        VALUES ($1, 1, statement_timestamp() + $2 * interval '1 millisecond')
        ON CONFLICT (bucket_key) DO UPDATE SET
          hits = CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp() THEN 1
            ELSE LEAST(rate_limit_buckets.hits::bigint + 1, 2147483647)::integer END,
          expires_at = CASE WHEN rate_limit_buckets.expires_at <= statement_timestamp()
            THEN statement_timestamp() + $2 * interval '1 millisecond'
            ELSE rate_limit_buckets.expires_at END
        RETURNING hits, expires_at
      ), expired AS MATERIALIZED (
        SELECT bucket_key FROM rate_limit_buckets
        WHERE expires_at <= statement_timestamp() AND bucket_key <> $1
          AND EXISTS (SELECT 1 FROM updated)
        ORDER BY expires_at LIMIT 64 FOR UPDATE SKIP LOCKED
      ), cleanup AS (
        DELETE FROM rate_limit_buckets b USING expired e WHERE b.bucket_key = e.bucket_key
      )
      SELECT hits, expires_at FROM updated
    `, [this.bucketKey(key), this.windowMs]);
    const row = result.rows[0];
    if (!row) throw new Error("Rate-limit counter unavailable.");
    return { totalHits: row.hits, resetTime: new Date(row.expires_at) };
  }

  async decrement(key: string) {
    await this.db.query(`UPDATE rate_limit_buckets SET hits = GREATEST(0, hits - 1)
      WHERE bucket_key = $1 AND expires_at > statement_timestamp()`, [this.bucketKey(key)]);
  }

  async resetKey(key: string) {
    await this.db.query("DELETE FROM rate_limit_buckets WHERE bucket_key = $1", [this.bucketKey(key)]);
  }
}
