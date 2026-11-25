import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Stripe from 'stripe';
import { applyPaymentFact, assertBillingSpendAllowed, reconcileBillingForDeletion, webhook } from '../server/billing.js';
import { createDatabase } from '../server/db.js';

test('signed refund/dispute events pause spending without changing credits or releasing on renewal', async t => {
  const previousMode = process.env.BILLING_MODE, previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.BILLING_MODE = 'sandbox'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-billing-hold-'));
  const db = await createDatabase(dir, true);
  t.after(async () => {
    if (previousMode === undefined) delete process.env.BILLING_MODE; else process.env.BILLING_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    await db.close(); await rm(dir, { recursive: true, force: true });
  });
  await db.query("INSERT INTO workspaces(id,credits) VALUES ('refund',80),('dispute',80),('other',80)");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('refund','cus_refund'),('dispute','cus_dispute'),('other','cus_other')");
  const verifier = new Stripe('sk_test_fixture').webhooks;
  const fake = {
    webhooks: verifier,
    charges: { retrieve: async (id: string) => {
      assert.equal(id, 'ch_dispute');
      return { id, livemode: false, customer: 'cus_dispute' };
    } },
  } as never;
  const deliver = async (id: string, type: string, object: object, live = false, invalidSignature = false) => {
    const payload = JSON.stringify({ id, type, livemode: live, data: { object } });
    const signature = verifier.generateTestHeaderString({ payload, secret: invalidSignature ? 'wrong-secret' : 'whsec_fixture' });
    return webhook(db, Buffer.from(payload), signature, () => fake);
  };
  const refund = { id: 'ch_refund', customer: 'cus_refund', livemode: false, amount: 3900, amount_refunded: 100 };
  await assert.rejects(deliver('evt_forged', 'charge.refunded', refund, false, true), /Invalid Stripe webhook signature/);
  await assert.rejects(deliver('evt_wrong_mode', 'charge.refunded', {...refund, livemode: true}, true), /environment does not match/);
  await assertBillingSpendAllowed(db, 'refund');
  await deliver('evt_refund', 'charge.refunded', refund);
  await deliver('evt_refund', 'charge.refunded', refund);
  await assert.rejects(assertBillingSpendAllowed(db, 'refund'), /Generation is paused/);
  assert.equal((await db.query("SELECT credits FROM workspaces WHERE id='refund'")).rows[0].credits, 80, 'Partial refund does not guess a credit clawback');
  assert.equal((await db.query("SELECT id FROM payment_events WHERE id='evt_refund'")).rows.length, 1);
  await deliver('evt_dispute', 'charge.dispute.created', { id: 'dp_fixture', charge: 'ch_dispute' });
  await assert.rejects(assertBillingSpendAllowed(db, 'dispute'), /Generation is paused/);
  await assertBillingSpendAllowed(db, 'other');
  await assertBillingSpendAllowed(db, 'new-workspace-without-billing');
  assert.deepEqual((await db.query("SELECT workspace_id,spend_block_reason FROM billing_accounts WHERE spend_blocked=true ORDER BY workspace_id")).rows, [
    { workspace_id: 'dispute', spend_block_reason: 'payment_dispute' },
    { workspace_id: 'refund', spend_block_reason: 'payment_refund' },
  ]);
  await applyPaymentFact(db, { eventId: 'evt_renewal', eventType: 'invoice.paid', created: 5, customerId: 'cus_refund', subscriptionId: 'sub_refund', status: 'active', invoiceId: 'in_renewal', grantCredits: true });
  await assert.rejects(assertBillingSpendAllowed(db, 'refund'), /Generation is paused/, 'Later paid invoice must not clear manual review');
  await assert.rejects(db.transaction(tx => reconcileBillingForDeletion(tx, 'refund', async () => ({ checkoutStatus: null, subscriptionStatuses: [] }))), /needs review before account deletion/);
  // A shared Stripe account's unrelated customer does not freeze an Inkshot workspace.
  await deliver('evt_other_product', 'charge.refunded', { id: 'ch_unlinked', customer: 'cus_not_inkshot', livemode: false });
  await assertBillingSpendAllowed(db, 'other');
});
