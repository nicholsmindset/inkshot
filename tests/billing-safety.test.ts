import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyPaymentFact, billingMode, checkout } from '../server/billing.js';
import { createDatabase, type Database } from '../server/db.js';

test('explicit billing mode cannot be enabled by the legacy sandbox flag', () => {
  const originalMode = process.env.BILLING_MODE;
  const originalLegacy = process.env.ENABLE_BILLING_SANDBOX;
  try {
    for (const legacy of ['true', 'false']) {
      process.env.ENABLE_BILLING_SANDBOX = legacy;
      for (const mode of ['off', '', 'invalid', 'sandbox', 'live']) {
        process.env.BILLING_MODE = mode;
        assert.equal(billingMode(), mode === 'sandbox' || mode === 'live' ? mode : 'off');
      }
      delete process.env.BILLING_MODE;
      assert.equal(billingMode(), legacy === 'true' ? 'sandbox' : 'off');
    }
  } finally {
    if (originalMode === undefined) delete process.env.BILLING_MODE; else process.env.BILLING_MODE = originalMode;
    if (originalLegacy === undefined) delete process.env.ENABLE_BILLING_SANDBOX; else process.env.ENABLE_BILLING_SANDBOX = originalLegacy;
  }
});

test('incomplete subscription history refuses another checkout before creating a session', async t => {
  const previous = process.env.BILLING_MODE;
  process.env.BILLING_MODE = 'sandbox';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-billing-safety-'));
  const db = await createDatabase(dir, true);
  t.after(async () => {
    if (previous === undefined) delete process.env.BILLING_MODE; else process.env.BILLING_MODE = previous;
    await db.close(); await rm(dir, { recursive: true, force: true });
  });
  await db.query("INSERT INTO workspaces(id) VALUES ('billing-safety')");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('billing-safety','cus_safety')");
  let created = 0;
  const stripe = {
    prices: { retrieve: async () => ({ livemode: false, active: true, currency: 'usd', unit_amount: 3900, recurring: { interval: 'month', interval_count: 1 } }) },
    subscriptions: { list: async () => ({ has_more: true, data: Array.from({length: 100}, () => ({ status: 'canceled' })) }) },
    checkout: { sessions: { create: async () => { created++; return { url: 'https://checkout.example.test' }; } } },
  } as never;
  await assert.rejects(checkout(db, { id: 'merchant', workspaceId: 'billing-safety', name: 'Merchant', email: 'merchant@example.test', demo: false }, () => stripe), /billing history needs review/);
  assert.equal(created, 0);
  assert.equal((await db.query("SELECT checkout_id FROM billing_accounts WHERE workspace_id='billing-safety'")).rows[0].checkout_id, null);
});

test('payment facts lock workspace before billing and revalidate customer ownership', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-payment-lock-'));
  const db = await createDatabase(dir, true);
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  await db.query("INSERT INTO workspaces(id) VALUES ('payment-lock')");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('payment-lock','cus_lock')");
  const locks: string[] = [];
  const observed: Database = { ...db, transaction: fn => db.transaction(tx => fn({
    query: async (sql, params) => {
      if (sql.includes('FOR UPDATE')) locks.push(sql);
      return tx.query(sql, params);
    },
  })) };
  await applyPaymentFact(observed, { eventId: 'evt_lock', eventType: 'invoice.paid', created: 1, customerId: 'cus_lock', subscriptionId: 'sub_lock', status: 'active', invoiceId: 'in_lock', grantCredits: true });
  assert.match(locks[0], /FROM workspaces/);
  assert.match(locks[1], /FROM billing_accounts WHERE workspace_id=\$1 AND customer_id=\$2/);
  assert.equal((await db.query("SELECT credits FROM workspaces WHERE id='payment-lock'")).rows[0].credits, 300);

  // Simulate the mapping disappearing between discovery and lock acquisition.
  // The event must be retried rather than credited to a stale customer mapping.
  const changed: Database = { ...db, transaction: fn => db.transaction(tx => fn({
    query: async (sql, params) => {
      if (sql === 'SELECT id FROM workspaces WHERE id=$1 FOR UPDATE')
        await tx.query("UPDATE billing_accounts SET customer_id='cus_replaced' WHERE workspace_id='payment-lock'");
      return tx.query(sql, params);
    },
  })) };
  await assert.rejects(applyPaymentFact(changed, { eventId: 'evt_stale', eventType: 'invoice.paid', created: 2, customerId: 'cus_lock', subscriptionId: 'sub_lock', status: 'active', invoiceId: 'in_stale', grantCredits: true }), /Billing customer is not linked/);
  assert.equal((await db.query("SELECT id FROM payment_events WHERE id='evt_stale'")).rows.length, 0);
});
