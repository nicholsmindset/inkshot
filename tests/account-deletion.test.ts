import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Database } from '../server/db.js';
import { requestDeletion, runDeletionOnce, rejectDeletedIdentity, type DeletionAdapters } from '../server/account-deletion.js';

async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const pg=new PGlite();t.after(()=>pg.close());
 await pg.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
 const db:Database={query:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn(tx)),close:()=>pg.close()};
 await pg.exec("INSERT INTO workspaces(id) VALUES('own'),('other');INSERT INTO users(id,workspace_id,name,email,password_hash) VALUES('u','own','Owner','owner@example.invalid','mock'),('v','other','Other','other@example.invalid','mock');");
 return {pg,db,user:{id:'u',workspaceId:'own',name:'Owner',email:'owner@example.invalid',demo:false}};
}
function flags(t:{after:(fn:()=>void)=>void}){
 const saved={...process.env};process.env.ENABLE_ACCOUNT_DELETION='true';process.env.INKSHOT_SHARED_PROJECT_LIVE='false';delete process.env.AUTH_PROVIDER;
 t.after(()=>{for(const k of ['ENABLE_ACCOUNT_DELETION','INKSHOT_SHARED_PROJECT_LIVE','AUTH_PROVIDER']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
}
const noop:DeletionAdapters={deleteProviderRequest:async()=>{},deleteWorkspaceStorage:async()=>{},deleteAuthUser:async()=>{}};

test('deletion defaults off, refuses shared ownership and active subscriptions',async t=>{
 flags(t);const {pg,db,user}=await fixture(t);
 delete process.env.ENABLE_ACCOUNT_DELETION;await assert.rejects(requestDeletion(db,user),/not enabled/);process.env.ENABLE_ACCOUNT_DELETION='true';
 process.env.INKSHOT_SHARED_PROJECT_LIVE='true';await assert.rejects(requestDeletion(db,user),/not enabled/);process.env.INKSHOT_SHARED_PROJECT_LIVE='false';
 await assert.rejects(requestDeletion(db,{...user,workspaceId:'other'}),/ownership/);
 await pg.exec("INSERT INTO billing_accounts(workspace_id,status)VALUES('own','active')");
 await assert.rejects(requestDeletion(db,user),/subscription/);
 await pg.exec("DELETE FROM billing_accounts;INSERT INTO users(id,workspace_id,name,email,password_hash)VALUES('w','own','Team','team@example.invalid','mock')");
 await assert.rejects(requestDeletion(db,user),/ownership/);
});

test('deletion is durable, idempotent and frozen against late writes while preserving another workspace',async t=>{
 flags(t);const {pg,db,user}=await fixture(t);
 await pg.exec("INSERT INTO uploads(id,workspace_id,file_path)VALUES('a','own','private'),('b','other','other-private')");
 const first=await requestDeletion(db,user),second=await requestDeletion(db,user);assert.equal(first.id,second.id);
 await assert.rejects(pg.exec("INSERT INTO uploads(id,workspace_id,file_path)VALUES('late','own','private')"),/deletion is pending/);
 await assert.rejects(rejectDeletedIdentity(db,user.id),/deletion has been requested/);
 assert.equal(await runDeletionOnce(db,noop),false); // drain interval
 await pg.exec("UPDATE account_deletions SET available_at=now()-interval '1 second'");
 for(let i=0;i<4;i++)assert.equal(await runDeletionOnce(db,noop),true);
 assert.equal(await runDeletionOnce(db,noop),false);
 assert.equal((await db.query('SELECT id FROM workspaces WHERE id=$1',['own'])).rows.length,0);
 assert.equal((await db.query('SELECT id FROM users WHERE id=$1',['u'])).rows.length,0);
 assert.equal((await db.query('SELECT id FROM uploads WHERE workspace_id=$1',['other'])).rows.length,1);
 const record=(await db.query<{state:string;user_id:string|null;provider_ids:string[]}>('SELECT * FROM account_deletions')).rows[0];assert.equal(record.state,'complete');assert.equal(record.user_id,null);assert.deepEqual(record.provider_ids,[]);
 await assert.rejects(rejectDeletedIdentity(db,user.id),/deletion has been requested/);
});

test('external failure cannot complete deletion and retry resumes the saved stage',async t=>{
 flags(t);process.env.AUTH_PROVIDER='supabase';const {pg,db,user}=await fixture(t);
 const queued=await requestDeletion(db,user);await pg.exec("UPDATE account_deletions SET available_at=now()-interval '1 second',provider_ids='[\"provider-1\"]'");
 let calls=0,storage=0,auth=0;
 const adapters:DeletionAdapters={deleteProviderRequest:async()=>{calls++;if(calls===1)throw new Error('secret-token');},deleteWorkspaceStorage:async()=>{storage++;},deleteAuthUser:async()=>{auth++;if(auth===1)throw new Error('private-auth');}};
 await runDeletionOnce(db,adapters);
 let task=(await db.query<{state:string;error_code:string}>('SELECT state,error_code FROM account_deletions WHERE id=$1',[queued.id])).rows[0];
 assert.equal(task.state,'deleting');assert.equal(task.error_code,'DELETION_PROVIDER_RETRY');assert.equal(storage,0);
 await pg.exec('UPDATE account_deletions SET available_at=now()');await runDeletionOnce(db,adapters);await runDeletionOnce(db,adapters);await runDeletionOnce(db,adapters);
 task=(await db.query<{state:string;error_code:string}>('SELECT state,error_code FROM account_deletions')).rows[0];assert.equal(task.state,'deleting');assert.equal(task.error_code,'DELETION_IDENTITY_RETRY');
 assert.equal((await db.query('SELECT id FROM users WHERE id=$1',['u'])).rows.length,1);
 await pg.exec('UPDATE account_deletions SET available_at=now()');await runDeletionOnce(db,adapters);await runDeletionOnce(db,adapters);
 assert.equal(calls,2);assert.equal(storage,1);assert.equal(auth,2);
 assert.equal((await db.query<{state:string}>('SELECT state FROM account_deletions')).rows[0].state,'complete');
});

test('HTTP deletion requires authenticated same-origin explicit confirmation and rejects spoofed workspace IDs',async t=>{
 flags(t);const {pg,db,user}=await fixture(t);
 const {createApp}=await import('../server/app.js');const {tokenHash}=await import('../server/auth.js');const {config}=await import('../server/config.js');
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>((r,e)=>server.close(err=>err?e(err):r())));
 const address=server.address();assert(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
 await pg.query("INSERT INTO sessions(token_hash,user_id,expires_at)VALUES($1,'u',now()+interval '1 hour')",[tokenHash('test-token')]);
 const call=(cookie:string,origin:string,confirmation:string)=>fetch(base+'/api/account/deletion',{method:'POST',headers:{'content-type':'application/json',cookie,origin},body:JSON.stringify({confirmation,workspaceId:'other'})});
 assert.equal((await call('',config.origin,'DELETE MY ACCOUNT')).status,401);
 assert.equal((await call('inkshot_session=test-token','https://attacker.invalid','DELETE MY ACCOUNT')).status,403);
 assert.equal((await call('inkshot_session=test-token',config.origin,'delete')).status,400);
 const response=await call('inkshot_session=test-token',config.origin,'DELETE MY ACCOUNT');assert.equal(response.status,202);
 const saved=(await db.query<{workspace_id:string}>('SELECT workspace_id FROM account_deletions')).rows;assert.deepEqual(saved,[{workspace_id:user.workspaceId}]);
 assert.equal((await fetch(base+'/api/studio',{headers:{cookie:'inkshot_session=test-token'}})).status,410);
 assert.equal((await call('inkshot_session=test-token',config.origin,'DELETE MY ACCOUNT')).status,202);
});

test('new export and provider-event records are included without crossing workspace boundaries',async t=>{
 flags(t);const {pg,db,user}=await fixture(t);
 await pg.exec(`INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES('c-own','own','Own','Goal','[]','{}',true),('c-other','other','Other','Goal','[]','{}',true);
 INSERT INTO campaign_exports(id,workspace_id,campaign_id,category,fingerprint,manifest,state) VALUES('export-own','own','c-own','all','one','[]','queued'),('export-other','other','c-other','all','two','[]','ready');
 INSERT INTO provider_events(webhook_id,request_id,status,body_hash) VALUES('evt-own','provider-own','completed','own'),('evt-other','provider-other','completed','other');`);
 await assert.rejects(requestDeletion(db,user),/downloads/);
 await pg.exec("UPDATE campaign_exports SET state='ready'");
 // Apply the idempotent migration after the optional archive table is installed.
 await pg.exec(await readFile(new URL('../supabase/migrations/20261119210000_account_deletion.sql',import.meta.url),'utf8'));
 await requestDeletion(db,user);
 await assert.rejects(pg.exec("INSERT INTO campaign_exports(id,workspace_id,campaign_id,category,fingerprint,manifest,state) VALUES('late','own','c-own','all','late','[]','queued')"),/deletion is pending/);
 await pg.exec("UPDATE account_deletions SET available_at=now(),provider_ids='[\"provider-own\"]'");
 for(let i=0;i<4;i++)await runDeletionOnce(db,noop);
 assert.deepEqual((await db.query('SELECT id FROM campaign_exports')).rows,[{id:'export-other'}]);
 assert.deepEqual((await db.query('SELECT request_id FROM provider_events')).rows,[{request_id:'provider-other'}]);
});

test('cleanup erases workspace linkage without resetting spent provider budget',async t=>{
 flags(t);const {pg,db,user}=await fixture(t);
 await pg.exec(`INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock)VALUES('campaign','own','Private campaign','Goal','[]','{}',false);
 INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format)VALUES('asset','own','campaign','image','Image','1:1');
 INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,mock)VALUES('version','asset','own',1,'Private prompt','Headline','CTA',false);
 INSERT INTO provider_spend(request_key,input_hash,usd,provider_request_id)VALUES('version:image','private-input-hash',3.5,'request-owned');
 INSERT INTO writing_daily_usage(usage_day,scope,requests)VALUES(current_date,'global',1),(current_date,'workspace:own',1);`);
 await requestDeletion(db,user);await pg.exec('UPDATE account_deletions SET available_at=now()');
 const deleted:string[]=[];const adapters={...noop,deleteProviderRequest:async(id:string)=>{deleted.push(id);}};
 for(let i=0;i<4;i++)await runDeletionOnce(db,adapters);
 assert.deepEqual(deleted,['request-owned']);
 const spend=(await db.query<{request_key:string;input_hash:string;provider_request_id:string|null;usd:string}>('SELECT * FROM provider_spend')).rows[0];
 assert(spend.request_key.startsWith('deleted:'));assert(!spend.request_key.includes('version:image'));assert.equal(spend.input_hash,'deleted');assert.equal(spend.provider_request_id,null);assert.equal(Number(spend.usd),3.5);
 assert.deepEqual((await db.query('SELECT scope FROM writing_daily_usage')).rows,[{scope:'global'}]);
});


test('legacy checkout reconciliation permits terminal sessions only with no active subscriptions',async t=>{
 flags(t);
 for(const checkoutStatus of ['expired','complete'] as const){
  const {pg,db,user}=await fixture(t);
  await pg.exec("INSERT INTO billing_accounts(workspace_id,customer_id,subscription_id,status,checkout_id)VALUES('own','cus_owner','sub_old','canceled','cs_old')");
  const result=await requestDeletion(db,user,async(customer,id)=>{assert.equal(customer,'cus_owner');assert.equal(id,'cs_old');return {checkoutStatus,subscriptionStatuses:['canceled']};});
  assert.equal(result.state,'pending');
  assert.equal((await db.query<{checkout_id:null}>('SELECT checkout_id FROM billing_accounts')).rows[0].checkout_id,null);
 }
 for(const [checkoutStatus,subscriptionStatuses] of [['open',['canceled']],['complete',['active']],['expired',['past_due']],['complete',['incomplete']]] as const){
  const {pg,db,user}=await fixture(t);
  await pg.exec("INSERT INTO billing_accounts(workspace_id,customer_id,status,checkout_id)VALUES('own','cus_owner','canceled','cs_old')");
  await assert.rejects(requestDeletion(db,user,async()=>({checkoutStatus,subscriptionStatuses:[...subscriptionStatuses]})),/cancel your subscription/);
  assert.equal((await db.query('SELECT id FROM account_deletions')).rows.length,0);
  assert.equal((await db.query<{checkout_id:string}>('SELECT checkout_id FROM billing_accounts')).rows[0].checkout_id,'cs_old');
 }
 const {pg,db,user}=await fixture(t);
 await pg.exec("INSERT INTO billing_accounts(workspace_id,customer_id,status,checkout_id)VALUES('own','cus_owner','canceled','cs_old')");
 await assert.rejects(requestDeletion(db,user,async()=>{throw new Error('private key or Stripe outage');}),/could not be verified/);
 await assert.rejects(requestDeletion(db,user,async()=>({checkoutStatus:null,subscriptionStatuses:[]})),/needs reconciliation/);
 assert.equal((await db.query('SELECT id FROM account_deletions')).rows.length,0);
});
