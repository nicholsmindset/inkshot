import type {Queryable} from './db.js';

type EventRow={workspace_id:string;event:string;campaign_id:string|null;asset_id:string|null;props:Record<string,unknown>;created_at:string|Date;user_id:string|null};
export type MerchantReport={
  workspaceId:string;email:string|null;signedUpAt:string|null;
  minutesToApprovedCampaign:number|null;briefAcceptedPct:number|null;kitsApproved:number;
  publishableAssetsPerKit:number|null;estimatedProviderCostPerKitUsd:number|null;
  returningWithin30Days:boolean;paid:boolean;failureReasons:Record<string,number>;
};
export type PilotReport={merchants:MerchantReport[];overall:{
  merchants:number;paidMerchants:number;conversionToPaidPct:number|null;
  medianMinutesToApprovedCampaign:number|null;briefAcceptedPct:number|null;
  publishableAssetsPerKit:number|null;estimatedProviderCostPerKitUsd:number|null;
  returningWithin30Days:number;failureReasons:Record<string,number>;
};definitions:string[]};

const ms=(value:string|Date)=>new Date(value).getTime();
const median=(values:number[])=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const round=(value:number|null,digits=1)=>value===null?null:Math.round(value*10**digits)/10**digits;
const add=(into:Record<string,number>,key:string)=>{into[key]=(into[key]??0)+1;};

export async function buildPilotReport(db:Queryable,options:{since?:Date}={}):Promise<PilotReport>{
  const events=(await db.query<EventRow>('SELECT workspace_id,user_id,event,campaign_id,asset_id,props,created_at FROM product_events ORDER BY created_at')).rows
    .filter(e=>!options.since||ms(e.created_at)>=options.since.getTime());
  const users=(await db.query<{workspace_id:string;email:string}>("SELECT workspace_id,email FROM users WHERE demo=false")).rows;
  // provider_spend rows are our reservation estimates, keyed "<versionId>:<kind>".
  const spend=(await db.query<{workspace_id:string;campaign_id:string;usd:string}>(
    `SELECT v.workspace_id,a.campaign_id,sum(ps.usd)::text AS usd FROM provider_spend ps
       JOIN versions v ON ps.request_key LIKE v.id||':%' JOIN assets a ON a.id=v.asset_id GROUP BY v.workspace_id,a.campaign_id`)).rows;
  const emails=new Map(users.map(u=>[u.workspace_id,u.email]));
  const byWorkspace=new Map<string,EventRow[]>();
  for(const e of events)(byWorkspace.get(e.workspace_id)??byWorkspace.set(e.workspace_id,[]).get(e.workspace_id)!).push(e);

  const merchants:MerchantReport[]=[];
  const allFailures:Record<string,number>={};
  let editedTotal=0,fieldTotal=0;
  for(const [workspaceId,list] of byWorkspace){
    const first=(name:string)=>list.find(e=>e.event===name);
    const read=first('website_read_started'),approved=first('campaign_approved'),signup=first('signup_completed');
    const minutes=read&&approved&&ms(approved.created_at)>=ms(read.created_at)?(ms(approved.created_at)-ms(read.created_at))/60000:null;
    const edits=[...list].reverse().find(e=>e.event==='brief_fields_edited');
    const total=Number(edits?.props.total??0),edited=Number(edits?.props.edited??0);
    if(total>0){editedTotal+=edited;fieldTotal+=total;}
    const kits=[...new Set(list.filter(e=>e.event==='campaign_approved').map(e=>e.campaign_id!))];
    // Latest answer per version counts; an asset is publishable if any version of it was answered "yes".
    const answers=new Map<string,{asset:string|null;campaign:string|null;answer:string}>();
    for(const e of list)if(e.event==='publish_answer')answers.set(String(e.props.versionId),{asset:e.asset_id,campaign:e.campaign_id,answer:String(e.props.answer)});
    const publishable=new Map<string,Set<string>>();
    for(const a of answers.values())if(a.answer!=='no'&&a.campaign&&a.asset)(publishable.get(a.campaign)??publishable.set(a.campaign,new Set()).get(a.campaign)!).add(a.asset);
    const perKit=kits.map(k=>publishable.get(k)?.size??0);
    const costs=spend.filter(s=>s.workspace_id===workspaceId&&kits.includes(s.campaign_id)).map(s=>Number(s.usd));
    const failureReasons:Record<string,number>={};
    for(const e of list){
      if(e.event==='website_read_failed')add(failureReasons,`website:${String(e.props.reason)}`);
      if(e.event==='generation_failed')add(failureReasons,`generation:${String(e.props.reason)}`);
    }
    for(const [k,v] of Object.entries(failureReasons))allFailures[k]=(allFailures[k]??0)+v;
    const start=signup?ms(signup.created_at):null;
    const returning=start!==null&&list.some(e=>ms(e.created_at)-start>=24*3600e3&&ms(e.created_at)-start<=30*24*3600e3
      &&new Date(e.created_at).toISOString().slice(0,10)!==new Date(start).toISOString().slice(0,10));
    merchants.push({workspaceId,email:emails.get(workspaceId)??null,signedUpAt:signup?new Date(signup.created_at).toISOString():null,
      minutesToApprovedCampaign:round(minutes),briefAcceptedPct:total>0?round(100*(total-edited)/total):null,kitsApproved:kits.length,
      publishableAssetsPerKit:round(mean(perKit)),estimatedProviderCostPerKitUsd:round(mean(costs),2),
      returningWithin30Days:!!returning,paid:!!first('checkout_completed'),failureReasons});
  }
  const signedUp=merchants.filter(m=>m.signedUpAt).length;
  const paid=merchants.filter(m=>m.paid).length;
  const defined=<T>(values:(T|null)[])=>values.filter((v):v is T=>v!==null);
  return {merchants,overall:{
    merchants:merchants.length,paidMerchants:paid,conversionToPaidPct:signedUp?round(100*paid/signedUp):null,
    medianMinutesToApprovedCampaign:round(median(defined(merchants.map(m=>m.minutesToApprovedCampaign)))),
    briefAcceptedPct:fieldTotal>0?round(100*(fieldTotal-editedTotal)/fieldTotal):null,
    publishableAssetsPerKit:round(mean(defined(merchants.map(m=>m.publishableAssetsPerKit)))),
    estimatedProviderCostPerKitUsd:round(mean(defined(merchants.map(m=>m.estimatedProviderCostPerKitUsd))),2),
    returningWithin30Days:merchants.filter(m=>m.returningWithin30Days).length,failureReasons:allFailures,
  },definitions:[
    'Time to approved campaign: first website read started to first campaign approved, per merchant.',
    'Brief fields accepted: extracted fields still unchanged at the latest brief save.',
    'Publishable assets per kit: assets answered "Yes as-is" or "Yes with edits" ("Would you publish this?"), averaged over approved kits.',
    'Provider cost: our provider_spend reservation estimates, not invoices. Reconcile monthly against the Higgsfield CSV.',
    'Returning: activity on a different calendar day, at least 24 hours and at most 30 days after signup.',
    'Posted results are self-reported and correlational; they are not included here.',
  ]};
}
