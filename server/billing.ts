import Stripe from 'stripe';
import {createHash} from 'node:crypto';
import type {Database,Queryable} from './db.js';
import {AppError,config} from './config.js';
import {changeCredits} from './credits.js';
import type {User} from '../shared/types.js';

export type BillingMode = 'off' | 'sandbox' | 'live';
export function billingMode(): BillingMode {
 // An explicit mode is authoritative. Legacy configuration is used only when
 // the mode is absent; a typo must fail closed rather than enable checkout.
 const mode=process.env.BILLING_MODE;
 if(mode!==undefined)return mode==='live'||mode==='sandbox'?mode:'off';
 return process.env.ENABLE_BILLING_SANDBOX==='true'?'sandbox':'off';
}
export function billingConfigured(){return billingMode()!=='off'&&!!process.env.STRIPE_API_KEY&&!!process.env.STRIPE_WEBHOOK_SECRET&&!!process.env.STRIPE_STUDIO_PRICE_ID}
export function checkoutReleased() {
 return billingMode() !== 'live' || process.env.ENABLE_LIVE_CHECKOUT === 'true';
}
function client(){
 const key=process.env.STRIPE_API_KEY||'';
 if(!billingConfigured())throw new AppError(503,'Checkout is not configured yet. You have not been charged.');
 const prefix=billingMode()==='live' ? /^[sr]k_live_/ : /^[sr]k_test_/;
 if(!prefix.test(key))throw new AppError(503,'The Stripe key does not match the configured billing environment.');
 return new Stripe(key,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:15000});
}
type BillingAccount={workspace_id:string;customer_id:string|null;subscription_id:string|null;status:string;checkout_id:string|null;last_allowance_invoice_created:string|number;spend_blocked:boolean;spend_block_reason:string|null};
const stripeId=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id;

// This independent hold must not be cleared by later subscription-status events.
// Call inside the workspace-locked spending transaction to serialize with holds.
export async function assertBillingSpendAllowed(db:Queryable,workspaceId:string){
 const account=(await db.query<{spend_blocked:boolean}>('SELECT spend_blocked FROM billing_accounts WHERE workspace_id=$1',[workspaceId])).rows[0];
 if(account?.spend_blocked)throw new AppError(423,'Generation is paused while a payment refund or dispute is reviewed. Contact support.');
}

export type BillingHoldFact={eventId:string;eventType:'charge.refunded'|'charge.dispute.created';customerId:string;reason:'payment_refund'|'payment_dispute'};
export async function applyBillingHold(db:Database,fact:BillingHoldFact){return db.transaction(async tx=>{
 const mapping=(await tx.query<{workspace_id:string}>('SELECT workspace_id FROM billing_accounts WHERE customer_id=$1',[fact.customerId])).rows[0];
 // A shared Stripe account may also receive events for other products/customers.
 if(!mapping)return false;
 await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[mapping.workspace_id]);
 const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1 AND customer_id=$2 FOR UPDATE',[mapping.workspace_id,fact.customerId])).rows[0];
 if(!account)throw new AppError(409,'Billing customer changed. Retry this event.');
 if((await tx.query('SELECT id FROM payment_events WHERE id=$1',[fact.eventId])).rows.length)return false;
 await tx.query('UPDATE billing_accounts SET spend_blocked=true,spend_block_reason=$2 WHERE workspace_id=$1',[mapping.workspace_id,fact.reason]);
 await tx.query('INSERT INTO payment_events(id,type) VALUES($1,$2)',[fact.eventId,fact.eventType]);
 return true;
})}

export type DeletionBillingReader=(customerId:string,checkoutId:string|null)=>Promise<{checkoutStatus:string|null;subscriptionStatuses:string[]}>;
// Read-only reconciliation also covers legacy rows whose checkout ID was never cleared.
const readDeletionBilling:DeletionBillingReader=async(customerId,checkoutId)=>{
 const stripe=client();
 const session=checkoutId?await stripe.checkout.sessions.retrieve(checkoutId,{},{timeout:10000,maxNetworkRetries:0}):null;
 if(session && (stripeId(session.customer)!==customerId || session.livemode!==(billingMode()==='live') || !session.status))throw new Error('Billing identity mismatch');
 const subscriptions=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100},{timeout:10000,maxNetworkRetries:0});
 // Conservatively require review if the complete history cannot be checked in one bounded request.
 if(subscriptions.has_more || subscriptions.data.some(s=>stripeId(s.customer)!==customerId || s.livemode!==(billingMode()==='live')))throw new Error('Billing history incomplete');
 return {checkoutStatus:session?.status??null,subscriptionStatuses:subscriptions.data.map(s=>s.status)};
};
export async function reconcileBillingForDeletion(tx:Queryable,workspaceId:string,read:DeletionBillingReader=readDeletionBilling){
 const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1 FOR UPDATE',[workspaceId])).rows[0];
 if(!account)return;
 if(account.spend_blocked)throw new AppError(409,'A payment refund or dispute needs review before account deletion. Contact support.');
 if(!account.customer_id){
  if(account.checkout_id || account.subscription_id || !['none','canceled','incomplete_expired'].includes(account.status))throw new AppError(409,'Your subscription or checkout needs reconciliation before account deletion.');
  return;
 }
 let current:Awaited<ReturnType<DeletionBillingReader>>;
 try{current=await read(account.customer_id,account.checkout_id);}catch{throw new AppError(409,'Billing status could not be verified. Please retry account deletion shortly.');}
 if(current.checkoutStatus==='open' || current.subscriptionStatuses.some(status=>!['canceled','incomplete_expired'].includes(status)))throw new AppError(409,'Close any pending checkout and cancel your subscription before requesting deletion.');
 if(account.checkout_id && !['expired','complete'].includes(current.checkoutStatus??''))throw new AppError(409,'Checkout status needs reconciliation before account deletion.');
 await tx.query("UPDATE billing_accounts SET checkout_id=NULL,status=$2 WHERE workspace_id=$1",[workspaceId,account.subscription_id?'canceled':'none']);
}

type CheckoutStripe = Pick<Stripe, 'prices' | 'customers' | 'checkout' | 'subscriptions'>;
export async function checkout(db:Database,user:User,getStripe:()=>CheckoutStripe=client){
 if(user.demo)throw new AppError(400,'Create a permanent account before testing a subscription.');
 const stripe=getStripe();
 if (!checkoutReleased()) throw new AppError(503, 'New subscriptions are not open yet. You have not been charged.');
 const price=await stripe.prices.retrieve(process.env.STRIPE_STUDIO_PRICE_ID!);
 if(price.livemode!==(billingMode()==='live')||!price.active||price.currency!=='usd'||price.unit_amount!==3900||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw new AppError(503,'Configure an active $39 USD monthly price in the selected billing environment.');
 return db.transaction(async tx=>{
  // Same lock order as deletion: a checkout cannot open after the workspace freezes.
  await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[user.workspaceId]);
  const frozen=(await tx.query<{deletion_requested_at:unknown}>('SELECT deletion_requested_at FROM workspaces WHERE id=$1',[user.workspaceId])).rows[0];
  if(frozen?.deletion_requested_at)throw new AppError(410,'Account deletion has been requested.');
  await assertBillingSpendAllowed(tx,user.workspaceId);
  await tx.query('INSERT INTO billing_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[user.workspaceId]);
  const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1 FOR UPDATE',[user.workspaceId])).rows[0];
  let customerId=account.customer_id;
  if(!customerId){const customer=await stripe.customers.create({email:user.email,name:user.name},{idempotencyKey:`inkshot-customer:${user.workspaceId}`});customerId=customer.id;await tx.query('UPDATE billing_accounts SET customer_id=$2 WHERE workspace_id=$1',[user.workspaceId,customerId]);}
  if(account.checkout_id){const current=await stripe.checkout.sessions.retrieve(account.checkout_id);if(current.status==='open'&&current.url)return {url:current.url};}
  const subscriptions=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100});
  if(subscriptions.has_more)throw new AppError(409,'Your billing history needs review before opening another subscription. Use Manage subscription or contact support.');
  if(subscriptions.data.some(s=>!['canceled','incomplete_expired'].includes(s.status)))throw new AppError(409,'You already have a subscription or a pending payment. Use Manage subscription.');
  // A provider success can outlive a rolled-back database transaction. Reusing
  // its idempotency key must also reuse every request parameter.
  const attemptKey=`inkshot-checkout:${user.workspaceId}:${account.checkout_id||'initial'}`;
  const suffix=Array.from(createHash('sha256').update(attemptKey).digest().subarray(0,16),b=>String.fromCharCode(97+b%26)).join('');
  const session=await stripe.checkout.sessions.create({mode:'subscription',customer:customerId,line_items:[{price:price.id,quantity:1}],integration_identifier:`inkshot_studio_${suffix}`,success_url:`${config.origin}/studio/billing?checkout=complete`,cancel_url:`${config.origin}/studio/billing?checkout=canceled`},{idempotencyKey:attemptKey});
  await tx.query('UPDATE billing_accounts SET checkout_id=$2 WHERE workspace_id=$1',[user.workspaceId,session.id]);
  if(!session.url)throw new AppError(502,'Checkout did not return a payment page.');return {url:session.url};
 });
}
export async function portal(db:Database,user:User){const stripe=client();const account=(await db.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1',[user.workspaceId])).rows[0];if(!account?.customer_id)throw new AppError(400,'No billing account exists yet.');const session=await stripe.billingPortal.sessions.create({customer:account.customer_id,return_url:`${config.origin}/studio/billing`,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID});return {url:session.url}}

export type PaymentFact={eventId:string;eventType:string;created:number;customerId:string;subscriptionId:string;status:string;invoiceId?:string;invoiceCreated?:number;grantCredits:boolean};
// Called only after signature verification and provider-side object validation.
export async function applyPaymentFact(db:Database,fact:PaymentFact){return db.transaction(async tx=>{
 // Resolve without a row lock, then follow checkout/deletion's workspace →
 // billing order. Revalidate the mapping after both locks, since deletion or
 // reconciliation may have changed it while this transaction waited.
 const mapping=(await tx.query<{workspace_id:string}>('SELECT workspace_id FROM billing_accounts WHERE customer_id=$1',[fact.customerId])).rows[0];
 if(!mapping)throw new AppError(409,'Billing customer is not linked yet. Retry this event.');
 await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[mapping.workspace_id]);
 const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1 AND customer_id=$2 FOR UPDATE',[mapping.workspace_id,fact.customerId])).rows[0];
 if(!account)throw new AppError(409,'Billing customer is not linked yet. Retry this event.');
 if((await tx.query('SELECT id FROM payment_events WHERE id=$1',[fact.eventId])).rows.length)return;
 if(!account.subscription_id||account.subscription_id===fact.subscriptionId||account.status==='canceled')await tx.query('UPDATE billing_accounts SET subscription_id=$2,status=$3,last_event_created=$4 WHERE workspace_id=$1 AND last_event_created<=$4',[account.workspace_id,fact.subscriptionId,fact.status,fact.created]);
 if (fact.grantCredits && fact.invoiceId) {
   const invoiceCreated = fact.invoiceCreated ?? fact.created;
   if (invoiceCreated >= Number(account.last_allowance_invoice_created)) {
     const balance = (await tx.query<{ credits: number }>(
       'SELECT credits FROM workspaces WHERE id=$1 FOR UPDATE', [account.workspace_id],
     )).rows[0].credits;
     // A zero-value ledger entry still consumes an invoice when the wallet is full.
     const applied = await changeCredits(tx, account.workspace_id, Math.max(0, 300 - balance),
       'subscription', billingMode() === 'live' ? 'Studio monthly allowance' : 'Studio monthly allowance · sandbox',
       `stripe-invoice:${fact.invoiceId}`);
     if (applied) await tx.query(
       'UPDATE billing_accounts SET last_allowance_invoice_created=$2 WHERE workspace_id=$1',
       [account.workspace_id, invoiceCreated],
     );
   }
 }
 await tx.query('INSERT INTO payment_events(id,type) VALUES($1,$2)',[fact.eventId,fact.eventType]);
})}
type WebhookStripe=Pick<Stripe,'webhooks'|'subscriptions'|'charges'>;
export async function webhook(db:Database,body:Buffer,signature:string,getStripe:()=>WebhookStripe=client){
 const stripe=getStripe();let event:Stripe.Event;
 try{event=stripe.webhooks.constructEvent(body,signature,process.env.STRIPE_WEBHOOK_SECRET!)}catch{throw new AppError(400,'Invalid Stripe webhook signature.');}
 if(event.livemode!==(billingMode()==='live'))throw new AppError(400,'Payment environment does not match this deployment.');
 if(event.type==='charge.refunded'||event.type==='charge.dispute.created'){
  const charge=event.type==='charge.refunded'
   ? event.data.object
   : await stripe.charges.retrieve(stripeId(event.data.object.charge)!);
  if(charge.livemode!==event.livemode)throw new AppError(400,'Payment environment does not match this deployment.');
  const customerId=stripeId(charge.customer);
  if(customerId)await applyBillingHold(db,{eventId:event.id,eventType:event.type,customerId,reason:event.type==='charge.refunded'?'payment_refund':'payment_dispute'});
  // Cash refunds and dispute outcomes need an operator-reviewed entitlement
  // decision. Never subtract already-spent credits or auto-release a hold here.
  return;
 }
 let subscriptionId:string|undefined;
 let invoice:Stripe.Invoice|undefined;
 if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
  invoice=event.data.object;subscriptionId=stripeId(invoice.parent?.subscription_details?.subscription);
 }else if(event.type.startsWith('customer.subscription.'))subscriptionId=(event.data.object as Stripe.Subscription).id;
 else if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  const session=event.data.object;if(session.mode!=='subscription')return;
  subscriptionId=stripeId(session.subscription);
 }else return;
 if(!subscriptionId)return;
 const subscription=await stripe.subscriptions.retrieve(subscriptionId);
 if(subscription.livemode!==event.livemode)return;
 const customerId=stripeId(subscription.customer);if(!customerId)return;
 const correctPlan=subscription.items.data.some(item=>item.price.id===process.env.STRIPE_STUDIO_PRICE_ID&&item.quantity===1);
 if(!correctPlan)return;
 // A paid invoice may have a discounted or zero amount due to an intentional
 // coupon or customer balance. Entitlement comes from the verified active plan.
 const grantCredits=event.type==='invoice.paid'&&!!invoice&&invoice.status==='paid'&&invoice.currency==='usd'&&['subscription_create','subscription_cycle'].includes(invoice.billing_reason||'')&&subscription.status==='active';
 await applyPaymentFact(db,{eventId:event.id,eventType:event.type,created:event.created,customerId,subscriptionId,status:subscription.status,invoiceId:invoice?.id,invoiceCreated:invoice?.created,grantCredits});
}
