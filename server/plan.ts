import type {Queryable} from './db.js';
import {AppError} from './config.js';

// Commercial rules live here, read from the environment with safe defaults.
// The frontend never hard-codes them: it reads /api/plan and /api/studio.
// Safe operator pause: new paid generation is refused with a clear message, while the app
// stays up and in-flight work finishes. Unlike flipping the live billing or generation
// modes (which a live-bound database refuses to start with), this can be toggled at any time.
export function assertGenerationNotPaused(env: NodeJS.ProcessEnv = process.env) {
  if (env.GENERATION_PAUSED === 'true') throw new AppError(503, 'New generation is paused for a short time. Your credits are untouched. Please try again soon.');
}

export type PlanConfig = {
  name: string;
  currency: string;          // primary currency, lower-case ISO 4217, e.g. "usd"
  priceAmount: number;       // primary price in minor units (cents), must equal the Stripe price
  prices: { currency: string; amount: number }[]; // every currency we sell in, primary first
  credits: number;           // monthly top-up balance
  kitCredits: number;
  versionCredits: {video: number; image: number; post: number};
  videoRegenMonthlyCap: number;
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

export function planConfig(env: NodeJS.ProcessEnv = process.env): PlanConfig {
  const currency = (env.PLAN_CURRENCY?.trim() || 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error('PLAN_CURRENCY must be a three-letter currency code.');
  const versionCredits = {
    video: int(env, 'CREDIT_COST_VIDEO', 26, 1, 1000),
    image: int(env, 'CREDIT_COST_IMAGE', 5, 1, 1000),
    post: int(env, 'CREDIT_COST_POST', 2, 1, 1000),
  };
  // A kit is three of each asset; the third post carries one extra credit so the
  // default kit totals 100. Fail closed if the configured totals disagree.
  const kitCredits = int(env, 'KIT_CREDITS', 100, 1, 100000);
  const expected = 3 * (versionCredits.video + versionCredits.image + versionCredits.post) + 1;
  if (kitCredits !== expected) throw new Error(`KIT_CREDITS (${kitCredits}) must equal 3 x (video + image + post) + 1 = ${expected}.`);
  const prices = parsePairs(env.PLAN_PRICES, 'PLAN_PRICES').map(([c, v]) => ({ currency: c, amount: Number(v) }));
  for (const p of prices) if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > 10000000) throw new Error(`PLAN_PRICES has an invalid amount for ${p.currency}.`);
  const single = int(env, 'PLAN_PRICE_AMOUNT', 3900, 1, 10000000);
  // PLAN_PRICES ("usd:7900,sgd:10900") sells in several currencies; PLAN_CURRENCY names the primary one.
  const primaryEntry = (env.PLAN_CURRENCY?.trim() ? prices.find(p => p.currency === currency) : undefined) ?? prices[0] ?? { currency, amount: single };
  const ordered = prices.length ? [primaryEntry, ...prices.filter(p => p !== primaryEntry)] : [primaryEntry];
  return {
    name: 'Studio',
    currency: primaryEntry.currency,
    priceAmount: primaryEntry.amount,
    prices: ordered,
    credits: int(env, 'PLAN_CREDITS', 300, 1, 100000),
    kitCredits,
    versionCredits,
    videoRegenMonthlyCap: int(env, 'VIDEO_REGEN_MONTHLY_CAP', 8, 0, 1000),
  };
}

function parsePairs(raw: string | undefined, name: string) {
  if (!raw?.trim()) return [] as [string, string][];
  return raw.split(',').map(part => {
    const [c, v, ...rest] = part.trim().split(':');
    if (!c || !v || rest.length || !/^[a-z]{3}$/i.test(c)) throw new Error(`${name} must look like usd:7900,sgd:10900.`);
    return [c.toLowerCase(), v.trim()] as [string, string];
  });
}

// The Stripe price object. Existing deployments already use STRIPE_STUDIO_PRICE_ID;
// PLAN_PRICE_ID is accepted as an alias.
export const stripePriceId = (env: NodeJS.ProcessEnv = process.env) =>
  env.PLAN_PRICE_ID?.trim() || env.STRIPE_STUDIO_PRICE_ID?.trim() || '';
// Per-currency Stripe price IDs: STRIPE_PRICE_IDS="usd:price_x,sgd:price_y". The legacy single ID is the primary currency's.
export function stripePriceIds(env: NodeJS.ProcessEnv = process.env) {
  const plan = planConfig(env);
  const map = new Map<string, string>(parsePairs(env.STRIPE_PRICE_IDS, 'STRIPE_PRICE_IDS'));
  const legacy = stripePriceId(env);
  if (legacy && !map.has(plan.currency)) map.set(plan.currency, legacy);
  return map;
}
export const allStripePriceIds = (env: NodeJS.ProcessEnv = process.env) => [...stripePriceIds(env).values()];
export const configuredCurrencies = (env: NodeJS.ProcessEnv = process.env) => planConfig(env).prices.map(p => p.currency);
export const currencyForMarket = (market: string) => ({ SG: 'sgd', US: 'usd', CA: 'cad', AU: 'aud' } as Record<string, string>)[market] ?? 'usd';
// What a workspace with this market is charged: its own currency if we sell in it and have a price object for it, else the primary.
export function resolveBilling(market: string, env: NodeJS.ProcessEnv = process.env) {
  const plan = planConfig(env), ids = stripePriceIds(env), wanted = currencyForMarket(market);
  const price = plan.prices.find(p => p.currency === wanted);
  if (price && ids.get(wanted)) return { currency: price.currency, amount: price.amount, priceId: ids.get(wanted)! };
  return { currency: plan.currency, amount: plan.priceAmount, priceId: ids.get(plan.currency) ?? '' };
}
// Only advertise currencies that can actually be charged (they have a Stripe price); the rest fall back to the primary.
const sellable = (plan: PlanConfig, env: NodeJS.ProcessEnv) => { const ids = stripePriceIds(env); return plan.prices.filter(p => p.currency === plan.currency || ids.has(p.currency)); };
export const publicPlan = (env: NodeJS.ProcessEnv = process.env) => { const plan = planConfig(env); return { ...plan, prices: sellable(plan, env) }; };
export const planForMarket = (market: string, env: NodeJS.ProcessEnv = process.env) => {
  const plan = planConfig(env), resolved = resolveBilling(market, env);
  return { ...plan, prices: sellable(plan, env), currency: resolved.currency, priceAmount: resolved.amount, localCurrencyUnavailable: currencyForMarket(market) !== resolved.currency };
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

// Regenerations reset at each subscription renewal (the last paid allowance
// invoice, advanced one month at a time if a renewal is late), otherwise on the
// first day of the calendar month (UTC).
export async function regenPeriod(db: Queryable, workspaceId: string, now = new Date()) {
  const account = (await db.query<{t: string | number; status: string}>(
    'SELECT last_allowance_invoice_created AS t,status FROM billing_accounts WHERE workspace_id=$1', [workspaceId])).rows[0];
  const anchorSeconds = Number(account?.t ?? 0);
  if (anchorSeconds > 0 && !['none', 'canceled', 'incomplete_expired'].includes(account!.status)) {
    const anchor = new Date(anchorSeconds * 1000);
    let k = 0;
    while (addMonths(anchor, k + 1) <= now) k++;
    if (anchor <= now) return {start: addMonths(anchor, k), resets: addMonths(anchor, k + 1)};
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {start, resets: addMonths(start, 1)};
}

export async function videoRegenUsage(db: Queryable, workspaceId: string, now = new Date()) {
  const cap = planConfig().videoRegenMonthlyCap;
  const {start, resets} = await regenPeriod(db, workspaceId, now);
  // Failed versions are refunded and do not use the allowance.
  const used = Number((await db.query<{n: string}>(
    `SELECT count(*)::text AS n FROM versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.workspace_id=$1 AND a.kind='video' AND v.n>1 AND v.credit_cost>0
        AND v.status<>'failed' AND v.created_at>=$2`, [workspaceId, start.toISOString()])).rows[0].n);
  return {used, cap, resetsAt: resets.toISOString()};
}

// Call inside the workspace-locked transaction that reserves the credits.
export async function assertVideoRegenAllowed(db: Queryable, workspaceId: string, now = new Date()) {
  const usage = await videoRegenUsage(db, workspaceId, now);
  if (usage.used >= usage.cap) {
    const date = new Date(usage.resetsAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
    throw new AppError(429, `You've used all ${usage.cap} video regenerations this month. They reset on ${date}.`);
  }
}
