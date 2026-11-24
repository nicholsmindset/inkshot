import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyBillingHold } from '../server/billing.js';
import { createDatabase } from '../server/db.js';
import { submitBudgeted } from '../server/provider-budget.js';

test('payment hold blocks new provider reservations but preserves existing receipt recovery', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-provider-holds-'));
  const db = await createDatabase(dir, true);
  const cap = process.env.HF_DAILY_BUDGET_USD;
  process.env.HF_DAILY_BUDGET_USD = '20';
  t.after(async () => {
    if (cap === undefined) delete process.env.HF_DAILY_BUDGET_USD; else process.env.HF_DAILY_BUDGET_USD = cap;
    await db.close(); await rm(dir, { recursive: true, force: true });
  });
  await db.query("INSERT INTO workspaces(id) VALUES ('held'),('other')");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('held','cus_held'),('other','cus_other')");
  let submissions = 0, estimates = 0;
  const accepted = new Map<string, string>();
  const provider = {
    estimate: async () => { estimates++; return { usd: '1', credits: '1' }; },
    submit: async (_model: string, _input: unknown, key: string) => {
      submissions++;
      const existing = accepted.get(key);
      if (existing) return { request_id: existing, status: 'queued' };
      const receipt = `receipt-${key}`;
      accepted.set(key, receipt);
      if (key === 'ambiguous') throw new Error('Lost accepted response');
      return { request_id: receipt, status: 'queued' };
    },
  };
  const send = (key: string, workspace = 'held', input = { prompt: 'Approved scene' }) =>
    submitBudgeted(db, 'fixture-model', input, key, provider, workspace);
  assert.deepEqual(await send('known'), { request_id: 'receipt-known' });
  await assert.rejects(send('ambiguous'), /Lost accepted response/);
  await applyBillingHold(db, { eventId: 'evt_hold', eventType: 'charge.refunded', customerId: 'cus_held', reason: 'payment_refund' });
  const estimatesBeforeRecovery = estimates, submissionsBeforeRecovery = submissions;
  assert.deepEqual(await send('known'), { request_id: 'receipt-known' });
  assert.equal(estimates, estimatesBeforeRecovery);
  assert.equal(submissions, submissionsBeforeRecovery, 'Known receipt needs no provider submission');
  await assert.rejects(send('new-intent'), /Generation is paused/);
  assert.equal(submissions, submissionsBeforeRecovery, 'A held workspace must not start a new paid intent');
  assert.equal((await db.query("SELECT request_key FROM provider_spend WHERE request_key='new-intent'")).rows.length, 0);
  // An unchanged same-day ambiguous attempt uses its existing idempotency key.
  // This reconciles prior acceptance rather than creating a new provider intent.
  assert.deepEqual(await send('ambiguous'), { request_id: 'receipt-ambiguous' });
  assert.equal(accepted.size, 2);
  assert.equal((await db.query('SELECT request_key FROM provider_spend')).rows.length, 2);
  await assert.rejects(send('known', 'held', { prompt: 'Changed scene' }), /idempotency input changed/);
  assert.deepEqual(await send('other-intent', 'other'), { request_id: 'receipt-other-intent' });
  assert.equal(accepted.size, 3, 'Another workspace remains eligible');

  // Simulate the hold arriving after estimate but before reservation locking.
  const afterQuote = {
    ...provider,
    estimate: async () => {
      await applyBillingHold(db, { eventId: 'evt_quote_hold', eventType: 'charge.dispute.created', customerId: 'cus_other', reason: 'payment_dispute' });
      return { usd: '1', credits: '1' };
    },
  };
  const beforeRace = submissions;
  await assert.rejects(submitBudgeted(db, 'fixture-model', { prompt: 'Approved scene' }, 'race', afterQuote, 'other'), /Generation is paused/);
  assert.equal(submissions, beforeRace);
  assert.equal((await db.query("SELECT request_key FROM provider_spend WHERE request_key='race'")).rows.length, 0);
});
