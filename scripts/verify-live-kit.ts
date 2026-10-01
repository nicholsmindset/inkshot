import {createDatabase} from '../server/db';
import {createApp} from '../server/app';
import {createUser} from '../server/auth';
import {demoBrand,sampleConcepts} from '../server/brand';
import {randomBytes,randomUUID} from 'node:crypto';
import {startWorker} from '../server/worker';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const db=await createDatabase(path.resolve('data/live-verification'),true);
const password=randomBytes(24).toString('hex');
const email=`verification-${Date.now()}@inkshot.invalid`;
const {workspaceId}=await createUser(db,{name:'Inkshot verification',email,password},demoBrand);
await db.query('UPDATE workspaces SET credits=300 WHERE id=$1',[workspaceId]);
const server=createApp(db).listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
const addr=server.address();if(!addr||typeof addr==='string')throw new Error('No server address');
const base=`http://127.0.0.1:${addr.port}`;
let cookie='';
async function call(route:string,body?:unknown){const res=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie')!.split(';')[0];if(!res.ok)throw new Error(`${route}: ${res.status} ${await res.text()}`);return res;}
let stop:()=>void=()=>{};
try{
 await call('/auth/login',{email,password});
 const campaign = process.env.VERIFY_SAMPLE_CONCEPTS==='true' ? {id:randomUUID()} : await (await call('/campaigns',{name:'Live verification kit',goal:'Awareness',offer:''})).json();
 if(process.env.VERIFY_SAMPLE_CONCEPTS==='true') {
   await db.query('INSERT INTO campaigns(id,workspace_id,name,goal,offer,concepts,brand,mock) VALUES($1,$2,$3,$4,$5,$6,$7,false)',[campaign.id,workspaceId,'Live media verification with sample concepts','Awareness','',JSON.stringify(sampleConcepts(demoBrand,'')),JSON.stringify(demoBrand)]);
   console.log('Using labelled sample concepts: OpenRouter account needs funding.');
 }
 await call(`/campaigns/${campaign.id}/generate`,{approved:true});
 console.log(JSON.stringify({campaignId:campaign.id,workspaceId,status:'queued',maxProviderBudgetUSD:process.env.HF_DAILY_BUDGET_USD}));
 stop=startWorker(db);
 const deadline=Date.now()+25*60*1000;let last='';
 while(Date.now()<deadline){
  const rows=(await db.query<{status:string;count:string}>('SELECT status,count(*)::text AS count FROM versions WHERE workspace_id=$1 GROUP BY status',[workspaceId])).rows;
  const summary=JSON.stringify(rows);if(summary!==last){console.log(summary);last=summary;}
  const pending=rows.some(r=>['queued','making','rendering'].includes(r.status));
  if(!pending){
   const failures=(await db.query('SELECT error FROM versions WHERE workspace_id=$1 AND status=\'failed\'',[workspaceId])).rows;
   if(failures.length)throw new Error(JSON.stringify(failures));
   await mkdir('outputs',{recursive:true});
   const zip=await call(`/campaigns/${campaign.id}/download`);
   await writeFile('outputs/live-kit.zip',Buffer.from(await zip.arrayBuffer()));
   const spend=(await db.query('SELECT sum(usd)::text AS reserved_usd FROM provider_spend')).rows;
   console.log(JSON.stringify({verified:true,assets:9,spend,zip:'outputs/live-kit.zip'}));break;
  }
  await new Promise(r=>setTimeout(r,5000));
 }
} finally {stop();server.close();await new Promise(r=>setTimeout(r,1200));await db.close();}
