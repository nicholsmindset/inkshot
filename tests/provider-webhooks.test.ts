import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, type Database } from '../server/db.js';
import { config, AppError } from '../server/config.js';
import { acceptProviderWebhook, verifyProviderWebhook, wakeProviderJobs, providerWebhookUrl, providerOperationsSummary } from '../server/provider-webhooks.js';
import { submit } from '../server/higgsfield.js';
import { createApp } from '../server/app.js';
const key = Buffer.alloc(32, 9);
const secret = 'whsec_' + key.toString('base64');
function signed(body: Buffer, id = 'msg_fixture', timestamp = Math.floor(Date.now()/1000)) {
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp),
    'webhook-signature': 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64') };
}
function enabled(t: { after: (fn: () => void) => void }) {
  const values = { HF_WEBHOOKS_ENABLED: process.env.HF_WEBHOOKS_ENABLED, HF_WEBHOOK_SECRET: process.env.HF_WEBHOOK_SECRET };
  process.env.HF_WEBHOOKS_ENABLED = 'true'; process.env.HF_WEBHOOK_SECRET = secret;
  t.after(() => { for (const [key,value] of Object.entries(values)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; } });
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'inkshot-webhook-'));
  const db = await createDatabase(dir,true);
  t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
  await db.query("INSERT INTO workspaces(id) VALUES('ws')");
  await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES('kit','ws','Kit','Sales','[]','{}',true)");
  await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format) VALUES('asset','ws','kit','image','Image','4:5')");
  await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,mock) VALUES('version','asset','ws',1,'Photo','Headline','CTA',true)");
  await db.query("INSERT INTO jobs(id,version_id,workspace_id,available_at) VALUES('job','version','ws',now()+interval '1 hour')");
  return db;
}
const raw=Buffer.from('{ "request_id":"receipt", "status":"completed", "payload":{"images":[{"url":"https://untrusted.example/media.jpg"}]} }');

test('raw bytes, timestamp tolerance and every signature are verified before parsing',t=>{
  enabled(t);
  assert.equal(verifyProviderWebhook(raw,signed(raw)).event.request_id,'receipt');
  const bad=(body:Buffer,headers:ReturnType<typeof signed>)=>assert.throws(()=>verifyProviderWebhook(body,headers),e=>e instanceof AppError&&e.status===400);
  bad(Buffer.from(raw.toString().replace('receipt','different')),signed(raw));
  bad(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),signed(raw));
  bad(raw,signed(raw,'msg_old',Math.floor(Date.now()/1000)-301));
  bad(raw,signed(raw,'msg_future',Math.floor(Date.now()/1000)+302));
  bad(raw,{...signed(raw),'webhook-signature':'v1,YmFk'});
  const rotated=signed(raw);rotated['webhook-signature']='v1,YmFk '+rotated['webhook-signature'];
  assert.equal(verifyProviderWebhook(raw,rotated).event.status,'completed');
  const malformed=Buffer.from('{"status":"completed"}'); bad(malformed,signed(malformed));
});

test('durable dedupe, early receipts and job leases preserve exactly-once wakeup',async t=>{
  enabled(t);const db=await fixture(t);
  assert.deepEqual(await acceptProviderWebhook(db,raw,signed(raw)),{received:true,duplicate:false});
  assert.equal((await db.query('SELECT matched_at FROM provider_events')).rows[0].matched_at,null);
  await db.query("INSERT INTO provider_spend(request_key,input_hash,usd,provider_request_id) VALUES('version:image','hash',1,'receipt')");
  await wakeProviderJobs(db);
  assert.equal((await db.query<{ready:boolean}>("SELECT available_at<=now() AS ready FROM jobs")).rows[0].ready,true);
  await db.query("UPDATE jobs SET state='processing',available_at=now()+interval '1 hour',locked_until=now()+interval '5 minutes'");
  assert.deepEqual(await acceptProviderWebhook(db,raw,signed(raw)),{received:true,duplicate:true});
  assert.equal((await db.query('SELECT state FROM jobs')).rows[0].state,'processing');
  assert.equal((await db.query('SELECT * FROM provider_events')).rows.length,1);
  const conflict=Buffer.from('{"request_id":"other","status":"failed"}');
  await assert.rejects(acceptProviderWebhook(db,conflict,signed(conflict)),e=>e instanceof AppError&&e.status===400);
  const summary=await providerOperationsSummary(db);
  assert.equal(summary.actualChargeReconciliationSupported,false);
  assert.equal('eventsReceived' in summary && summary.eventsReceived,1);
  const stored=JSON.stringify((await db.query('SELECT * FROM provider_events')).rows);
  assert(!stored.includes('untrusted.example'));assert(!stored.includes(secret));
});

test('failed durable writes return retryable failure and disabled webhooks do no database work',async t=>{
  enabled(t);let called=0;
  const db={transaction:async()=>{called++;throw new Error('private connection');}} as unknown as Database;
  await assert.rejects(acceptProviderWebhook(db,raw,signed(raw)),e=>e instanceof AppError&&e.status===503&&!e.message.includes('private'));
  process.env.HF_WEBHOOKS_ENABLED='false';
  await assert.rejects(acceptProviderWebhook(db,raw,signed(raw)),e=>e instanceof AppError&&e.status===503);
  await wakeProviderJobs(db);assert.equal(called,1);
});

test('multi-workspace wakeup locks workspaces before touching queued jobs',async t=>{
  enabled(t);const db=await fixture(t);
  await db.query("INSERT INTO workspaces(id) VALUES('aaa')");
  await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES('kit2','aaa','Kit','Sales','[]','{}',true)");
  await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format) VALUES('asset2','aaa','kit2','image','Image','4:5')");
  await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,mock) VALUES('version2','asset2','aaa',1,'Photo','Headline','CTA',true)");
  await db.query("INSERT INTO jobs(id,version_id,workspace_id,available_at) VALUES('job2','version2','aaa',now()+interval '1 hour')");
  // Both callbacks arrive before the provider receipts are persisted.
  await acceptProviderWebhook(db,raw,signed(raw));
  const second=Buffer.from('{"request_id":"receipt2","status":"failed"}');
  await acceptProviderWebhook(db,second,signed(second,'msg_second'));
  await db.query("INSERT INTO provider_spend(request_key,input_hash,usd,provider_request_id) VALUES('version:image','hash',1,'receipt'),('version2:image','hash2',1,'receipt2')");
  const calls:{sql:string;params:unknown[]|undefined}[]=[];
  const observed={...db,transaction:async(fn:Parameters<Database['transaction']>[0])=>db.transaction(tx=>fn({
    query:async(sql:string,params?:unknown[])=>{calls.push({sql,params});return tx.query(sql,params);},
  }))} as Database;
  await wakeProviderJobs(observed);
  assert.match(calls[0].sql,/SELECT w.id FROM workspaces/);
  assert.match(calls[0].sql,/ORDER BY w.id FOR UPDATE/);
  assert.deepEqual(calls.filter(call=>call.sql.startsWith('UPDATE jobs')).map(call=>call.params),[['aaa'],['ws']]);
  assert.deepEqual((await db.query("SELECT id,available_at<=now() AS ready FROM jobs ORDER BY id")).rows,
    [{id:'job',ready:true},{id:'job2',ready:true}]);
});

test('HTTP route verifies raw JSON and bypasses customer session and cross-site checks',async t=>{
  enabled(t);const db=await fixture(t);
  const server=createApp(db).listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
  const address=server.address();assert(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/api/webhooks/higgsfield`;
  const bad=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:raw});assert.equal(bad.status,400);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...signed(raw)},body:raw});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true,duplicate:false});
});

test('submission attaches only the configured HTTPS callback and keeps polling-only mode',async t=>{
  enabled(t);const saved={...config};t.after(()=>Object.assign(config,saved));
  config.origin='https://inkshot.example';config.liveAllowed=true;config.hfKey='fixture-key';config.hfSecret='fixture-secret';
  const urls:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:URL)=>{urls.push(String(url));return new Response(JSON.stringify({request_id:'receipt',status:'queued'}));});
  await submit('model/path',{prompt:'Photo'},'stable-key');
  assert.equal(new URL(urls[0]).searchParams.get('hf_webhook'),'https://inkshot.example/api/webhooks/higgsfield');
  process.env.HF_WEBHOOKS_ENABLED='false';await submit('model/path',{prompt:'Photo'},'stable-key-2');
  assert.equal(new URL(urls[1]).search,'');
  process.env.HF_WEBHOOKS_ENABLED='true';config.origin='http://example.com';assert.throws(providerWebhookUrl);
});

test('webhook migration secures both schemas and can be replayed',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE inkshot_app; CREATE ROLE inkshot_live_app;
      CREATE SCHEMA inkshot_live; CREATE TABLE public.workspaces(id text); CREATE TABLE inkshot_live.workspaces(id text);
      CREATE TABLE public.provider_spend(provider_request_id text); CREATE TABLE inkshot_live.provider_spend(provider_request_id text);`);
    const sql=await readFile(new URL('../supabase/migrations/20261119200000_provider_events.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    for(const schema of ['public','inkshot_live']){
      const result=await db.query<{rls:boolean;anonymous:boolean;own:boolean;other:boolean}>(`SELECT
        (SELECT relrowsecurity FROM pg_class WHERE oid='${schema}.provider_events'::regclass) AS rls,
        has_table_privilege('anon','${schema}.provider_events','SELECT') AS anonymous,
        has_table_privilege('${schema==='public'?'inkshot_app':'inkshot_live_app'}','${schema}.provider_events','SELECT,INSERT') AS own,
        has_table_privilege('${schema==='public'?'inkshot_live_app':'inkshot_app'}','${schema}.provider_events','SELECT') AS other`);
      assert.deepEqual(result.rows[0],{rls:true,anonymous:false,own:true,other:false});
    }
  }finally{await db.close();}
});
