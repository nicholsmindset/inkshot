import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedRequestOrigins } from '../server/request-origin.js';

const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'inkshot-build123-team.vercel.app', VERCEL_BRANCH_URL: 'inkshot-git-review-team.vercel.app' };
test('preview accepts only its exact deployment and branch origins alongside the canonical app', () => {
  const allowed = allowedRequestOrigins('https://studio.example.com', true, preview);
  assert.deepEqual(allowed, ['https://studio.example.com', 'https://inkshot-build123-team.vercel.app', 'https://inkshot-git-review-team.vercel.app']);
  for (const origin of ['https://attacker.vercel.app', 'http://inkshot-build123-team.vercel.app', 'null', 'https://inkshot-build123-team.vercel.app.attacker.com']) assert(!allowed.includes(origin));
});
test('production and non-Vercel hosts do not trust preview metadata', () => {
  for (const env of [{ ...preview, VERCEL_ENV: 'production' }, { ...preview, VERCEL: '0' }]) {
    assert.deepEqual(allowedRequestOrigins('https://studio.example.com', true, env), ['https://studio.example.com']);
  }
});
test('malformed deployment metadata is ignored', () => {
  for (const host of ['attacker.com', 'good.vercel.app/path', 'good.vercel.app:443', 'good.vercel.app@attacker.com']) {
    assert.deepEqual(allowedRequestOrigins('https://studio.example.com', true, { ...preview, VERCEL_URL: host, VERCEL_BRANCH_URL: undefined }), ['https://studio.example.com']);
  }
});
