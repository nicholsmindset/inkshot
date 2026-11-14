import Stripe from 'stripe';
import {randomBytes} from 'node:crypto';
import type {Database} from './db.js';
import {AppError,config} from './config.js';
import {changeCredits} from './credits.js';
import type {User} from '../shared/types.js';

export type BillingMode = 'off' | 'sandbox' | 'live';
export function billingMode(): BillingMode {
 if(process.env.BILLING_MODE==='live')return 'live';
 if(process.env.ENABLE_BILLING_SANDBOX==='true'||process.env.BILLING_MODE==='sandbox')return 'sandbox';
 return 'off';
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
type BillingAccount={workspace_id:string;customer_id:string|null;subscription_id:string|null;status:string;checkout_id:string|null;last_allowance_invoice_created:string|number};
const stripeId=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id;

export async function checkout(db:Database,user:User){
 if(user.demo)throw new AppError(400,'Create a permanent account before testing a subscription.');
 const stripe=client();
 if (!checkoutReleased()) throw new AppError(503, 'New subscriptions are not open yet. You have not been charged.');
 const price=await stripe.prices.retrieve(process.env.STRIPE_STUDIO_PRICE_ID!);
 if(price.livemode!==(billingMode()==='live')||!price.active||price.currency!=='usd'||price.unit_amount!==3900||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw new AppError(503,'Configure an active $39 USD monthly price in the selected billing environment.');
 return db.transaction(async tx=>{
  await tx.query('INSERT INTO billing_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[user.workspaceId]);
  const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1 FOR UPDATE',[user.workspaceId])).rows[0];
  let customerId=account.customer_id;
  if(!customerId){const customer=await stripe.customers.create({email:user.email,name:user.name},{idempotencyKey:`inkshot-customer:${user.workspaceId}`});customerId=customer.id;await tx.query('UPDATE billing_accounts SET customer_id=$2 WHERE workspace_id=$1',[user.workspaceId,customerId]);}
  if(account.checkout_id){const current=await stripe.checkout.sessions.retrieve(account.checkout_id);if(current.status==='open'&&current.url)return {url:current.url};}
  const subscriptions=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100});
  if(subscriptions.data.some(s=>!['canceled','incomplete_expired'].includes(s.status)))throw new AppError(409,'You already have a subscription or a pending payment. Use Manage subscription.');
  const suffix=Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join('');
  const session=await stripe.checkout.sessions.create({mode:'subscription',customer:customerId,line_items:[{price:price.id,quantity:1}],integration_identifier:`inkshot_studio_${suffix}`,success_url:`${config.origin}/studio/billing?checkout=complete`,cancel_url:`${config.origin}/studio/billing?checkout=canceled`},{idempotencyKey:`inkshot-checkout:${user.workspaceId}:${account.checkout_id||'initial'}`});
  await tx.query('UPDATE billing_accounts SET checkout_id=$2 WHERE workspace_id=$1',[user.workspaceId,session.id]);
  if(!session.url)throw new AppError(502,'Checkout did not return a payment page.');return {url:session.url};
 });
}
export async function portal(db:Database,user:User){const stripe=client();const account=(await db.query<BillingAccount>('SELECT * FROM billing_accounts WHERE workspace_id=$1',[user.workspaceId])).rows[0];if(!account?.customer_id)throw new AppError(400,'No billing account exists yet.');const session=await stripe.billingPortal.sessions.create({customer:account.customer_id,return_url:`${config.origin}/studio/billing`,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID});return {url:session.url}}

export type PaymentFact={eventId:string;eventType:string;created:number;customerId:string;subscriptionId:string;status:string;invoiceId?:string;invoiceCreated?:number;grantCredits:boolean};
// Called only after signature verification and provider-side object validation.
export async function applyPaymentFact(db:Database,fact:PaymentFact){return db.transaction(async tx=>{
 const account=(await tx.query<BillingAccount>('SELECT * FROM billing_accounts WHERE customer_id=$1 FOR UPDATE',[fact.customerId])).rows[0];
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
export async function webhook(db:Database,body:Buffer,signature:string){
 const stripe=client();let event:Stripe.Event;
 try{event=stripe.webhooks.constructEvent(body,signature,process.env.STRIPE_WEBHOOK_SECRET!)}catch{throw new AppError(400,'Invalid Stripe webhook signature.');}
 if(event.livemode!==(billingMode()==='live'))throw new AppError(400,'Payment environment does not match this deployment.');
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
