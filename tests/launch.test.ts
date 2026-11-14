import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingMode, checkout, checkoutReleased } from '../server/billing';
import { assertHostedConfiguration } from '../server/config';

test('billing refuses a test key when live mode is selected', async () => {
  const names = ['BILLING_MODE', 'ENABLE_BILLING_SANDBOX', 'STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_STUDIO_PRICE_ID'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.BILLING_MODE = 'live';
    process.env.ENABLE_BILLING_SANDBOX = 'false';
    process.env.STRIPE_API_KEY = 'sk_test_not_a_real_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
    process.env.STRIPE_STUDIO_PRICE_ID = 'price_dummy';
    assert.equal(billingMode(), 'live');
    await assert.rejects(
      checkout(null as never, { demo: false } as never),
      /does not match the configured billing environment/,
    );
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('hosted preview refuses live billing without live generation', () => {
  const names = ['BILLING_MODE', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'DATABASE_URL'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.BILLING_MODE = 'live';
    process.env.AUTH_PROVIDER = 'supabase';
    process.env.STORAGE_PROVIDER = 'supabase';
    process.env.DATABASE_URL = 'postgres://example.invalid/db';
    assert.throws(assertHostedConfiguration, /enabled together/);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('live checkout requires explicit release before contacting Stripe', async () => {
  const overrides = {
    BILLING_MODE: 'live', STRIPE_API_KEY: 'rk_live_dummy',
    STRIPE_WEBHOOK_SECRET: 'whsec_dummy', STRIPE_STUDIO_PRICE_ID: 'price_dummy',
    ENABLE_LIVE_CHECKOUT: undefined,
  };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(checkoutReleased(), false);
    await assert.rejects(checkout(null as never, {demo:false} as never), /New subscriptions are not open yet/);
    process.env.ENABLE_LIVE_CHECKOUT = 'true';
    assert.equal(checkoutReleased(), true);
    delete process.env.ENABLE_LIVE_CHECKOUT;
    process.env.BILLING_MODE = 'sandbox';
    assert.equal(checkoutReleased(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
