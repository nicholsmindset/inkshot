import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDatabase } from '../server/db.js';
import { config } from '../server/config.js';
import { runWorkerOnce } from '../server/worker.js';
import { createApp } from '../server/app.js';
import { requestCampaignExport, findCampaignExport, runExportOnce } from '../server/campaign-exports.js';
import { signedMediaUrl, SIGNED_MEDIA_TTL_SECONDS } from '../server/storage.js';

async function fixture(t: {after: (fn:()=>Promise<void>)=>void}) {
 const dir=await mkdtemp(path.join(tmpdir(),'inkshot-export-'));
 const db=await createDatabase(dir,true); const before=config.dataDir;config.dataDir=dir;
 t.after(async()=>{config.dataDir=before;await db.close();await rm(dir,{recursive:true,force:true});});
 const workspace=randomUUID(),campaign=randomUUID();
 await db.query('INSERT INTO workspaces(id) VALUES($1)',[workspace]);
 await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,mock) VALUES($1,$2,'Test','sales','[]',$3,true)",[campaign,workspace,JSON.stringify({name:'Brand',destinationUrl:'https://example.test/offer'})]);
 async function asset(kind:string,file:string,caption:string){
  const aid=randomUUID(),vid=randomUUID();
  await db.query("INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,caption,current_version_id) VALUES($1,$2,$3,$4,'Test asset','9:16',$5,$6)",[aid,workspace,campaign,kind,caption,vid]);
  await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,status,prompt,headline,cta,mock,file_path,preview_path) VALUES($1,$2,$3,1,'ready','scene','Offer','Shop',true,$4,$4)",[vid,aid,workspace,file]);
  return vid;
 }
 return {dir,db,workspace,campaign,asset};
}

test('archive requests snapshot selected versions, deduplicate and include category captions',async t=>{
 const {dir,db,workspace,campaign,asset}=await fixture(t);
 const file=path.join(dir,'photo.jpg');await writeFile(file,'photo');await asset('image',file,'Image caption');
 const missing=path.join(dir,'later.mp4');await asset('video',missing,'Video caption');
 await assert.rejects(requestCampaignExport(db,campaign,'another-workspace','all'),/not found/);
 const [one,two]=await Promise.all([requestCampaignExport(db,campaign,workspace,'image'),requestCampaignExport(db,campaign,workspace,'image')]);
 assert.equal(one.id,two.id);
 assert.equal((await db.query('SELECT id FROM campaign_exports')).rows.length,1);
 await assert.rejects(findCampaignExport(db,one.id,'another-workspace'),/not found/);
 assert.equal(await runWorkerOnce(db,Date.now()+1000),false);
 assert.equal((await findCampaignExport(db,one.id,workspace)).state,'queued');
 assert(await runWorkerOnce(db));
 const ready=await findCampaignExport(db,one.id,workspace);assert.equal(ready.state,'ready');
 const names=execFileSync('unzip',['-Z1',ready.file_path!],{encoding:'utf8'});
 assert(names.includes('-image.jpg'));assert(!names.includes('-video.mp4'));
 assert.equal(execFileSync('unzip',['-p',ready.file_path!,'captions.txt'],{encoding:'utf8'}),'Test asset\nImage caption');
 const originalVersion=one.manifest.entries[0].id;
 const assetId=(await db.query<{asset_id:string}>('SELECT asset_id FROM versions WHERE id=$1',[originalVersion])).rows[0].asset_id;
 const newer=randomUUID(),newFile=path.join(dir,'new.jpg');await writeFile(newFile,'new artwork');
 await db.query("INSERT INTO versions(id,asset_id,workspace_id,n,status,prompt,headline,cta,mock,file_path,preview_path) VALUES($1,$2,$3,2,'ready','scene','Updated offer','Shop',true,$4,$4)",[newer,assetId,workspace,newFile]);
 await db.query('UPDATE assets SET current_version_id=$2 WHERE id=$1',[assetId,newer]);
 const latest=await requestCampaignExport(db,campaign,workspace,'image');
 assert.notEqual(latest.id,one.id);assert.equal(latest.manifest.entries[0].id,newer);
 assert(await runExportOnce(db));
 const latestReady=await findCampaignExport(db,latest.id,workspace);
 assert.equal(execFileSync('unzip',['-p',latestReady.file_path!,'1-image.jpg'],{encoding:'utf8'}),'new artwork');
 assert.equal(execFileSync('unzip',['-p',ready.file_path!,'1-image.jpg'],{encoding:'utf8'}),'photo');
 const broken=await requestCampaignExport(db,campaign,workspace,'video');
 for(let i=0;i<3;i++){await db.query("UPDATE campaign_exports SET available_at=now()-interval '1 second' WHERE id=$1",[broken.id]);assert(await runExportOnce(db));}
 assert.equal((await findCampaignExport(db,broken.id,workspace)).state,'failed');
 await writeFile(missing,'video');
 assert.equal((await requestCampaignExport(db,campaign,workspace,'video')).id,broken.id);
 assert(await runExportOnce(db));assert.equal((await findCampaignExport(db,broken.id,workspace)).state,'ready');
});

test('background worker builds three full-size video files without holding an HTTP response',async t=>{
 const {dir,db,workspace,campaign,asset}=await fixture(t);
 for(let i=0;i<3;i++){const file=path.join(dir,`video-${i}.mp4`);await writeFile(file,randomBytes(8*1024*1024));await asset('video',file,`Caption ${i}`);}
 const started=Date.now();const queued=await requestCampaignExport(db,campaign,workspace,'all');
 assert.equal(queued.state,'queued');assert.equal(queued.file_path,null);
 assert(await runExportOnce(db));
 const ready=await findCampaignExport(db,queued.id,workspace);assert.equal(ready.state,'ready');
 execFileSync('unzip',['-tq',ready.file_path!]);
 assert((await readFile(ready.file_path!)).length>24*1024*1024);
 assert(Date.now()-started<150000);
});

test('signed media rejects foreign paths before calling storage, fixes TTL and keeps tokens out of JSON',async t=>{
 const {dir,db,workspace,campaign,asset}=await fixture(t);
 const keys=['STORAGE_PROVIDER','SUPABASE_URL','SUPABASE_SECRET_KEY','INKSHOT_SHARED_PROJECT_LIVE'];
 const previous=keys.map(key=>process.env[key]);
 t.after(async()=>{keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i]);});
 Object.assign(process.env,{STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'test-secret',INKSHOT_SHARED_PROJECT_LIVE:'false'});
 const calls: {url:string;body:unknown}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(input),body:JSON.parse(String(init?.body))});
  return Response.json({signedURL:'/object/sign/generated-media/a/file.mp4?token=temporary'});
 });
 const ref=`supabase://generated-media/${workspace}/file.mp4`;
 await assert.rejects(signedMediaUrl(ref,'another','generated-media'),/does not exist/);
 await assert.rejects(signedMediaUrl(ref.replace('generated-media','inkshot-live-generated-media'),workspace,'generated-media'),/does not exist/);
 assert.equal(calls.length,0);
 const link=await signedMediaUrl(ref,workspace,'generated-media','video.mp4');
 assert(link?.startsWith('https://test-project.supabase.co/storage/v1/object/sign/'));
 assert.deepEqual(calls[0].body,{expiresIn:SIGNED_MEDIA_TTL_SECONDS});
 assert.equal(SIGNED_MEDIA_TTL_SECONDS,600);
});

test('HTTP downloads enforce workspace ownership before issuing private URLs and exports expose status only',async t=>{
 const {dir,db,workspace,campaign,asset}=await fixture(t);
 const {tokenHash}=await import('../server/auth.js');
 const keyValues={AUTH_PROVIDER:undefined,STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'test-secret',INKSHOT_SHARED_PROJECT_LIVE:'false'};
 for(const [key,value] of Object.entries(keyValues)){const old=process.env[key];t.after(async()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});if(value===undefined)delete process.env[key];else process.env[key]=value;}
 const other=randomUUID();await db.query('INSERT INTO workspaces(id) VALUES($1)',[other]);
 for(const [w,token] of [[workspace,'own-token'],[other,'other-token']]) {
  const uid=randomUUID();await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash) VALUES($1,$2,'Test',$3,'not-used')",[uid,w,uid+'@example.test']);
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),uid]);
 }
 const vid=await asset('video',`supabase://generated-media/${workspace}/video.mp4`,'Caption');
 const nativeFetch=globalThis.fetch;let signingCalls=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).startsWith('https://test-project.supabase.co/')){signingCalls++;return Response.json({signedURL:'/object/sign/generated-media/a/video.mp4?token=temporary'});}
  return nativeFetch(input,init);
 });
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
 const address=server.address();assert(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 const call=(route:string,token='own-token',body?:unknown)=>nativeFetch(origin+'/api'+route,{method:body?'POST':'GET',redirect:'manual',headers:{cookie:`inkshot_session=${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert.equal((await call(`/media/${vid}?download=true`,'other-token')).status,404);assert.equal(signingCalls,0);
 const download=await call(`/media/${vid}?download=true`);assert.equal(download.status,302);assert.equal(signingCalls,1);
 assert.match(download.headers.get('location')!,/^https:\/\/test-project.supabase.co\/storage\/v1\/object\/sign\//);
 assert.equal(download.headers.get('cache-control'),'private, no-store');
 assert.equal((await call(`/campaigns/${campaign}/exports`,'other-token',{category:'video'})).status,404);
 const queued=await call(`/campaigns/${campaign}/exports`,'own-token',{category:'video'});assert.equal(queued.status,202);
 const {id}=await queued.json();
 assert.equal((await call(`/exports/${id}`,'other-token')).status,404);
 const state=await (await call(`/exports/${id}`)).json();assert.deepEqual(state,{id,state:'queued'});
 assert(!JSON.stringify(state).includes('supabase://'));
 assert.equal((await call(`/exports/${id}/download`)).status,409);
});

test('private storage operations propagate cancellation before a timed-out job releases its lease',async t=>{
 const {dir,workspace}=await fixture(t);
 const {persistMedia}=await import('../server/storage.js');
 const values={STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'test-secret'};
 for(const [key,value] of Object.entries(values)){const old=process.env[key];t.after(async()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});process.env[key]=value;}
 let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 let aborted=false;
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  assert(init?.signal);
  init.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true});
  started();
 }));
 const file=path.join(dir,'cancel.jpg');await writeFile(file,'fixture');
 const controller=new AbortController();
 const pending=persistMedia(file,workspace,'generated-media',controller.signal);
 await ready; controller.abort();
 await assert.rejects(pending); assert(aborted);
});
