import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/db.js';
import { config } from '../server/config.js';
import { withUploadQuota, UPLOAD_MAX_FILE_BYTES, UPLOAD_MAX_WORKSPACE_BYTES, UPLOAD_MAX_WORKSPACE_FILES } from '../server/upload-limits.js';
import { removePrivateMedia, uploadMediaReference } from '../server/storage.js';

test('upload quota serializes final allowance and isolates workspace usage', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'inkshot-upload-quota-'));
  const db=await createDatabase(dir,true);
  t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
  await db.query('ALTER TABLE uploads ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 10485760');
  const workspace=randomUUID(),other=randomUUID();
  for(const id of [workspace,other])await db.query('INSERT INTO workspaces(id) VALUES($1)',[id]);
  await db.query('INSERT INTO uploads(id,workspace_id,file_path,size_bytes) VALUES($1,$2,$3,$4)',[randomUUID(),workspace,'fixture',UPLOAD_MAX_WORKSPACE_BYTES-UPLOAD_MAX_FILE_BYTES]);
  const save=(owner:string)=>withUploadQuota(db,owner,UPLOAD_MAX_FILE_BYTES,async tx=>{
    const id=randomUUID();
    await tx.query('INSERT INTO uploads(id,workspace_id,file_path,size_bytes) VALUES($1,$2,$3,$4)',[id,owner,'fixture',UPLOAD_MAX_FILE_BYTES]);
    return id;
  });
  const requests=await Promise.allSettled([save(workspace),save(workspace)]);
  assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(requests.filter(r=>r.status==='rejected').length,1);
  const usage=(await db.query<{bytes:string}>('SELECT sum(size_bytes)::text AS bytes FROM uploads WHERE workspace_id=$1',[workspace])).rows[0];
  assert.equal(Number(usage.bytes),UPLOAD_MAX_WORKSPACE_BYTES);
  assert(await save(other));
  await assert.rejects(withUploadQuota(db,workspace,UPLOAD_MAX_FILE_BYTES+1,async()=>null),/smaller than/);
  await assert.rejects(withUploadQuota(db,workspace,0,async()=>null),/smaller than/);
  await assert.rejects(withUploadQuota(db,'missing-workspace',1,async()=>null),/not found/);
});

test('file count, frozen workspaces and failed writes do not bypass quota accounting',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'inkshot-upload-count-'));
  const db=await createDatabase(dir,true);
  t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
  await db.query('ALTER TABLE uploads ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 10485760');
  const workspace=randomUUID(),empty=randomUUID(),frozen=randomUUID();
  for(const id of [workspace,empty,frozen])await db.query('INSERT INTO workspaces(id) VALUES($1)',[id]);
  await db.query("INSERT INTO uploads(id,workspace_id,file_path,size_bytes) SELECT $1||'-'||n,$1,'fixture',1 FROM generate_series(1,$2) n",[workspace,UPLOAD_MAX_WORKSPACE_FILES]);
  let called=false;
  await assert.rejects(withUploadQuota(db,workspace,1,async()=>{called=true;}),/upload limit/);
  assert.equal(called,false);
  await assert.rejects(withUploadQuota(db,empty,10,async tx=>{
    await tx.query('INSERT INTO uploads(id,workspace_id,file_path,size_bytes) VALUES($1,$2,$3,10)',[randomUUID(),empty,'fixture']);
    throw new Error('storage persistence failed');
  }),/storage persistence failed/);
  assert.equal((await db.query('SELECT id FROM uploads WHERE workspace_id=$1',[empty])).rows.length,0);
  await db.query('UPDATE workspaces SET deletion_requested_at=now() WHERE id=$1',[frozen]);
  await assert.rejects(withUploadQuota(db,frozen,1,async()=>null),/deletion/);
});

test('upload rollback deletes only validated private media and bounds local cleanup',async t=>{
  const oldDir=config.dataDir;
  const dir=await mkdtemp(path.join(tmpdir(),'inkshot-upload-cleanup-'));config.dataDir=dir;
  const values={STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'test-secret',INKSHOT_SHARED_PROJECT_LIVE:'false'};
  for(const [key,value] of Object.entries(values)){const old=process.env[key];t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});process.env[key]=value;}
  t.after(async()=>{config.dataDir=oldDir;await rm(dir,{recursive:true,force:true});});
  const workspace=randomUUID();let calls=0;
  assert.equal(uploadMediaReference(path.join(dir,'new.jpg'),workspace,'brand-uploads'),`supabase://brand-uploads/${workspace}/new.jpg`);
  assert.throws(()=>uploadMediaReference(path.join(dir,'new.jpg'),'../foreign','brand-uploads'),/does not exist/);
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    calls++;assert.equal(init?.method,'DELETE');
    assert(String(input).endsWith('/object/brand-uploads'));
    assert.deepEqual(JSON.parse(String(init?.body)),{prefixes:[`${workspace}/new.jpg`]});
    return Response.json([]);
  });
  await assert.rejects(removePrivateMedia(`supabase://brand-uploads/foreign/new.jpg`,workspace,'brand-uploads'),/does not exist/);
  assert.equal(calls,0);
  await removePrivateMedia(`supabase://brand-uploads/${workspace}/new.jpg`,workspace,'brand-uploads');
  assert.equal(calls,1);
  delete process.env.STORAGE_PROVIDER;
  const file=path.join(dir,'new.jpg');await writeFile(file,'photo');
  await removePrivateMedia(file,workspace,'brand-uploads');
  await assert.rejects(access(file),{code:'ENOENT'});
  await assert.rejects(removePrivateMedia('/tmp/not-this-workspace.jpg',workspace,'brand-uploads'),/does not exist/);
});
