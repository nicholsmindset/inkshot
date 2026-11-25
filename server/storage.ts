import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {config,AppError} from './config.js';
export const cloudStorageEnabled=()=>process.env.STORAGE_PROVIDER==='supabase';
function client(signal?: AbortSignal){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)throw new AppError(503,'Private media storage is not configured.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{
  fetch: (input, init) => fetch(input, {...init, signal: AbortSignal.any([
   AbortSignal.timeout(30_000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : []),
  ])}),
 }});
}
const PREFIX='supabase://';
export const SIGNED_MEDIA_TTL_SECONDS = 600;
export const PROVIDER_INPUT_TTL_SECONDS = 3600;
type MediaBucket = 'brand-uploads' | 'generated-media';

function bucketName(bucket: MediaBucket) {
  if (process.env.INKSHOT_SHARED_PROJECT_LIVE === 'true') {
    if (process.env.BILLING_MODE !== 'live' || config.mode !== 'live')
      throw new AppError(503, 'Shared production storage requires live billing and generation.');
    return 'inkshot-live-' + bucket;
  }
  return bucket;
}

export async function persistMedia(file:string,workspaceId:string,kind:MediaBucket,signal?:AbortSignal){
 if(!cloudStorageEnabled())return file;
 const reference=uploadMediaReference(file,workspaceId,kind);
 const {bucket,key}=privateMediaKey(reference,workspaceId,kind);
 const ext=path.extname(file);
 const {error}=await client(signal).storage.from(bucket).upload(key,await readFile(file,{signal}),{contentType:ext==='.zip'?'application/zip':ext==='.mp4'?'video/mp4':ext==='.png'?'image/png':'image/jpeg',upsert:true});
 if(error)throw new AppError(503,'Media could not be saved. Please retry.');
 return reference;
}

// Reserve this reference and its quota row before the external write. If the
// process stops after storage succeeds, the object still has a durable owner.
export function uploadMediaReference(file:string,workspaceId:string,kind:MediaBucket){
 if(!cloudStorageEnabled())return file;
 const reference=`${PREFIX}${bucketName(kind)}/${workspaceId}/${path.basename(file)}`;
 privateMediaKey(reference,workspaceId,kind);
 return reference;
}

// For rollback of an upload whose database insert failed. A caller must retain
// the newly-created reference; never accept an arbitrary customer-supplied path.
export async function removePrivateMedia(reference:string,workspaceId:string,kind:MediaBucket){
 if(reference.startsWith(PREFIX)) {
  const {bucket,key}=privateMediaKey(reference,workspaceId,kind);
  const {error}=await client().storage.from(bucket).remove([key]);
  if(error)throw new AppError(503,'The unfinished upload could not be removed.');
  return;
 }
 if(cloudStorageEnabled())throw new Error('Expected private cloud media');
 const resolved=path.resolve(reference),root=path.resolve(config.dataDir);
 if(!resolved.startsWith(root+path.sep))throw new AppError(404,'Media does not exist in this workspace.');
 await rm(resolved,{force:true});
}
export async function materializeMedia(reference:string, workspaceId:string, kind:MediaBucket,signal?:AbortSignal,temporaryDirectory?:string){
 if(!reference.startsWith(PREFIX)) {
  if(cloudStorageEnabled())throw new Error('Expected private cloud media');
  return reference;
 }
 const {bucket,key}=privateMediaKey(reference,workspaceId,kind);
 const target=temporaryDirectory
  ? path.join(temporaryDirectory,bucket,key)
  : path.join(config.dataDir,'cache',bucket,key);
 await mkdir(path.dirname(target),{recursive:true});
 const {data,error}=await client(signal).storage.from(bucket).download(key);
 if(error||!data)throw new AppError(503,'Your media could not be downloaded. Please retry.');
 await writeFile(target,Buffer.from(await data.arrayBuffer()),{signal});
 return target;
}

function privateMediaKey(reference:string,workspaceId:string,kind:MediaBucket){
 const bucket=bucketName(kind);
 const [storedBucket, owner, filename, ...extra]=reference.slice(PREFIX.length).split('/');
 if (storedBucket !== bucket || owner !== workspaceId || !owner || !filename || extra.length ||
     !/^[a-zA-Z0-9_-]+$/.test(owner) || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(filename))
   throw new AppError(404,'Media does not exist in this workspace.');
 const key=`${owner}/${filename}`;
 return {bucket,key};
}

// Short-lived capability URL, created only after callers verify record ownership.
// Reference validation also refuses another workspace, bucket or environment.
export async function signedMediaUrl(reference:string,workspaceId:string,kind:MediaBucket,download?:string,signal?:AbortSignal){
 if(!reference.startsWith(PREFIX)) {
  if(cloudStorageEnabled())throw new Error('Expected private cloud media');
  return null;
 }
 const {bucket,key}=privateMediaKey(reference,workspaceId,kind);
 const {data,error}=await client(signal).storage.from(bucket).createSignedUrl(key,SIGNED_MEDIA_TTL_SECONDS,download?{download}:undefined);
 if(error||!data?.signedUrl)throw new AppError(503,'Your download link could not be created. Please retry.');
 return data.signedUrl;
}

// Provider input access is distinct from a customer download. A one-hour
// capability covers the bounded generation lifecycle without making uploads
// public. Never use it for download links or return it in client JSON.
export async function signedProviderInputUrl(reference:string,workspaceId:string,signal?:AbortSignal){
 if(!reference.startsWith(PREFIX)) {
  if(cloudStorageEnabled())throw new Error('Expected private cloud media');
  return null;
 }
 const {bucket,key}=privateMediaKey(reference,workspaceId,'brand-uploads');
 const {data,error}=await client(signal).storage.from(bucket).createSignedUrl(key,PROVIDER_INPUT_TTL_SECONDS);
 if(error||!data?.signedUrl)throw new AppError(503,'Your product photo could not be prepared. Please retry.');
 return data.signedUrl;
}
