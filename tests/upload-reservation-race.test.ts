import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createDatabase, type Database } from '../server/db.js';
import { createApp } from '../server/app.js';
import { tokenHash } from '../server/auth.js';
import { config } from '../server/config.js';
import { removeUnusedUpload } from '../server/upload-management.js';

test('a request resumed after reservation deletion cannot recreate an untracked cloud object',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'inkshot-upload-race-'));
 const db=await createDatabase(dir,true),oldDir=config.dataDir;config.dataDir=dir;
 const values:Record<string,string|undefined>={AUTH_PROVIDER:undefined,STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'fixture',INKSHOT_SHARED_PROJECT_LIVE:'false'};
 for(const [key,value] of Object.entries(values)){const old=process.env[key];t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});if(value===undefined)delete process.env[key];else process.env[key]=value;}
 const workspace=randomUUID(),user=randomUUID(),token='upload-race-session';
 await db.query('INSERT INTO workspaces(id) VALUES($1)',[workspace]);
 await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash) VALUES($1,$2,'Test',$3,'unused')",[user,workspace,`${user}@example.test`]);
 await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),user]);
 let removedReservation=false;
 const wrapped:Database={...db,transaction:async fn=>{
  let reservationId:string|undefined;
  const result=await db.transaction(tx=>fn({query:async<T>(sql:string,params?:unknown[])=>{
   const result=await tx.query<T>(sql,params);
   if(sql.startsWith('INSERT INTO uploads('))reservationId=String(params?.[0]);
   return result;
  }}));
  if(reservationId){
   // Simulate a request pause longer than the fresh-upload grace and a second
   // tab deleting its unused reservation before this request resumes.
   await db.query("UPDATE uploads SET created_at=now()-interval '10 minutes' WHERE id=$1",[reservationId]);
   await removeUnusedUpload(db,workspace,reservationId);
   removedReservation=true;
  }
  return result;
 }};
 const nativeFetch=globalThis.fetch;let storageWrites=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).startsWith('https://test-project.supabase.co/')){
   if(init?.method==='DELETE')return Response.json([]);
   storageWrites++;return Response.json({Key:'unexpected'});
  }
  return nativeFetch(input,init);
 });
 const server=createApp(wrapped).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();config.dataDir=oldDir;await rm(dir,{recursive:true,force:true});});
 const address=server.address();assert(address&&typeof address!=='string');
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).png().toBuffer();
 const form=new FormData();form.set('photo',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'photo.png');
 const response=await nativeFetch(`http://127.0.0.1:${address.port}/api/uploads`,{method:'POST',headers:{cookie:`inkshot_session=${token}`},body:form});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/removed before it finished/);
 assert.equal(removedReservation,true);assert.equal(storageWrites,0);
 assert.equal((await db.query('SELECT id FROM uploads WHERE workspace_id=$1',[workspace])).rows.length,0);
});
