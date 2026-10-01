import {createHash} from 'node:crypto';
import type {Database} from './db.js';
import {AppError} from './config.js';
import * as hf from './higgsfield.js';
// Reserve before submission, including ambiguous outcomes. Never release a reservation
// automatically: a timeout may still have incurred a provider charge.
export async function submitBudgeted(db:Database,model:string,input:unknown,key:string){
 const digest=createHash('sha256').update(JSON.stringify({model,input})).digest('hex');
 let reservation=(await db.query<{input_hash:string}>('SELECT input_hash FROM provider_spend WHERE request_key=$1',[key])).rows[0];
 if(!reservation){
  const quote=await hf.estimate(model,input);
  const amount=Number(quote.usd),cap=Number(process.env.HF_DAILY_BUDGET_USD||'0');
  if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(cap)||cap<=0)throw new AppError(503,'A valid generation spending limit is required.');
  await db.transaction(async tx=>{
   // A table lock is portable to the embedded test DB and serializes all reservations.
   await tx.query('LOCK TABLE provider_spend IN EXCLUSIVE MODE');
   reservation=(await tx.query<{input_hash:string}>('SELECT input_hash FROM provider_spend WHERE request_key=$1',[key])).rows[0];
   if(reservation)return;
   const used=Number((await tx.query<{used:string}>("SELECT COALESCE(sum(usd),0)::text AS used FROM provider_spend WHERE created_at >= date_trunc('day',now())")).rows[0].used);
   if(used+amount>cap)throw new AppError(503,'The daily generation spending limit has been reached.');
   await tx.query('INSERT INTO provider_spend(request_key,input_hash,usd) VALUES($1,$2,$3)',[key,digest,amount]);
  });
 }
 if(reservation && reservation.input_hash!==digest)throw new Error('Provider idempotency input changed');
 return hf.submit(model,input,key);
}
