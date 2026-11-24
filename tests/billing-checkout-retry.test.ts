import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkout } from '../server/billing';
import { createDatabase, type Database } from '../server/db';

test('checkout recovers the same provider session after its database transaction rolls back', async t => {
  const previous = process.env.BILLING_MODE;
  process.env.BILLING_MODE = 'sandbox';
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkshot-checkout-retry-'));
  const db = await createDatabase(directory, true);
  t.after(async () => {
    if (previous === undefined) delete process.env.BILLING_MODE;
    else process.env.BILLING_MODE = previous;
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await db.query("INSERT INTO workspaces(id) VALUES ('checkout-retry')");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('checkout-retry','cus_fixture')");
  const user = { id: 'user-fixture', workspaceId: 'checkout-retry', name: 'Merchant', email: 'merchant@example.test', demo: false };
  const sessions = new Map<string, { id: string; status: string; url: string }>();
  const attempts = new Map<string, { parameters: string; sessionId: string }>();
  let createCalls = 0;
  // Mimic Stripe's same-key/same-parameters contract. A new random parameter on
  // the recovery attempt fails here even though no duplicate session is made.
  const stripe = {
    prices: { retrieve: async () => ({ id: 'price_fixture', livemode: false, active: true, currency: 'usd', unit_amount: 3900, recurring: { interval: 'month', interval_count: 1 } }) },
    subscriptions: { list: async () => ({ data: [] }) },
    customers: { create: async () => { throw new Error('Existing customer must be reused'); } },
    checkout: { sessions: {
      retrieve: async (id: string) => sessions.get(id),
      create: async (parameters: unknown, options: { idempotencyKey: string }) => {
        createCalls++;
        const saved = attempts.get(options.idempotencyKey);
        if (saved) {
          assert.equal(JSON.stringify(parameters), saved.parameters, 'Idempotent retry changed its request parameters');
          return sessions.get(saved.sessionId);
        }
        const id = `cs_fixture_${sessions.size + 1}`;
        const session = { id, status: 'open', url: `https://checkout.example.test/${id}` };
        sessions.set(id, session);
        attempts.set(options.idempotencyKey, { parameters: JSON.stringify(parameters), sessionId: id });
        return session;
      },
    } },
  } as never;
  const rollbackAfterProvider: Database = {
    ...db,
    transaction: fn => db.transaction(async tx => {
      await fn(tx);
      throw new Error('Simulated failure before commit');
    }),
  };
  await assert.rejects(checkout(rollbackAfterProvider, user, () => stripe), /Simulated failure before commit/);
  assert.equal(sessions.size, 1, 'Provider session was created before the transaction failed');
  assert.equal((await db.query<{ checkout_id: string | null }>("SELECT checkout_id FROM billing_accounts WHERE workspace_id='checkout-retry'")).rows[0].checkout_id, null);

  const recovered = await checkout(db, user, () => stripe);
  assert.equal(recovered.url, 'https://checkout.example.test/cs_fixture_1');
  assert.equal(sessions.size, 1);
  assert.equal(createCalls, 2);
  assert.equal((await checkout(db, user, () => stripe)).url, recovered.url);
  assert.equal(createCalls, 2, 'A saved open session is returned without another create');

  sessions.get('cs_fixture_1')!.status = 'expired';
  const replacement = await checkout(db, user, () => stripe);
  assert.equal(replacement.url, 'https://checkout.example.test/cs_fixture_2');
  assert.equal(attempts.size, 2, 'An expired session starts a distinct attempt');
  assert.equal(sessions.size, 2);
});
