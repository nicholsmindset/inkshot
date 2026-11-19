import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database, Queryable } from './db.js';
import { AppError, config } from './config.js';

const envelope = z.object({
  request_id: z.string().min(1).max(200),
  status: z.enum(['completed', 'failed', 'nsfw']),
  expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.unknown().optional(),
}).refine(event => event.status !== 'completed' || (event.payload != null && Object.keys(event.payload).length > 0));
type Headers = Record<string, string | string[] | undefined>;
const keyPattern = /^whsec_[A-Za-z0-9+/]+={0,2}$/;
function signingKey() {
  const secret = process.env.HF_WEBHOOK_SECRET || '';
  if (!keyPattern.test(secret)) throw new AppError(503, 'Provider webhook verification is not configured.');
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 16) throw new AppError(503, 'Provider webhook verification is not configured.');
  return key;
}
export function providerWebhookUrl() {
  if (process.env.HF_WEBHOOKS_ENABLED !== 'true') return undefined;
  signingKey();
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.origin !== config.origin)
    throw new AppError(503, 'Provider webhook origin must be an HTTPS origin.');
  return `${origin.origin}/api/webhooks/higgsfield`;
}

// Higgsfield documents this Standard Webhooks algorithm. Verify bytes, never
// parsed/re-serialized JSON. Multiple signatures support provider key rotation.
export function verifyProviderWebhook(raw: Buffer, headers: Headers, now = Date.now()) {
  const key = signingKey();
  const id = headers['webhook-id'], timestamp = headers['webhook-timestamp'], signatures = headers['webhook-signature'];
  const invalid = () => new AppError(400, 'Invalid provider webhook.');
  if (!Buffer.isBuffer(raw) || raw.length > 262144 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)
    || typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) || typeof signatures !== 'string' || signatures.length > 2048)
    throw invalid();
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) throw invalid();
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
  const valid = signatures.split(' ').some(signature => {
    if (!/^v1,[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    const supplied = Buffer.from(signature.slice(3), 'base64');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!valid) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  const result = envelope.safeParse(parsed);
  if (!result.success) throw invalid();
  return { id, event: result.data, hash: createHash('sha256').update(raw).digest('hex') };
}

async function matchEvents(tx: Queryable) {
  // The provider may deliver before its submit response is recorded locally.
  // Keep unmatched events and retry the join from the worker. Never interrupt a
  // leased job or revive a completed/refunded version.
  await tx.query(`UPDATE jobs j SET available_at=least(j.available_at,now())
    WHERE j.state='queued' AND EXISTS (
      SELECT 1 FROM provider_events e JOIN provider_spend s ON s.provider_request_id=e.request_id
      WHERE e.matched_at IS NULL AND s.request_key IN (j.version_id||':image',j.version_id||':video'))`);
  await tx.query(`UPDATE provider_events e SET matched_at=now()
    WHERE matched_at IS NULL AND EXISTS (SELECT 1 FROM provider_spend s WHERE s.provider_request_id=e.request_id)`);
}
export async function wakeProviderJobs(db: Database) {
  if (process.env.HF_WEBHOOKS_ENABLED !== 'true') return;
  await db.transaction(matchEvents);
}
export async function acceptProviderWebhook(db: Database, raw: Buffer, headers: Headers) {
  if (process.env.HF_WEBHOOKS_ENABLED !== 'true') throw new AppError(503, 'Provider webhooks are disabled.');
  const { id, event, hash } = verifyProviderWebhook(raw, headers);
  try {
    return await db.transaction(async tx => {
      await tx.query("SET LOCAL statement_timeout='2000ms'");
      const saved = await tx.query<{ webhook_id: string }>(
        `INSERT INTO provider_events(webhook_id,request_id,status,expires_at,body_hash)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(webhook_id) DO NOTHING RETURNING webhook_id`,
        [id, event.request_id, event.status, event.expires_at || null, hash]);
      if (!saved.rows.length) {
        const old = (await tx.query<{ body_hash: string }>('SELECT body_hash FROM provider_events WHERE webhook_id=$1', [id])).rows[0];
        if (old.body_hash !== hash) throw new AppError(400, 'Conflicting provider webhook.');
        return { received: true, duplicate: true };
      }
      await matchEvents(tx);
      return { received: true, duplicate: false };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Higgsfield retries 5xx; a failed durable write must never receive 2xx.
    throw new AppError(503, 'Provider webhook storage is temporarily unavailable.');
  }
}

export async function providerOperationsSummary(db: Queryable) {
  if (process.env.HF_WEBHOOKS_ENABLED !== 'true') return { enabled: false, actualChargeReconciliationSupported: false };
  const row = (await db.query<{ events: number; unmatched: number; age: number | null }>(`
    SELECT count(*)::integer AS events, count(*) FILTER(WHERE matched_at IS NULL)::integer AS unmatched,
      CASE WHEN max(received_at) IS NULL THEN NULL ELSE greatest(0,extract(epoch FROM now()-max(received_at)))::integer END AS age
    FROM provider_events`)).rows[0];
  return { enabled: true, eventsReceived: row.events, unmatchedEvents: row.unmatched,
    lastEventAgeSeconds: row.age, actualChargeReconciliationSupported: false };
}
