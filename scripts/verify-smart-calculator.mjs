import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

assert(!process.env.DATABASE_URL && !process.env.AUTH_PROVIDER && !process.env.STORAGE_PROVIDER);
process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'inkshot-real-crawl-'));
process.env.GENERATION_MODE = 'mock';
process.env.ALLOW_LIVE_GENERATION = 'false';
process.env.FFMPEG_PATH = ffmpeg;
const { createApp } = await import('../server/app.ts');
const { createDatabase } = await import('../server/db.ts');
const { runWorkerOnce } = await import('../server/worker.ts');
const database = await createDatabase(process.env.DATA_DIR, true);
const server = createApp(database).listen(0, '127.0.0.1');
await once(server, 'listening');
const api = 'http://127.0.0.1:' + server.address().port + '/api';
let cookie = '';
async function request(route, body, method = body ? 'POST' : 'GET') {
  const form = body instanceof FormData;
  const response = await fetch(api + route, {
    method, body: body ? form ? body : JSON.stringify(body) : undefined,
    headers: { cookie, ...(body && !form ? {'content-type':'application/json'} : {}) },
  });
  if (!response.ok) throw Error(method + ' ' + route + ' returned ' + response.status + ' ' + await response.text());
  return response;
}
const json = async (...args) => (await request(...args)).json();
const site = 'https://www.smartcalculator.sg';
const destination = site + '/housing/hdb-affordability-calculator';
const offer = 'Free HDB affordability calculator';
const cta = 'Estimate my HDB budget';
const out = process.env.RUNNER_TEMP + '/inkshot-crawl-proof';
try {
  const signup = await request('/auth/signup', {name:'Isolated QA',email:'launch@example.test',password:crypto.randomUUID()});
  cookie = signup.headers.get('set-cookie').split(';')[0];
  const identity = await json('/brand/read', {url:site+'/'});
  assert.equal(identity.name, 'Smart Calculator');
  assert.equal(identity.color.toLowerCase(), '#b7102a');
  assert.equal(identity.logoUrl, site + '/icon.svg');
  const pages = identity.sources.map(s => new URL(s.url).pathname.replace(/\/$/, '') || '/');
  assert(pages.includes('/') && pages.includes('/about'), JSON.stringify(pages));
  assert(identity.sources.every(s=>s.text.trim().length));
  const destinationResponse = await fetch(destination);
  assert.equal(destinationResponse.status, 200);
  const logoImport = await request('/brand/import-logo',{website:identity.website,logoUrl:identity.logoUrl});
  assert.equal(logoImport.status,201);
  const {id:logoId} = await logoImport.json();
  const logoUrl = '/uploads/'+logoId;
  assert.equal((await fetch(api+logoUrl)).status,401);
  const otherSignup=await request('/auth/signup',{name:'Other isolated QA',email:'other@example.test',password:crypto.randomUUID()});
  const otherCookie=otherSignup.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(api+logoUrl,{headers:{cookie:otherCookie}})).status,404);
  const privateLogo=await sharp(Buffer.from(await (await request(logoUrl)).arrayBuffer())).metadata();
  assert.equal(privateLogo.format,'png');
  assert(privateLogo.width>0 && privateLogo.height>0);
  const approvedDescription = 'Estimate the budget for your first HDB flat using income, CPF savings and grants.';
  await json('/brand',{...identity,logoId,offer,description:approvedDescription},'PUT');
  const before = await json('/studio');
  assert.equal(before.brand.description,approvedDescription);
  const campaign = await json('/campaigns',{name:'Plan your first HDB budget',goal:'Awareness',offer});
  const drafts = campaign.concepts.flatMap(concept => ['video','image','post'].map(kind=>({conceptId:concept.id,kind,headline:'Plan your first HDB budget',cta})));
  await json('/campaigns/'+campaign.id+'/generate',{approved:true,drafts,destinationUrl:destination});
  for (let i=0;i<9;i++) assert(await runWorkerOnce(database));
  const after = await json('/studio');
  const saved = after.campaigns.find(c=>c.id===campaign.id);
  assert.equal(saved.brand.destinationUrl,destination);
  assert.equal(saved.brand.color,identity.color);
  assert.equal(saved.brand.logoId,logoId);
  assert.equal(saved.offer,offer);
  assert.equal(saved.brand.description,approvedDescription);
  assert.equal(before.balance-after.balance,100);
  const assets = after.assets.filter(a=>a.campaign_id===campaign.id);
  assert.equal(assets.length,9);
  for(const asset of assets) {
    const current=asset.versions.find(v=>v.id===asset.current_version_id);
    assert.equal(current.status,'ready'); assert.equal(current.cta,cta);
  }
  await mkdir(out,{recursive:true});
  const archive=path.join(out,'smart-calculator-preview.zip');
  const url='/campaigns/'+campaign.id+'/download';
  assert.equal((await fetch(api+url)).status,401);
  await writeFile(archive,Buffer.from(await (await request(url)).arrayBuffer()));
  execFileSync('unzip',['-tq',archive]);
  const filenames=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n');
  for(const [kind,suffix] of [['video','-video.mp4'],['image','-image.jpg'],['post','-post.jpg']]) {
    const matches = filenames.filter(f=> f.endsWith(suffix)); assert.equal(matches.length,3,kind);
    for(const f of matches) {
      const bytes=execFileSync('unzip',['-p',archive,f],{maxBuffer:16*1024*1024});
      if(kind==='video') execFileSync(ffmpeg,['-v','error','-i','pipe:0','-frames:v','1','-f','null','-'],{input:bytes});
      else {const image=await sharp(bytes).metadata();assert.equal(image.format,'jpeg');assert(image.width&&image.height);}
    }
  }
  const captions = execFileSync('unzip',['-p',archive,'captions.txt'],{encoding:'utf8'});
  assert(captions.includes(cta)&&captions.includes(destination));
  assert.equal(execFileSync('unzip',['-p',archive,'destination-url.txt'],{encoding:'utf8'}).trim(),destination);
  const report = {mode:'mock',source:'Inkshot /api/brand/read, live HTTPS and DNS',site,readPages:identity.sources.map(s=>s.url),name:identity.name,colour:identity.color,logo:identity.logoUrl,offer,cta,destination,logoImport:{route:"/api/brand/import-logo",format:privateLogo.format,width:privateLogo.width,height:privateLogo.height,anonymousStatus:401,otherWorkspaceStatus:404},correctionSaved:true,privateDownload:true,creditsSpent:before.balance-after.balance,archiveEntries:filenames};
  console.log(JSON.stringify(report,null,2));
  await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
} finally {
  await new Promise(resolve=>server.close(resolve));
  await database.close();
}
