import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../server/config.js';
import { deletionAdapters } from '../server/deletion-adapters.js';

function storageEnvironment(t: { after: (fn: () => void) => void }) {
  const keys = ['SUPABASE_URL','SUPABASE_SECRET_KEY','STORAGE_PROVIDER'] as const;
  const before = keys.map(key => process.env[key]);
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'fixture-server-key';
  process.env.STORAGE_PROVIDER = 'supabase';
  t.after(() => keys.forEach((key,i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }));
}
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});

test('storage adapter drains bounded pages on retries and only removes the owned prefix', async t => {
  storageEnvironment(t);
  const objects: Record<string,string[]> = {
    'brand-uploads': Array.from({length:101},(_,i)=>`photo-${i}.png`),
    'generated-media': ['video.mp4','kit.zip'],
  };
  let deletes=0;
  t.mock.method(globalThis,'fetch',async(input: string|URL|Request,init?:RequestInit)=>{
    const url = new URL(String(input));
    const body=JSON.parse(String(init?.body));
    const bucket=url.pathname.split('/').at(-1)!;
    assert(bucket in objects);
    if(url.pathname.includes('/object/list/')){
      assert.equal(body.prefix,'owned'); assert.equal(body.offset,0);
      return json(objects[bucket].slice(0,body.limit).map(name=>({name,id:name})));
    }
    assert.equal(init?.method,'DELETE');
    const requested=body.prefixes as string[];
    assert(requested.every(key=>key.startsWith('owned/')));
    assert(requested.length<=100);
    objects[bucket]=objects[bucket].filter(name=>!requested.includes(`owned/${name}`));deletes++;
    return json(requested.map(name=>({name})));
  });
  await assert.rejects(deletionAdapters.deleteWorkspaceStorage('owned'),/another pass/);
  assert.equal(objects['brand-uploads'].length,1);
  assert.equal(objects['generated-media'].length,2,'A retry must finish uploads before advancing buckets');
  await deletionAdapters.deleteWorkspaceStorage('owned');
  assert.deepEqual(objects,{'brand-uploads':[],'generated-media':[]});
  assert.equal(deletes,3);
  await deletionAdapters.deleteWorkspaceStorage('owned');
  assert.equal(deletes,3,'Repeating a completed storage pass must be harmless');
});

test('storage adapter refuses unexpected nested objects and removal failures', async t => {
  storageEnvironment(t);let nested=true,removed=0;
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    const path=new URL(String(input)).pathname;
    if(path.includes('/object/list/')) return json([{name:nested?'folder':'photo.png',id:nested?null:'file'}]);
    removed++;return json({message:'fixture failure'},400);
  });
  await assert.rejects(deletionAdapters.deleteWorkspaceStorage('owned'),/Unexpected storage layout/);
  assert.equal(removed,0);
  nested=false;
  await assert.rejects(deletionAdapters.deleteWorkspaceStorage('owned'),/Storage deletion failed/);
  assert.equal(removed,1);
});

test('provider deletion requires a matching affirmative receipt and never accepts an ambiguous 404', async t => {
  const before={hfKey:config.hfKey,hfSecret:config.hfSecret};
  config.hfKey='fixture-key';config.hfSecret='fixture-secret';t.after(()=>Object.assign(config,before));
  let reply:Response=json({request_id:'owned-request',status:'deleted'});
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    assert.equal(String(input),'https://api.higgsfield.ai/requests/owned-request');
    assert.equal(init?.method,'DELETE');return reply;
  });
  await deletionAdapters.deleteProviderRequest('owned-request');
  for(const response of [json({request_id:'another-request',status:'deleted'}),json({request_id:'owned-request',status:'pending'}),json({},404)]){
    reply=response;await assert.rejects(deletionAdapters.deleteProviderRequest('owned-request'),/unconfirmed/);
  }
});

test('Auth deletion tolerates an already absent user but propagates an uncertain failure',async t=>{
  storageEnvironment(t);let reply=json({});
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    assert.equal(String(input),'https://fixture.supabase.co/auth/v1/admin/users/00000000-0000-4000-8000-000000000001');
    assert.equal(init?.method,'DELETE');return reply;
  });
  await deletionAdapters.deleteAuthUser('00000000-0000-4000-8000-000000000001');
  reply=json({code:'user_not_found',msg:'User not found'},404);
  await deletionAdapters.deleteAuthUser('00000000-0000-4000-8000-000000000001');
  reply=json({code:'unexpected_failure',msg:'fixture error'},400);
  await assert.rejects(deletionAdapters.deleteAuthUser('00000000-0000-4000-8000-000000000001'),/unconfirmed/);
});
