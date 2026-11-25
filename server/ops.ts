import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { providerOperationsSummary } from './provider-webhooks.js';
import type { Database } from './db.js';

const events = ['inkshot_service_unavailable', 'inkshot_worker_failed', 'inkshot_stripe_webhook_failed', 'inkshot_jobs_stuck', 'inkshot_deletion_failed', 'inkshot_deletions_stuck', 'inkshot_provider_reconciliation_required', 'inkshot_payment_review_required'] as const;
type Event = typeof events[number];
type Alert = { event: Event; count?: number };
const outageNotifications = new Map<Event, number>();

// Awaited by the protected probe/worker monitor. This is a generic operator-
// configured receiver, not a promise that any external destination is installed.
export async function deliverOpsAlerts(db: Database | undefined, alerts: Alert[]) {
  if (process.env.OPS_ALERTS_ENABLED !== 'true' || !process.env.OPS_ALERT_WEBHOOK_URL?.trim()) return;
  let destination: URL;
  try {
    destination = new URL(process.env.OPS_ALERT_WEBHOOK_URL);
    if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash) return;
  } catch { return; }
  const token = process.env.OPS_ALERT_WEBHOOK_SECRET?.trim();
  // Fixed allowlist bounds request fanout and excludes arbitrary/customer data.
  const selected = [...new Map(alerts.filter(a => events.includes(a.event)).map(a => [a.event,a])).values()];
  await Promise.all(selected.map(async alert => {
    const key = `ops-alert:${alert.event}`;
    let claim: string | Date | undefined;
    const now = Date.now();
    try {
      if (db) {
        claim = await db.transaction(async tx => {
          await tx.query("SET LOCAL statement_timeout = '1000ms'");
          const result = await tx.query<{expires_at:string|Date}>(`INSERT INTO rate_limit_buckets(bucket_key,hits,expires_at)
            VALUES($1,1,now()+interval '5 minutes') ON CONFLICT(bucket_key) DO UPDATE
            SET hits=1,expires_at=EXCLUDED.expires_at WHERE rate_limit_buckets.expires_at<=now()
            RETURNING expires_at`,[key]);
          return result.rows[0]?.expires_at;
        });
        if (!claim) return;
      } else {
        // A failed DB cannot coordinate replicas. Receiver-side deduplication is
        // still required for outage alerts; this bounds a single warm instance.
        if ((outageNotifications.get(alert.event) ?? 0)>now) return;
        outageNotifications.set(alert.event,now+300_000);
      }
      const count = Number.isSafeInteger(alert.count) && alert.count! >= 0 ? alert.count : undefined;
      const response = await fetch(destination, {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(2500),
        headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},
        body:JSON.stringify({event:alert.event,...(count!==undefined && {count})}),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('Notification unavailable');
    } catch {
      // Failed delivery is retried on the next probe; never leak URL, headers,
      // response bodies or an exception into logs/customer responses.
      if (db && claim) {
        try {
          await db.transaction(async tx => {
            await tx.query("SET LOCAL statement_timeout = '1000ms'");
            await tx.query('DELETE FROM rate_limit_buckets WHERE bucket_key=$1 AND expires_at=$2',[key,claim]);
          });
        } catch { /* A held claim naturally expires after five minutes. */ }
      } else if (!db) outageNotifications.delete(alert.event);
    }
  }));
}
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
  'STRIPE_STUDIO_PRICE_ID', 'PLAN_PRICE_ID', 'PLAN_PRICES', 'STRIPE_PRICE_IDS', 'DEFAULT_MARKET', 'GENERATION_PAUSED', 'COPY_PLATFORMS', 'COPY_MAX_RUNS_PER_PLATFORM', 'PILOT_INVITE_ONLY', 'PLAN_CURRENCY', 'PLAN_PRICE_AMOUNT', 'PLAN_CREDITS', 'KIT_CREDITS', 'VIDEO_REGEN_MONTHLY_CAP', 'GENERATION_MODE', 'ALLOW_LIVE_GENERATION',
  'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'HF_DAILY_BUDGET_USD',
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'WRITING_DAILY_REQUEST_LIMIT',
  'WRITING_WORKSPACE_DAILY_REQUEST_LIMIT', 'OPS_ALERTS_ENABLED', 'OPS_ALERT_WEBHOOK_URL', 'OPS_ALERT_WEBHOOK_SECRET', 'ENABLE_EXPORT_REVIEW', 'ENABLE_ACCOUNT_DELETION', 'HF_WEBHOOKS_ENABLED', 'HF_WEBHOOK_SECRET',
] as const;

export async function readOpsMetrics(db: Database) {
  return db.transaction(async tx => {
    // A blocked table must not hang a status probe indefinitely.
    await tx.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await tx.query<{ queued: number; processing: number; reconciliation: number; spend_blocked: number; stripe_age: number | null }>(`
      SELECT
        (SELECT count(*)::integer FROM jobs WHERE state='queued' AND created_at < now()-interval '15 minutes') AS queued,
        (SELECT count(*)::integer FROM jobs WHERE state='processing' AND created_at < now()-interval '15 minutes') AS processing,
        (SELECT count(*)::integer FROM jobs WHERE checkpoint->>'reconciliationRequired'='true') AS reconciliation,
        (SELECT count(*)::integer FROM billing_accounts WHERE spend_blocked=true) AS spend_blocked,
        (SELECT CASE WHEN max(created_at) IS NULL THEN NULL ELSE greatest(0,extract(epoch FROM now()-max(created_at)))::integer END FROM payment_events) AS stripe_age
    `);
    const row = result.rows[0];
    const deletionTable = (await tx.query<{ present: boolean }>("SELECT to_regclass('account_deletions') IS NOT NULL AS present")).rows[0].present;
    let deletion: { available: boolean; pending?: number; retrying?: number; overdue?: number; oldestPendingAgeSeconds?: number | null } = { available: false };
    if (deletionTable) {
      const counts = (await tx.query<{ pending: number; retrying: number; overdue: number; oldest: number | null }>(`
        SELECT count(*)::integer AS pending,
          count(*) FILTER(WHERE error_code IS NOT NULL)::integer AS retrying,
          count(*) FILTER(WHERE created_at < now()-interval '30 minutes')::integer AS overdue,
          CASE WHEN min(created_at) IS NULL THEN NULL ELSE greatest(0,extract(epoch FROM now()-min(created_at)))::integer END AS oldest
        FROM account_deletions WHERE state<>'complete'`)).rows[0];
      // Aggregate only: never expose workspace, user, provider IDs or error text.
      deletion = { available: true, pending: counts.pending, retrying: counts.retrying, overdue: counts.overdue, oldestPendingAgeSeconds: counts.oldest };
    }
    return { deletion, queuedOver15Minutes: row.queued, processingOver15Minutes: row.processing,
      reconciliationRequiredJobs: row.reconciliation, spendBlockedWorkspaces: row.spend_blocked,
      lastStripeEventAgeSeconds: row.stripe_age, provider: await providerOperationsSummary(tx) };
  });
}

export async function monitorStuckJobs(db: Database) {
  const metrics = await readOpsMetrics(db);
  const alerts: Alert[] = [];
  const count = metrics.queuedOver15Minutes + metrics.processingOver15Minutes;
  if (count > 0) alerts.push({event:'inkshot_jobs_stuck',count});
  if ((metrics.deletion.overdue ?? 0) > 0) alerts.push({event:'inkshot_deletions_stuck',count:metrics.deletion.overdue});
  if (metrics.reconciliationRequiredJobs > 0) alerts.push({event:'inkshot_provider_reconciliation_required',count:metrics.reconciliationRequiredJobs});
  if (metrics.spendBlockedWorkspaces > 0) alerts.push({event:'inkshot_payment_review_required',count:metrics.spendBlockedWorkspaces});
  for (const alert of alerts) reportOpsAlert(alert.event,{count:alert.count});
  await deliverOpsAlerts(db,alerts);
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
      const ok = metrics.queuedOver15Minutes + metrics.processingOver15Minutes + metrics.reconciliationRequiredJobs + metrics.spendBlockedWorkspaces + (metrics.deletion.retrying ?? 0) + (metrics.deletion.overdue ?? 0) === 0;
      res.statusCode = ok ? 200 : 503;
      res.end(JSON.stringify({ ok, settings, databaseReachable: true, ...metrics }));
    } catch {
      reportOpsAlert('inkshot_service_unavailable');
      await deliverOpsAlerts(undefined,[{event:'inkshot_service_unavailable'}]);
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, settings, databaseReachable: false,
        queuedOver15Minutes: null, processingOver15Minutes: null, reconciliationRequiredJobs: null,
        spendBlockedWorkspaces: null, lastStripeEventAgeSeconds: null }));
    } finally {
      clearTimeout(timer);
    }
  };
}
