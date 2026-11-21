import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/db.js';
import { config } from '../server/config.js';
import { listUploads, removeUnusedUpload } from '../server/upload-management.js';
import { signedProviderInputUrl, PROVIDER_INPUT_TTL_SECONDS } from '../server/storage.js';

async function fixture(t:{after:(fn:()=>Promise<void>|void)=>void}) {
 const dir=await mkdtemp(path.join(tmpdir(),'inkshot-upload-management-'));
 const db=await createDatabase(dir,true),oldDir=config.dataDir;config.dataDir=dir;
 const oldProvider=process.env.STORAGE_PROVIDER;delete process.env.STORAGE_PROVIDER;
 t.after(async()=>{if(oldProvider===undefined)delete process.env.STORAGE_PROVIDER;else process.env.STORAGE_PROVIDER=oldProvider;config.dataDir=oldDir;await db.close();await rm(dir,{recursive:true,force:true});});
 const workspace=randomUUID(),other=randomUUID();
 for(const id of [workspace,other])await db.query('INSERT INTO workspaces(id) VALUES($1)',[id]);
 const upload=async(owner=workspace)=>{
  const id=randomUUID(),file=path.join(dir,`${id}.jpg`);await writeFile(file,'photo');
  await db.query("INSERT INTO uploads(id,workspace_id,file_path,size_bytes,created_at) VALUES($1,$2,$3,5,now()-interval '10 minutes')",[id,owner,file]);
  return {id,file};
 };
 return {dir,db,workspace,other,upload};
}

test('unused upload listing is owner-scoped and references protect brand, campaign and draft files',async t=>{
 const {db,workspace,other,upload}=await fixture(t);
 const brand=await upload(),campaign=await upload(),draft=await upload(),unused=await upload(),foreign=await upload(other);
 await db.query('UPDATE workspaces SET brand=$2 WHERE id=$1',[workspace,JSON.stringify({certifications:{certificateId:brand.id}})]);
 await db.query("INSERT INTO campaigns(id,workspace_id,name,goal,concepts,brand,draft,mock) VALUES($1,$2,'Test','sales','[]',$3,$4,true)",[randomUUID(),workspace,JSON.stringify({photoId:campaign.id}),JSON.stringify({photoId:draft.id})]);
 const rows=await listUploads(db,workspace);
 assert.equal(rows.length,4);assert(!rows.some(row=>row.id===foreign.id));
 for(const used of [brand,campaign,draft]){
  assert.equal(rows.find(row=>row.id===used.id)?.inUse,true);
  await assert.rejects(removeUnusedUpload(db,workspace,used.id),/still processing or used/);
  await access(used.file);
 }
 assert.deepEqual(Object.keys(rows[0]).sort(),['createdAt','id','inUse','sizeBytes']);
 assert(rows.every(row=>row.sizeBytes===5));assert.equal(rows.find(row=>row.id===unused.id)?.inUse,false);
 await assert.rejects(removeUnusedUpload(db,workspace,foreign.id),/not found/);
 await access(foreign.file);
 assert.deepEqual(await removeUnusedUpload(db,workspace,unused.id),{ok:true});
 await assert.rejects(access(unused.file),{code:'ENOENT'});
 assert.equal((await db.query('SELECT id FROM uploads WHERE id=$1',[unused.id])).rows.length,0);
 await assert.rejects(removeUnusedUpload(db,workspace,unused.id),/not found/);
});

test('cloud removal failure keeps quota and a later idempotent retry can finish',async t=>{
 const {db,workspace,upload}=await fixture(t);
 const file=await upload();
 await db.query('UPDATE uploads SET file_path=$2 WHERE id=$1',[file.id,`supabase://brand-uploads/${workspace}/${file.id}.jpg`]);
 const values={STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'fixture',INKSHOT_SHARED_PROJECT_LIVE:'false'};
 for(const [key,value] of Object.entries(values)){const old=process.env[key];t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});process.env[key]=value;}
 let fail=true,calls=0;
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{
  calls++;assert.equal(init?.method,'DELETE');
  return fail?Response.json({message:'private detail'},{status:503}):Response.json([]);
 });
 await assert.rejects(removeUnusedUpload(db,workspace,file.id),/unfinished upload could not be removed/);
 assert.equal((await listUploads(db,workspace))[0].sizeBytes,5);
 fail=false;assert.deepEqual(await removeUnusedUpload(db,workspace,file.id),{ok:true});
 assert.equal((await listUploads(db,workspace)).length,0);assert.equal(calls,2);
});

test('upload list is bounded and deletion freeze prevents individual removal',async t=>{
 const {db,workspace,upload}=await fixture(t);
 const file=await upload();
 await db.query("INSERT INTO uploads(id,workspace_id,file_path,size_bytes) SELECT $1||'-'||n,$1,'fixture',1 FROM generate_series(1,110) n",[workspace]);
 assert.equal((await listUploads(db,workspace)).length,100);
 await db.query('UPDATE workspaces SET deletion_requested_at=now() WHERE id=$1',[workspace]);
 await assert.rejects(removeUnusedUpload(db,workspace,file.id),/deletion/);
 await access(file.file);
});

test('fresh reservation cannot be removed while an external upload may still finish',async t=>{
 const {db,workspace,upload}=await fixture(t);
 const file=await upload();
 await db.query('UPDATE uploads SET created_at=now() WHERE id=$1',[file.id]);
 assert.equal((await listUploads(db,workspace))[0].inUse,true);
 await assert.rejects(removeUnusedUpload(db,workspace,file.id),/Wait five minutes/);
 await access(file.file);
 await db.query("UPDATE uploads SET created_at=now()-interval '6 minutes' WHERE id=$1",[file.id]);
 assert.equal((await listUploads(db,workspace))[0].inUse,false);
 assert.deepEqual(await removeUnusedUpload(db,workspace,file.id),{ok:true});
});

test('provider input capabilities use a separate bounded TTL and reject other owners/buckets',async t=>{
 const values={STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'fixture',INKSHOT_SHARED_PROJECT_LIVE:'false'};
 for(const [key,value] of Object.entries(values)){const old=process.env[key];t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});process.env[key]=value;}
 const workspace=randomUUID();let calls=0;
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{
  calls++;assert.deepEqual(JSON.parse(String(init?.body)),{expiresIn:PROVIDER_INPUT_TTL_SECONDS});
  assert(init?.signal);return Response.json({signedURL:'/object/sign/brand-uploads/a/photo.jpg?token=private'});
 });
 await assert.rejects(signedProviderInputUrl(`supabase://brand-uploads/foreign/photo.jpg`,workspace),/does not exist/);
 await assert.rejects(signedProviderInputUrl(`supabase://generated-media/${workspace}/photo.jpg`,workspace),/does not exist/);
 assert.equal(calls,0);
 assert(await signedProviderInputUrl(`supabase://brand-uploads/${workspace}/photo.jpg`,workspace,new AbortController().signal));
 assert.equal(PROVIDER_INPUT_TTL_SECONDS,3600);assert.equal(calls,1);
});
