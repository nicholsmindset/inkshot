import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBillingHold } from '../server/billing.js';
import { emptyBrand } from '../server/brand.js';
import { writeBrief, writeConcepts } from '../server/claude.js';
import { config } from '../server/config.js';
import { createDatabase } from '../server/db.js';

test('payment hold blocks paid writing before usage reservation or provider request', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-writing-holds-'));
  const db = await createDatabase(dir, true);
  const oldMode = config.mode, oldKey = config.openrouterKey;
  const names = ['WRITING_DAILY_REQUEST_LIMIT', 'WRITING_WORKSPACE_DAILY_REQUEST_LIMIT'] as const;
  const saved = names.map(name => process.env[name]);
  t.after(async () => {
    config.mode = oldMode; config.openrouterKey = oldKey;
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    await db.close(); await rm(dir, { recursive: true, force: true });
  });
  config.mode = 'live'; config.openrouterKey = 'test-fixture';
  process.env.WRITING_DAILY_REQUEST_LIMIT = '10';
  process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT = '5';
  const transport = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 502 }));
  await db.query("INSERT INTO workspaces(id) VALUES ('held'),('other')");
  await db.query("INSERT INTO billing_accounts(workspace_id,customer_id) VALUES ('held','cus_held')");
  await applyBillingHold(db, { eventId: 'evt_hold', eventType: 'charge.dispute.created', customerId: 'cus_held', reason: 'payment_dispute' });
  await assert.rejects(writeBrief(db, 'held', []), /Generation is paused/);
  await assert.rejects(writeConcepts(db, 'held', emptyBrand, 'Sales', ''), /Generation is paused/);
  assert.equal(transport.mock.callCount(), 0);
  assert.deepEqual((await db.query('SELECT scope FROM writing_daily_usage')).rows, []);
  await assert.rejects(writeBrief(db, 'other', []), /provider status 502/);
  assert.equal(transport.mock.callCount(), 1);
  assert.deepEqual((await db.query('SELECT scope,requests FROM writing_daily_usage ORDER BY scope')).rows,
    [{ scope: 'global', requests: 1 }, { scope: 'workspace:other', requests: 1 }]);
});
