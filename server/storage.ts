import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {config,AppError} from './config';
export const cloudStorageEnabled=()=>process.env.STORAGE_PROVIDER==='supabase';
function client(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)throw new AppError(503,'Private media storage is not configured.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
const PREFIX='supabase://';
function parse(reference:string){
 const parts=reference.slice(PREFIX.length).split('/'),bucket=parts.shift()!;
 if(!['brand-uploads','generated-media'].includes(bucket)||parts.some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid storage reference');
 return {bucket,key:parts.join('/')};
}
export async function persistMedia(file:string,workspaceId:string,bucket:'brand-uploads'|'generated-media'){
 if(!cloudStorageEnabled())return file;
 const key=`${workspaceId}/${path.basename(file)}`;
 const ext=path.extname(file);
 const {error}=await client().storage.from(bucket).upload(key,await readFile(file),{contentType:ext==='.mp4'?'video/mp4':ext==='.png'?'image/png':'image/jpeg',upsert:true});
 if(error)throw new AppError(503,'Media could not be saved. Please retry.');
 return `${PREFIX}${bucket}/${key}`;
}
export async function materializeMedia(reference:string){
 if(!reference.startsWith(PREFIX)) {
  if(cloudStorageEnabled())throw new Error('Expected private cloud media');
  return reference;
 }
 const {bucket,key}=parse(reference);
 const target=path.join(config.dataDir,'cache',bucket,key);
 await mkdir(path.dirname(target),{recursive:true});
 const {data,error}=await client().storage.from(bucket).download(key);
 if(error||!data)throw new AppError(503,'Your media could not be downloaded. Please retry.');
 await writeFile(target,Buffer.from(await data.arrayBuffer()));
 return target;
}
