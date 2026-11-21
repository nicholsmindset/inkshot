import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, type Database, type Queryable } from '../server/db.js';
import { config } from '../server/config.js';
import { runWorkerOnce } from '../server/worker.js';
import { ffmpeg } from '../server/render.js';

test('worker refuses a new turn without enough invocation budget', async () => {
  const db = { query: async () => { throw new Error('Must not touch queue'); }, transaction: async () => { throw new Error('Must not claim a job'); }, close: async () => {} };
  assert.equal(await runWorkerOnce(db, Date.now() + 100), false);
});

test('claim locks workspace before the queue mutex and revalidates the same candidate', async () => {
  const previous = process.env.HF_WEBHOOKS_ENABLED;
  process.env.HF_WEBHOOKS_ENABLED = 'false';
  const statements: { sql: string; params?: unknown[] }[] = [];
  const tx: Queryable = {
    async query<T>(sql: string, params?: unknown[]) {
      statements.push({ sql, params });
      assert(!sql.includes('LOCK TABLE'), 'claims must not block child writes with a table lock');
      let rows: unknown[] = [];
      if (sql.startsWith('SELECT * FROM jobs WHERE (state=')) rows = [{ id: 'candidate', workspace_id: 'workspace' }];
      if (sql.includes('count(*)')) rows = [{ n: '0' }];
      // The candidate changed eligibility while this worker waited for its locks.
      if (sql.startsWith('SELECT * FROM jobs WHERE id=')) {
        assert.deepEqual(params, ['candidate']);
        assert(sql.includes("available_at<=now()") && sql.includes("locked_until<now()"));
        assert(statements.findIndex(q => q.sql.includes('FROM workspaces')) < statements.findIndex(q => q.sql.includes('pg_advisory_xact_lock')));
        assert(statements.findIndex(q => q.sql.includes('pg_advisory_xact_lock')) < statements.findIndex(q => q.sql.includes('count(*)')));
      }
      assert(!sql.startsWith('UPDATE jobs'), 'an ineligible candidate must not be claimed');
      return { rows: rows as T[] };
    },
  };
  const db: Database = { ...tx, transaction: fn => fn(tx), close: async () => {} };
  try {
    assert.equal(await runWorkerOnce(db, Date.now() + 60_000), false);
    assert(statements.some(q => q.sql.startsWith('SELECT * FROM jobs WHERE id=')));
  } finally {
    if (previous === undefined) delete process.env.HF_WEBHOOKS_ENABLED;
    else process.env.HF_WEBHOOKS_ENABLED = previous;
  }
});

test('render cancellation kills the subprocess promptly', async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = process.execPath;
  const controller = new AbortController();
  const started = Date.now();
  const promise = ffmpeg(['-e', 'setInterval(() => {}, 1000)'], controller.signal);
  setTimeout(() => controller.abort(), 30);
  try { await assert.rejects(promise); assert(Date.now() - started < 5000); }
  finally { if (previous === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previous; }
});

test('aged provider work resolves once, expired ambiguous photos never resubmit, fresh intents refresh and cloud temp files are removed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-worker-lifecycle-'));
  const db = await createDatabase(dir, true);
  const oldConfig = { dataDir: config.dataDir, liveAllowed: config.liveAllowed, hfKey: config.hfKey, hfSecret: config.hfSecret };
  const oldEnv = Object.fromEntries(['STORAGE_PROVIDER','SUPABASE_URL','SUPABASE_SECRET_KEY','HF_DAILY_BUDGET_USD'].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  Object.assign(config, { dataDir: dir, liveAllowed: true, hfKey: 'fixture', hfSecret: 'fixture' });
  Object.assign(process.env, { STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SECRET_KEY: 'fixture-secret', HF_DAILY_BUDGET_USD: '20' });
  const calls: {url:string; body:unknown}[] = [];
  let stealLeaseFor: string | undefined;
  globalThis.fetch = async (url, init) => {
    const value = String(url); const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({url:value, body});
    if (stealLeaseFor && value.includes('/storage/v1/object/')) {
      await db.query("UPDATE jobs SET locked_until=locked_until+interval '1 minute' WHERE id=$1", [stealLeaseFor]);
      stealLeaseFor = undefined;
    }
    if (value.includes('/storage/v1/object/sign/')) return new Response(JSON.stringify({signedURL:'/object/sign/brand-uploads/ws/photo.jpg?token=fresh'}), {status:200,headers:{'content-type':'application/json'}});
    if (value.includes('/storage/v1/object/')) return new Response(JSON.stringify({Key:'saved'}), {status:200,headers:{'content-type':'application/json'}});
    if (value.includes('/estimate/')) return new Response(JSON.stringify({usd:'1',credits:'1'}), {status:200});
    if (value.endsWith('/status')) return new Response(JSON.stringify({request_id:'known',status:'in_progress'}), {status:200});
    if (value.startsWith('https://api.higgsfield.ai/')) return new Response(JSON.stringify({request_id:'fresh-receipt',status:'queued'}), {status:200});
    throw new Error('Unexpected external request');
  };
  async function fixture(id:string, options:{photo?:boolean;old?:boolean;checkpoint?:object;mock?:boolean}={}) {
    const brand = {name:'Fixture', description:'A fixture product', ...(options.photo ? {photoId:'photo'} : {})};
    await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,status,concepts,brand,mock) VALUES($1,'ws','Fixture','Sales','generating','[]',$2,$3)", [id,JSON.stringify(brand),options.mock??false]);
    await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,current_version_id) VALUES($1,'ws',$1,$2,'Fixture','4:5',$1)",[id,options.photo?'video':'image']);
    await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,credit_cost,mock) VALUES($1,$1,'ws',1,'A calm scene','Quiet moment','Explore',10,$2)",[id,options.mock??false]);
    await db.query("INSERT INTO jobs(id,version_id,workspace_id,checkpoint,created_at) VALUES($1,$1,'ws',$2,now()-($3 * interval '1 minute'))",[id,JSON.stringify(options.checkpoint??{}),options.old?31:0]);
  }
  try {
    await db.query("INSERT INTO workspaces(id,credits) VALUES('ws',90)");
    await db.query("INSERT INTO uploads(id,workspace_id,file_path) VALUES('photo','ws','supabase://brand-uploads/ws/photo.jpg')");
    await fixture('aged',{old:true,checkpoint:{imageId:'provider-old'}});
    assert(await runWorkerOnce(db));
    assert.equal(calls.length,0,'expired job does not resubmit or poll');
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='aged'")).rows[0].state,'failed');
    assert.equal((await db.query("SELECT credits FROM workspaces WHERE id='ws'")).rows[0].credits,100);
    assert.equal((await db.query<{checkpoint:{reconciliationRequired:boolean}}>("SELECT checkpoint FROM jobs WHERE id='aged'")).rows[0].checkpoint.reconciliationRequired,true);
    assert.equal(await runWorkerOnce(db),false);
    assert.equal((await db.query("SELECT id FROM ledger WHERE kind='refund'")).rows.length,1);

    await fixture('ambiguous',{photo:true,checkpoint:{firstFrameUrl:'https://fixture.supabase.co/expired',firstFrameExpiresAt:Date.now()-1000}});
    await db.query("INSERT INTO provider_spend(request_key,input_hash,usd) VALUES('ambiguous:video','fixture',1)");
    assert(await runWorkerOnce(db));
    assert.equal(calls.length,0,'ambiguous paid intent must not get a changed URL or second submission');
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='ambiguous'")).rows[0].state,'failed');

    await fixture('fresh',{photo:true,checkpoint:{firstFrameUrl:'https://fixture.supabase.co/expired',firstFrameExpiresAt:Date.now()-1000}});
    assert(await runWorkerOnce(db));
    const submission = calls.find(c=>c.url.includes('/image-to-video') && !c.url.includes('/estimate/'));
    assert(submission);
    assert(String((submission.body as {image_url:string}).image_url).includes('token=fresh'));
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='fresh'")).rows[0].state,'queued');
    assert.deepEqual(await readdir(path.join(dir,'jobs')),[],'pending provider turn cleans its temp directory');
    await db.query("UPDATE jobs SET available_at=now()+interval '1 hour' WHERE id='fresh'");

    calls.length=0;
    await fixture('known',{photo:true,checkpoint:{firstFrameUrl:'https://fixture.supabase.co/expired',firstFrameExpiresAt:Date.now()-1000}});
    await db.query("INSERT INTO provider_spend(request_key,input_hash,usd,provider_request_id) VALUES('known:video','fixture',1,'accepted-receipt')");
    assert(await runWorkerOnce(db));
    assert.equal(calls.length,1);
    assert(calls[0].url.includes('/accepted-receipt/status'),'known receipt resumes polling without re-sign/submit');
    await db.query("UPDATE jobs SET available_at=now()+interval '1 hour' WHERE id='known'");

    calls.length=0;
    await fixture('cloud-render',{mock:true});
    assert(await runWorkerOnce(db));
    const version = (await db.query<{status:string;file_path:string}>("SELECT status,file_path FROM versions WHERE id='cloud-render'")).rows[0];
    assert.equal(version.status,'ready');
    assert(version.file_path.startsWith('supabase://generated-media/ws/'));
    assert.deepEqual(await readdir(path.join(dir,'jobs')),[],'successful cloud render leaves no private temp material');

    // Sustained creative backlog cannot indefinitely defer an old archive.
    await fixture('backlog',{mock:true});
    for (const id of ['archive-one','archive-two']) await db.query(
      "INSERT INTO campaign_exports(id,workspace_id,campaign_id,category,fingerprint,manifest,created_at) VALUES($1,'ws','cloud-render','all',$1,$2,now()-interval '2 minutes')",
      [id,JSON.stringify({entries:[]})],
    );
    assert(await runWorkerOnce(db));
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='backlog'")).rows[0].state,'queued');
    assert.equal((await db.query("SELECT id FROM campaign_exports WHERE state='ready'")).rows.length,1);
    assert(await runWorkerOnce(db));
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='backlog'")).rows[0].state,'done','creative work gets the turn after an overdue archive');
    assert.equal((await db.query("SELECT id FROM campaign_exports WHERE state='ready'")).rows.length,1);
    await db.query("UPDATE campaign_exports SET available_at=now()+interval '1 hour' WHERE state='queued'");
    await fixture('stolen-lease',{mock:true});
    stealLeaseFor = 'stolen-lease';
    assert(await runWorkerOnce(db));
    assert.equal((await db.query("SELECT status FROM versions WHERE id='stolen-lease'")).rows[0].status,'making','stale worker cannot commit rendering/completion after lease is replaced');
    assert.equal((await db.query("SELECT state FROM jobs WHERE id='stolen-lease'")).rows[0].state,'processing','stale worker cannot requeue the newer lease');
  } finally {
    globalThis.fetch=originalFetch; Object.assign(config,oldConfig);
    for(const [key,value] of Object.entries(oldEnv)) if(value===undefined) delete process.env[key]; else process.env[key]=value;
    await db.close(); await rm(dir,{recursive:true,force:true});
  }
});
