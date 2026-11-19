import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { demoBrand } from '../server/brand.js';
import { assertApprovedClaims, assertVisualClaims, requireOwnedCertificate } from '../server/claims.js';
import { groundBrief } from '../server/claude.js';
import { runWorkerOnce } from '../server/worker.js';
import { renderMedia } from '../server/render.js';
import type { Brand } from '../shared/types.js';

const attested: Brand = { ...demoBrand, certifications: { muisHalal: 'attested', certificateId: randomUUID() } };

test('certification copy fails closed, including normalized and multilingual wording', () => {
  for (const text of ['Halal cakes', 'MUIS certified', 'ＨＡＬＡＬ food', 'ha\u200blal food', 'حلال', '清真']) {
    assert.throws(() => assertApprovedClaims(text, demoBrand));
    assert.doesNotThrow(() => assertApprovedClaims(text, attested));
  }
  assert.throws(() => assertApprovedClaims('Halal food', { ...demoBrand, certifications: { muisHalal: 'attested' } }));
  assert.throws(() => assertVisualClaims('Add a MUIS logo on the packaging', attested));
  assert.throws(() => assertVisualClaims('Render a certification seal', attested));
  assert.doesNotThrow(() => assertVisualClaims('Photograph halal pastries in warm light. No text or logos.', attested));
  assert.doesNotThrow(() => assertVisualClaims('Photograph halal pastries. No rendered text, logos or watermarks.', attested));
  assert.throws(() => assertVisualClaims('Photograph halal pastries. No text or logos. Add a MUIS seal.', attested));
  assert.throws(() => assertVisualClaims('No watermarks, add a MUIS logo.', attested));
});

test('price, discount, quotation and guarantee claims need the approved wording', () => {
  const brand = { ...demoBrand, offer: 'Save 20% today. Only S$49.', proof: ['Money-back guarantee.', '“A wonderful candle.”'] };
  for (const text of ['Save 50% today', 'Only S$99.', 'Guaranteed results.', '“Everyone loves our candles.”'])
    assert.throws(() => assertApprovedClaims(text, brand));
  for (const text of ['Save 20% today', 'Only S$49.', 'Money-back guarantee.', '“A wonderful candle.”'])
    assert.doesNotThrow(() => assertApprovedClaims(text, brand));
  assert.doesNotThrow(() => assertApprovedClaims('Only $10', demoBrand, 'Only $10'));
  assert.doesNotThrow(() => assertVisualClaims('0–3s: show a candle. 3–10s: slowly move closer.', demoBrand));
});

test('website/model output never attests certification and final renderer blocks unapproved copy', async () => {
  assert.deepEqual(groundBrief(attested, []).certifications, { muisHalal: 'not_certified' });
  await assert.rejects(renderMedia({ id: randomUUID(), source: '/does-not-exist', kind: 'image', format: '4:5',
    headline: 'MUIS certified', cta: 'Buy', brandName: 'Bakery', mock: true, claimsBrand: demoBrand }), /Certification wording/);
});

test('direct API requests cannot use another workspace certificate or bypass draft/revision claims checks', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkshot-claims-'));
  const db = await createDatabase(dir, true);
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await db.close(); await rm(dir, { recursive: true, force: true }); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const call = (url: string, cookie: string, body?: unknown, method?: string) => fetch(origin + '/api' + url, {
    method: method || (body ? 'POST' : 'GET'), headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const signup = async () => { const r = await call('/auth/demo', '', {}); return r.headers.get('set-cookie')!.split(';')[0]; };
  const cookie = await signup(), otherCookie = await signup();
  const studio = await (await call('/studio', cookie)).json();
  const other = await (await call('/studio', otherCookie)).json();
  const certificateId = randomUUID();
  await db.query('INSERT INTO uploads(id,workspace_id,file_path) VALUES($1,$2,$3)', [certificateId, other.user.workspaceId, '/private/certificate.jpg']);
  const proposed = { ...demoBrand, certifications: { muisHalal: 'attested', certificateId } };
  assert.equal((await call('/brand', cookie, proposed, 'PUT')).status, 400);
  assert.equal((await call('/brand', cookie, { ...proposed, certifications: { muisHalal: 'attested' } }, 'PUT')).status, 400);
  await db.query('UPDATE uploads SET workspace_id=$2 WHERE id=$1', [certificateId, studio.user.workspaceId]);
  assert.equal((await call('/brand', cookie, proposed, 'PUT')).status, 200);
  await assert.doesNotReject(requireOwnedCertificate(db, studio.user.workspaceId, proposed as Brand, true));
  assert.equal((await call("/brand", cookie, { ...proposed, photoId: certificateId }, "PUT")).status, 400);
  // Turn wording back off, then prove callers cannot bypass the UI review.
  assert.equal((await call('/brand', cookie, demoBrand, 'PUT')).status, 200);
  await assert.rejects(requireOwnedCertificate(db, studio.user.workspaceId, proposed as Brand, true), /changed or withdrawn/);
  const campaign = await (await call('/campaigns', cookie, { name: 'Claims test', goal: 'Sales', offer: 'Explore the collection' })).json();
  const draft = await (await call(`/campaigns/${campaign.id}/prompts`, cookie, { revision: 0, selectedConceptIds: campaign.concepts.slice(0, 3).map((c: { id: string }) => c.id) })).json();
  const bad = structuredClone(draft); bad.assets[0].headline = 'Save 90% on halal candles';
  assert.equal((await call(`/campaigns/${campaign.id}/draft`, cookie, bad, 'PATCH')).status, 400);
  assert.equal((await (await call('/studio', cookie)).json()).balance, studio.balance);
  assert.equal((await call(`/campaigns/${campaign.id}/generate`, cookie, { approved: true, draftRevision: draft.revision })).status, 200);
  const generated = await (await call('/studio', cookie)).json();
  const image = generated.assets.find((a: { kind: string }) => a.kind === 'image');
  const version = image.versions[0];
  await db.query("UPDATE versions SET status='ready',source_path='/private/photo.jpg' WHERE asset_id=$1", [image.id]);
  assert.equal((await call(`/assets/${image.id}/revise`, cookie, { versionId: version.id, headline: 'Guaranteed results.', cta: 'Buy', note: '', regenerate: false })).status, 400);
  assert.equal((await call(`/assets/${image.id}/variations`, cookie, { versionId: version.id, headlines: ['Only $999'], requestId: randomUUID() })).status, 400);
  assert.equal((await db.query('SELECT id FROM versions WHERE asset_id=$1', [image.id])).rows.length, 1);
  // Simulate an old or tampered queued row. The worker must enforce policy again.
  await db.query("UPDATE jobs SET state='done' WHERE version_id<>$1", [version.id]);
  await db.query("UPDATE versions SET status='queued',headline='Halal candles' WHERE id=$1", [version.id]);
  assert.equal(await runWorkerOnce(db), true);
  const blocked = (await db.query<{ status: string }>('SELECT status FROM versions WHERE id=$1', [version.id])).rows[0];
  assert.equal(blocked.status, 'failed');
  assert.equal((await db.query('SELECT id FROM ledger WHERE event_key=$1', ['refund:' + version.id])).rows.length, 1);
  assert.equal(await runWorkerOnce(db), false);
  assert.equal((await db.query('SELECT id FROM ledger WHERE event_key=$1', ['refund:' + version.id])).rows.length, 1);
});
