import {createDatabase} from '../server/db';
import {createApp} from '../server/app';
import {createUser} from '../server/auth';
import {demoBrand,sampleConcepts} from '../server/brand';
import {randomBytes,randomUUID} from 'node:crypto';
import {startWorker} from '../server/worker';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {validateKitArchive,waitForReadyKit,type VerificationAsset} from './live-kit-validation';
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
async function call(route:string,body?:unknown,method=body?'POST':'GET'){const res=await fetch(base+'/api'+route,{method,headers:{'content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie')!.split(';')[0];if(!res.ok)throw new Error(`${route}: ${res.status} ${await res.text()}`);return res;}
let stop:()=>void=()=>{};
try{
 await call('/auth/login',{email,password});
 const campaign = process.env.VERIFY_SAMPLE_CONCEPTS==='true' ? {id:randomUUID(),concepts:sampleConcepts(demoBrand,'')} : await (await call('/campaigns',{name:'Live verification kit',goal:'Awareness',offer:''})).json();
 if(process.env.VERIFY_SAMPLE_CONCEPTS==='true') {
   await db.query('INSERT INTO campaigns(id,workspace_id,name,goal,offer,concepts,brand,mock) VALUES($1,$2,$3,$4,$5,$6,$7,false)',[campaign.id,workspaceId,'Live media verification with sample concepts','Awareness','',JSON.stringify(campaign.concepts),JSON.stringify(demoBrand)]);
   console.log('Using labelled sample concepts: OpenRouter account needs funding.');
 }
 const selected = campaign.concepts.slice(0, 3);
 let savedDraft;
 if (process.env.VERIFY_SAMPLE_CONCEPTS === 'true') {
   // This explicit media-only check avoids a paid writing request.
   const assets = selected.flatMap((concept: {id:string;hook:string;cta:string;description:string}) =>
     ['video','image','post'].map(kind => ({
       conceptId:concept.id, kind, headline:concept.hook, cta:concept.cta,
       prompt:`${concept.description} Editorial candle photography, warm light, no text or logos.`,
       ...(kind === 'video' && {motionPrompt:'0–5 seconds: hold on the candle. 5–10 seconds: slowly move closer. 10–15 seconds: settle on the flame. No text or logos.'}),
       ...(kind === 'post' && {caption:`${concept.hook}\n\n${demoBrand.description}\n\n${concept.cta}`}),
     })));
   savedDraft = await (await call(`/campaigns/${campaign.id}/draft`, {
     revision:0, selectedConceptIds:selected.map((concept:{id:string}) => concept.id), assets,
   }, 'PATCH')).json();
 } else {
   savedDraft = await (await call(`/campaigns/${campaign.id}/prompts`, {
     revision:0, selectedConceptIds:selected.map((concept:{id:string}) => concept.id),
   })).json();
 }
 await call(`/campaigns/${campaign.id}/generate`,{approved:true,draftRevision:savedDraft.revision});
 console.log(JSON.stringify({campaignId:campaign.id,workspaceId,status:'queued',maxProviderBudgetUSD:process.env.HF_DAILY_BUDGET_USD}));
 stop=startWorker(db);
 let last = '';
 const assets = await waitForReadyKit(async () => (await db.query<VerificationAsset>(
   `SELECT a.id,a.kind,v.status,v.file_path,v.mock,v.error
    FROM assets a LEFT JOIN versions v ON v.id=a.current_version_id
    WHERE a.campaign_id=$1 AND a.workspace_id=$2 ORDER BY a.id`,
   [campaign.id, workspaceId],
 )).rows, {
   timeoutMs: 25 * 60 * 1000,
   intervalMs: 5000,
   onProgress: rows => {
     const summary = JSON.stringify(rows.map(asset => ({id:asset.id,kind:asset.kind,status:asset.status})));
     if (summary !== last) { console.log(summary); last = summary; }
   },
 });
 const zip = await call(`/campaigns/${campaign.id}/download`);
 const bytes = Buffer.from(await zip.arrayBuffer());
 validateKitArchive(bytes);
 await mkdir('outputs', {recursive:true});
 await writeFile('outputs/live-kit.zip', bytes);
 const spend = (await db.query('SELECT sum(usd)::text AS reserved_usd FROM provider_spend')).rows;
 console.log(JSON.stringify({verified:true,assets:assets.length,spend,zip:'outputs/live-kit.zip'}));

} finally {stop();server.close();await new Promise(r=>setTimeout(r,1200));await db.close();}
