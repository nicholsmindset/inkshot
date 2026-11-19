import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from './db.js';

const events = ['inkshot_service_unavailable', 'inkshot_worker_failed', 'inkshot_stripe_webhook_failed', 'inkshot_jobs_stuck'] as const;
type Event = typeof events[number];
// This deliberately accepts no error objects, messages, URLs or customer data.
export function reportOpsAlert(event: Event, details: { reference?: string; count?: number } = {}) {
  if (process.env.OPS_ALERTS_ENABLED !== 'true' || !events.includes(event)) return;
  const reference = /^[0-9a-f-]{36}$/i.test(details.reference || '') ? details.reference : randomUUID();
  const count = Number.isSafeInteger(details.count) && details.count! >= 0 ? details.count : undefined;
  try {
    console.error(JSON.stringify({ event, alert: true, reference, ...(count !== undefined && { count }) }));
  } catch { /* Reporting must never change fulfillment or request outcomes. */ }
}

export function authorizedOpsRequest(req: IncomingMessage) {
  const secret = process.env.CRON_SECRET;
  if (req.method !== 'GET' || !secret?.trim()) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.authorization || '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const settingNames = [
  'APP_ORIGIN', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'DATABASE_URL', 'CRON_SECRET',
  'BILLING_MODE', 'ENABLE_LIVE_CHECKOUT', 'STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_STUDIO_PRICE_ID', 'GENERATION_MODE', 'ALLOW_LIVE_GENERATION',
  'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'HF_DAILY_BUDGET_USD',
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'WRITING_DAILY_REQUEST_LIMIT',
  'WRITING_WORKSPACE_DAILY_REQUEST_LIMIT', 'OPS_ALERTS_ENABLED',
] as const;

export async function readOpsMetrics(db: Database) {
  return db.transaction(async tx => {
    // A blocked table must not hang a status probe indefinitely.
    await tx.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await tx.query<{ queued: number; processing: number; stripe_age: number | null }>(`
      SELECT
        (SELECT count(*)::integer FROM jobs WHERE state='queued' AND created_at < now()-interval '15 minutes') AS queued,
        (SELECT count(*)::integer FROM jobs WHERE state='processing' AND created_at < now()-interval '15 minutes') AS processing,
        (SELECT CASE WHEN max(created_at) IS NULL THEN NULL ELSE greatest(0,extract(epoch FROM now()-max(created_at)))::integer END FROM payment_events) AS stripe_age
    `);
    const row = result.rows[0];
    return { queuedOver15Minutes: row.queued, processingOver15Minutes: row.processing, lastStripeEventAgeSeconds: row.stripe_age };
  });
}

export async function monitorStuckJobs(db: Database) {
  const metrics = await readOpsMetrics(db);
  const count = metrics.queuedOver15Minutes + metrics.processingOver15Minutes;
  if (count > 0) reportOpsAlert('inkshot_jobs_stuck', { count });
  return metrics;
}

export function createOpsStatusHandler(database: () => Promise<Database>, timeoutMs = 15000) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!authorizedOpsRequest(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const settings = Object.fromEntries(settingNames.map(name => [name, Boolean(process.env[name]?.trim())]));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound initialization as well as metrics; the deadline does not cancel work.
      const metrics = await Promise.race([
        Promise.resolve().then(database).then(monitorStuckJobs),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Ops deadline exceeded")), timeoutMs); }),
      ]);
      const ok = metrics.queuedOver15Minutes + metrics.processingOver15Minutes === 0;
      res.statusCode = ok ? 200 : 503;
      res.end(JSON.stringify({ ok, settings, databaseReachable: true, ...metrics }));
    } catch {
      reportOpsAlert('inkshot_service_unavailable');
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, settings, databaseReachable: false,
        queuedOver15Minutes: null, processingOver15Minutes: null, lastStripeEventAgeSeconds: null }));
    } finally {
      clearTimeout(timer);
    }
  };
}
