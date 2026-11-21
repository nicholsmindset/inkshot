import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from '../server/db.js';
import { createOpsStatusHandler, deliverOpsAlerts, readOpsMetrics, reportOpsAlert } from '../server/ops.js';
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
  assert.equal(body.reconciliationRequiredJobs, null);
  assert.equal(body.spendBlockedWorkspaces, null);
  assert.equal(logs.length, 1); assert.equal(JSON.parse(logs[0]).event, 'inkshot_service_unavailable');
  for (const secret of ['sensitive-password', 'sensitive-supabase-key', 'ops-secret-fixture'])
    assert(!JSON.stringify([body, logs]).includes(secret));
});

test('terminal provider reconciliation and payment holds remain unhealthy until resolved, with aggregate-only alerts', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const local = new PGlite(); t.after(() => local.close());
  await local.exec(`CREATE TABLE jobs(state text, created_at timestamptz, checkpoint jsonb);
    CREATE TABLE payment_events(created_at timestamptz);
    CREATE TABLE billing_accounts(workspace_id text, spend_blocked boolean, spend_block_reason text);
    INSERT INTO jobs VALUES
      ('failed',now(),'{"reconciliationRequired":true,"videoId":"private-provider-id"}'),
      ('done',now(),'{"reconciliationRequired":false}'),
      ('queued',now(),'{}');
    INSERT INTO billing_accounts VALUES
      ('private-held-workspace',true,'private-dispute-detail'),
      ('private-clear-workspace',false,NULL);`);
  const db: Database = { query: (s,p) => local.query(s,p), transaction: fn => local.transaction(tx => fn(tx)), close: () => local.close() };
  const handler = createOpsStatusHandler(async () => db);
  const first = request('Bearer ops-secret-fixture'); await handler(first.req,first.res);
  const body = JSON.parse(first.response.body);
  assert.equal(first.response.statusCode,503);
  assert.equal(body.databaseReachable,true);
  assert.equal(body.queuedOver15Minutes,0);
  assert.equal(body.processingOver15Minutes,0);
  assert.equal(body.reconciliationRequiredJobs,1);
  assert.equal(body.spendBlockedWorkspaces,1);
  assert.deepEqual(logs.map(line => { const {event,count}=JSON.parse(line); return {event,count}; }), [
    { event:'inkshot_provider_reconciliation_required',count:1 },
    { event:'inkshot_payment_review_required',count:1 },
  ]);
  assert(!JSON.stringify([body,logs]).includes('private-'));
  await local.exec("UPDATE jobs SET checkpoint='{}'; UPDATE billing_accounts SET spend_blocked=false");
  logs.length=0;
  const recovered=request('Bearer ops-secret-fixture'); await handler(recovered.req,recovered.res);
  assert.equal(recovered.response.statusCode,200);
  assert.equal(JSON.parse(recovered.response.body).reconciliationRequiredJobs,0);
  assert.equal(JSON.parse(recovered.response.body).spendBlockedWorkspaces,0);
  assert.equal(logs.length,0);
});

test('real PostgreSQL metrics distinguish old pending work, completed work and no Stripe history', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const local = new PGlite(); t.after(() => local.close());
  await local.exec(`CREATE TABLE jobs(state text, created_at timestamptz, checkpoint jsonb DEFAULT '{}');
    CREATE TABLE billing_accounts(spend_blocked boolean DEFAULT false);
    CREATE TABLE payment_events(created_at timestamptz);
    INSERT INTO jobs(state,created_at) VALUES ('queued',now()-interval '16 minutes'),('queued',now()),
    ('processing',now()-interval '20 minutes'),('done',now()-interval '1 day'),('failed',now()-interval '1 day');`);
  const db: Database = { query: (sql, params) => local.query(sql, params),
    transaction: fn => local.transaction(tx => fn(tx)), close: () => local.close() };
  assert.deepEqual(await readOpsMetrics(db), { deletion: { available: false }, queuedOver15Minutes: 1, processingOver15Minutes: 1, reconciliationRequiredJobs: 0, spendBlockedWorkspaces: 0, lastStripeEventAgeSeconds: null, provider: { enabled: false, actualChargeReconciliationSupported: false } });
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


test('a hung database initializer returns a safe failure within the status deadline', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const handler = createOpsStatusHandler(() => new Promise<Database>(() => {}), 10);
  const r = request('Bearer ops-secret-fixture');
  const started = Date.now(); await handler(r.req, r.res);
  assert(Date.now() - started < 1000);
  assert.equal(r.response.statusCode, 503);
  assert.equal(JSON.parse(r.response.body).databaseReachable, false);
  assert.equal(JSON.parse(logs[0]).event, 'inkshot_service_unavailable');
  assert(!r.response.body.includes('ops-secret-fixture'));
});


test('deletion retries and overdue requests degrade ops status without exposing identities', async t => {
  environment(t, { CRON_SECRET: 'ops-secret-fixture', OPS_ALERTS_ENABLED: 'true' });
  const logs: string[] = []; t.mock.method(console, 'error', (value: string) => logs.push(value));
  const local = new PGlite(); t.after(() => local.close());
  await local.exec(`CREATE TABLE jobs(state text, created_at timestamptz, checkpoint jsonb DEFAULT '{}');
    CREATE TABLE billing_accounts(spend_blocked boolean DEFAULT false);
    CREATE TABLE payment_events(created_at timestamptz);
    CREATE TABLE account_deletions(state text, error_code text, created_at timestamptz, workspace_id text);
    INSERT INTO account_deletions VALUES
      ('pending',NULL,now()-interval '5 minutes','private-draining'),
      ('deleting','DELETION_STORAGE_RETRY',now()-interval '20 minutes','private-retrying'),
      ('deleting',NULL,now()-interval '35 minutes','private-overdue'),
      ('complete','OLD_ERROR',now()-interval '1 day','private-completed');`);
  const db: Database = { query: (s,p) => local.query(s,p), transaction: fn => local.transaction(tx => fn(tx)), close: () => local.close() };
  const handler = createOpsStatusHandler(async () => db);
  const response = request('Bearer ops-secret-fixture'); await handler(response.req, response.res);
  const body = JSON.parse(response.response.body);
  assert.equal(response.response.statusCode,503);
  assert.deepEqual({ ...body.deletion, oldestPendingAgeSeconds: undefined }, { available:true,pending:3,retrying:1,overdue:1,oldestPendingAgeSeconds:undefined });
  assert(body.deletion.oldestPendingAgeSeconds >= 2100 && body.deletion.oldestPendingAgeSeconds < 2110);
  assert.equal(JSON.parse(logs[0]).event,'inkshot_deletions_stuck');
  assert.equal(JSON.parse(logs[0]).count,1);
  assert(!JSON.stringify([body,logs]).includes('private-'));
  assert(!JSON.stringify(body).includes('DELETION_STORAGE_RETRY'));
  await local.exec("UPDATE account_deletions SET state='complete' WHERE state='deleting'");
  const draining = request('Bearer ops-secret-fixture'); await handler(draining.req,draining.res);
  assert.equal(draining.response.statusCode,200,'Normal 15-minute drain must not be an outage');
  await local.exec("UPDATE account_deletions SET state='complete'");
  const done = await readOpsMetrics(db);
  assert.deepEqual(done.deletion,{available:true,pending:0,retrying:0,overdue:0,oldestPendingAgeSeconds:null});
});

test('optional alert transport awaits delivery, deduplicates across probes and sends only allowlisted aggregates', async t => {
  environment(t,{OPS_ALERTS_ENABLED:'true',OPS_ALERT_WEBHOOK_URL:'https://alerts.example.test/receive',OPS_ALERT_WEBHOOK_SECRET:'private-receiver-token'});
  const local=new PGlite(); t.after(()=>local.close());
  await local.exec('CREATE TABLE rate_limit_buckets(bucket_key text PRIMARY KEY,hits integer,expires_at timestamptz)');
  const db:Database={query:(s,p)=>local.query(s,p),transaction:fn=>local.transaction(tx=>fn(tx)),close:()=>local.close()};
  let release!:()=>void;
  const deliveryGate=new Promise<void>(resolve=>{release=resolve});
  const calls:{url:string;init?:RequestInit}[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    calls.push({url:String(input),init}); await deliveryGate; return new Response(null,{status:204});
  });
  const privateAlert={event:'inkshot_jobs_stuck' as const,count:2,workspaceId:'private-workspace',details:'private-customer-data'};
  let completed=false;
  const first=deliverOpsAlerts(db,[privateAlert]).then(()=>{completed=true});
  while(!calls.length) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(completed,false,'The request must await notification rather than fire and forget');
  await deliverOpsAlerts(db,[privateAlert]);
  assert.equal(calls.length,1,'Concurrent probes share the database claim');
  const call=calls[0];
  assert.equal(call.init?.redirect,'error','Never forward a receiver credential through redirects');
  assert(call.init?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(call.init?.body)),{event:'inkshot_jobs_stuck',count:2});
  assert.equal(new Headers(call.init?.headers).get('authorization'),'Bearer private-receiver-token');
  release(); await first;
  await local.exec("UPDATE rate_limit_buckets SET expires_at=now()-interval '1 second'");
  await deliverOpsAlerts(db,[privateAlert]);
  assert.equal(calls.length,2,'A continuing incident can notify again after five minutes');
});

test('failed alert transport releases its claim for retry without surfacing private receiver errors', async t => {
  environment(t,{OPS_ALERTS_ENABLED:'true',OPS_ALERT_WEBHOOK_URL:'https://alerts.example.test/private-path',OPS_ALERT_WEBHOOK_SECRET:undefined});
  const local=new PGlite(); t.after(()=>local.close());
  await local.exec('CREATE TABLE rate_limit_buckets(bucket_key text PRIMARY KEY,hits integer,expires_at timestamptz)');
  const db:Database={query:(s,p)=>local.query(s,p),transaction:fn=>local.transaction(tx=>fn(tx)),close:()=>local.close()};
  const logs:string[]=[]; t.mock.method(console,'error',(value:string)=>logs.push(value));
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++; if(calls===1)throw new Error('private-receiver-error');return new Response(null,{status:204});});
  const alerts=[{event:'inkshot_payment_review_required' as const,count:1}];
  await deliverOpsAlerts(db,alerts);
  assert.equal((await local.query('SELECT * FROM rate_limit_buckets')).rows.length,0);
  await deliverOpsAlerts(db,alerts);
  assert.equal(calls,2); assert.deepEqual(logs,[]);
});

test('alert transport is off unless configured and rejects insecure or credential-bearing destinations', async t => {
  environment(t,{OPS_ALERTS_ENABLED:'true',OPS_ALERT_WEBHOOK_URL:undefined});
  let calls=0; t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:204});});
  for (const url of ['', 'http://alerts.example.test', 'https://user:password@alerts.example.test', 'https://alerts.example.test/#secret', 'not-a-url']) {
    process.env.OPS_ALERT_WEBHOOK_URL=url;
    await deliverOpsAlerts(undefined,[{event:'inkshot_service_unavailable'}]);
  }
  process.env.OPS_ALERT_WEBHOOK_URL='https://alerts.example.test';process.env.OPS_ALERTS_ENABLED='false';
  await deliverOpsAlerts(undefined,[{event:'inkshot_service_unavailable'}]);
  assert.equal(calls,0);
});

test('a stalled alert receiver is aborted before it can hold the worker indefinitely', async t => {
  environment(t,{OPS_ALERTS_ENABLED:'true',OPS_ALERT_WEBHOOK_URL:'https://alerts.example.test/slow',OPS_ALERT_WEBHOOK_SECRET:undefined});
  let aborted=false;
  t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
    const fallback=setTimeout(()=>reject(new Error('Unbounded notification')),4500);
    init!.signal!.addEventListener('abort',()=>{aborted=true;clearTimeout(fallback);reject(new Error('Request aborted'));},{once:true});
  }));
  const started=Date.now();
  await deliverOpsAlerts(undefined,[{event:'inkshot_worker_failed'}]);
  assert(aborted);assert(Date.now()-started<4000);
});
