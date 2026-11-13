import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyPaymentFact, type PaymentFact } from "../server/billing";
import { changeCredits } from "../server/credits";
import { createDatabase } from "../server/db";

test("a recovered renewal grants its allowance once up to the 300-credit balance cap", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inkshot-renewal-"));
  const db = await createDatabase(dir, true);
  t.after(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await db.query("INSERT INTO workspaces (id) VALUES ('renewal')");
  await db.query("INSERT INTO billing_accounts (workspace_id, customer_id) VALUES ('renewal', 'cus_renewal')");
  const fact: PaymentFact = {
    eventId: "evt_initial", eventType: "invoice.paid", created: 100,
    customerId: "cus_renewal", subscriptionId: "sub_renewal",
    invoiceId: "in_initial", status: "active", grantCredits: true,
  };
  const balance = async () => (await db.query<{ credits: number }>(
    "SELECT credits FROM workspaces WHERE id='renewal'",
  )).rows[0].credits;
  await applyPaymentFact(db, fact);
  assert.equal(await balance(), 300);

  const spend = (amount: number, key: string) => db.transaction(tx =>
    changeCredits(tx, "renewal", -amount, "generation", "Kit", key));
  await spend(100, "kit-1");
  await applyPaymentFact(db, {
    ...fact, eventId: "evt_failed", eventType: "invoice.payment_failed",
    invoiceId: "in_renewal", created: 200, status: "past_due", grantCredits: false,
  });
  assert.equal(await balance(), 200);

  const recovered = { ...fact, eventId: "evt_recovered", invoiceId: "in_renewal", created: 300 };
  await applyPaymentFact(db, recovered);
  assert.equal(await balance(), 300);
  const alreadyFull = { ...recovered, eventId: "evt_full", invoiceId: "in_full", created: 400 };
  await applyPaymentFact(db, alreadyFull);
  await spend(100, "kit-2");
  await applyPaymentFact(db, { ...recovered, eventId: "evt_repeat" });
  await applyPaymentFact(db, { ...alreadyFull, eventId: "evt_full_repeat" });
  // An older, previously unseen invoice can arrive in a newly created webhook event.
  await applyPaymentFact(db, { ...recovered, eventId: "evt_late", invoiceId: "in_late", invoiceCreated: 250, created: 500 });
  assert.equal(await balance(), 200);
  const ledger = await db.query<{ event_key: string; amount: number }>(
    "SELECT event_key, amount FROM ledger WHERE workspace_id='renewal' AND kind='subscription' ORDER BY event_key",
  );
  assert.deepEqual(ledger.rows.map(({ event_key, amount }) => [event_key, amount]), [
    ["stripe-invoice:in_full", 0],
    ["stripe-invoice:in_initial", 300],
    ["stripe-invoice:in_renewal", 100],
  ]);
});
