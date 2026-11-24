import type {Queryable} from './db.js';
import {AppError} from './config.js';

// Commercial rules live here, read from the environment with safe defaults.
// The frontend never hard-codes them: it reads /api/plan and /api/studio.
export type PlanConfig = {
  name: string;
  currency: string;          // lower-case ISO 4217, e.g. "usd" or "sgd"
  priceAmount: number;       // minor units (cents), must equal the Stripe price
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
  return {
    name: 'Studio',
    currency,
    priceAmount: int(env, 'PLAN_PRICE_AMOUNT', 3900, 1, 10000000),
    credits: int(env, 'PLAN_CREDITS', 300, 1, 100000),
    kitCredits,
    versionCredits,
    videoRegenMonthlyCap: int(env, 'VIDEO_REGEN_MONTHLY_CAP', 8, 0, 1000),
  };
}

// The Stripe price object. Existing deployments already use STRIPE_STUDIO_PRICE_ID;
// PLAN_PRICE_ID is accepted as an alias.
export const stripePriceId = (env: NodeJS.ProcessEnv = process.env) =>
  env.PLAN_PRICE_ID?.trim() || env.STRIPE_STUDIO_PRICE_ID?.trim() || '';

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
