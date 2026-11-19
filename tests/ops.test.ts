import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from '../server/db.js';
import { createOpsStatusHandler, readOpsMetrics, reportOpsAlert } from '../server/ops.js';
import { createHostedHandler } from '../server/hosted-handler.js';

function request(authorization?: string, method = 'GET') {
  const headers = new Map<string, string>();
  const response = { statusCode: 200, body: '',
    setHeader: (key: string, value: string) => headers.set(key, value),
    end(body: string) { this.body = body; },
  };
  return { req: { method, headers: { authorization } } as IncomingMessage,
    res: response as unknown as ServerResponse, response, headers };
}
function environment(t: { after: (fn: () => void) => void }, values: Record<string, string | undefined>) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  set(values); t.after(() => set(before));
}

test('ops authentication refuses absent, incorrect and non-GET credentials before touching the database', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture' });
  let calls = 0;
  const handler = createOpsStatusHandler(async () => { calls++; throw new Error('must not connect'); });
  for (const [credential, method] of [[undefined, 'GET'], ['Bearer wrong', 'GET'], ['Bearer ops-secret-fixture', 'POST']]) {
    const r = request(credential, method); await handler(r.req, r.res);
    assert.equal(r.response.statusCode, 401);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(JSON.parse(r.response.body), { error: 'Unauthorized' });
  }
  delete process.env.CRON_SECRET;
  const r = request('Bearer undefined'); await handler(r.req, r.res);
  assert.equal(r.response.statusCode, 401); assert.equal(calls, 0);
});

test('database outage returns boolean configuration presence and emits a safe alert immediately', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', DATABASE_URL: 'postgres://sensitive-password@host/db',
    SUPABASE_SECRET_KEY: 'sensitive-supabase-key', APP_ORIGIN: undefined, OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = [];
  t.mock.method(console, 'error', (value: string) => logs.push(value));
  const handler = createOpsStatusHandler(async () => { throw new Error(process.env.DATABASE_URL); });
  const r = request('Bearer ops-secret-fixture'); await handler(r.req, r.res);
  const body = JSON.parse(r.response.body);
  assert.equal(r.response.statusCode, 503); assert.equal(body.databaseReachable, false);
  assert.equal(body.settings.DATABASE_URL, true); assert.equal(body.settings.APP_ORIGIN, false);
  assert(Object.values(body.settings).every(value => typeof value === 'boolean'));
  assert.equal(body.lastStripeEventAgeSeconds, null);
  assert.equal(logs.length, 1); assert.equal(JSON.parse(logs[0]).event, 'inkshot_service_unavailable');
  for (const secret of ['sensitive-password', 'sensitive-supabase-key', 'ops-secret-fixture'])
    assert(!JSON.stringify([body, logs]).includes(secret));
});

test('real PostgreSQL metrics distinguish old pending work, completed work and no Stripe history', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const local = new PGlite(); t.after(() => local.close());
  await local.exec(`CREATE TABLE jobs(state text, created_at timestamptz);
    CREATE TABLE payment_events(created_at timestamptz);
    INSERT INTO jobs VALUES ('queued',now()-interval '16 minutes'),('queued',now()),
    ('processing',now()-interval '20 minutes'),('done',now()-interval '1 day'),('failed',now()-interval '1 day');`);
  const db: Database = { query: (sql, params) => local.query(sql, params),
    transaction: fn => local.transaction(tx => fn(tx)), close: () => local.close() };
  assert.deepEqual(await readOpsMetrics(db), { queuedOver15Minutes: 1, processingOver15Minutes: 1, lastStripeEventAgeSeconds: null });
  await local.exec("INSERT INTO payment_events VALUES(now()-interval '5 minutes'),(now()-interval '1 hour')");
  const handler = createOpsStatusHandler(async () => db);
  const r = request('Bearer ops-secret-fixture'); await handler(r.req, r.res);
  assert.equal(r.response.statusCode, 503);
  const body = JSON.parse(r.response.body);
  assert.equal(body.databaseReachable, true);
  assert(body.lastStripeEventAgeSeconds >= 300 && body.lastStripeEventAgeSeconds < 310);
  assert.equal(JSON.parse(logs[0]).count, 2);
  await local.exec("UPDATE jobs SET state='done'");
  const recovered = request('Bearer ops-secret-fixture'); await handler(recovered.req, recovered.res);
  assert.equal(recovered.response.statusCode, 200); assert.equal(JSON.parse(recovered.response.body).ok, true);
});

test('alert flag defaults off and extra diagnostic fields cannot leak into enabled alerts', t => {
  environment(t, { OPS_ALERTS_ENABLED: undefined });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  reportOpsAlert('inkshot_worker_failed'); assert.equal(logs.length, 0);
  process.env.OPS_ALERTS_ENABLED = 'true';
  const untrusted = { reference: 'private-token', count: 3, message: 'private-token' };
  reportOpsAlert('inkshot_worker_failed', untrusted);
  assert(!logs[0].includes('private-token')); assert.equal(JSON.parse(logs[0]).count, 3);
});

test('startup failures retain the customer reference and produce an alert when enabled', async t => {
  environment(t, { OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const handler = createHostedHandler({ assertConfiguration: () => {}, database: async () => { throw new Error('private-db-password'); },
    createApp: () => { throw new Error('unreachable'); } });
  const r = request(); await handler(r.req, r.res);
  const alert = logs.map(value => JSON.parse(value)).find(value => value.alert);
  assert.equal(alert.reference, JSON.parse(r.response.body).reference);
  assert(!logs.join('').includes('private-db-password'));
});


test('hosted catch-all routes status before the application startup guard', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', AUTH_PROVIDER: undefined, DATABASE_URL: undefined });
  const { default: handler } = await import('../api/[...path].js');
  const denied = request('Bearer wrong'); denied.req.url = '/api/ops/status';
  await handler(denied.req, denied.res);
  assert.equal(denied.response.statusCode, 401);
  const allowed = request('Bearer ops-secret-fixture'); allowed.req.url = '/api/ops/status?probe=1';
  await handler(allowed.req, allowed.res);
  assert.equal(allowed.response.statusCode, 503);
  const body = JSON.parse(allowed.response.body);
  assert.equal(body.settings.DATABASE_URL, false);
  assert.equal(body.databaseReachable, false);
  assert(!allowed.response.body.includes('ops-secret-fixture'));
});
