import assert from "node:assert/strict";
import { test } from "node:test";
import { assertHostedConfiguration, config, HostedConfigurationError } from "../server/config.js";

test("hosted guards identify safe configuration reasons while preserving all refusal checks", () => {
  const keys = ["AUTH_PROVIDER", "STORAGE_PROVIDER", "DATABASE_URL", "BILLING_MODE", "ENABLE_BILLING_SANDBOX", "STRIPE_API_KEY", "STRIPE_STUDIO_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "HF_DAILY_BUDGET_USD", "WRITING_DAILY_REQUEST_LIMIT", "WRITING_WORKSPACE_DAILY_REQUEST_LIMIT"];
  const savedEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const savedConfig = { ...config };
  const expect = (code: string) => assert.throws(assertHostedConfiguration, error =>
    error instanceof HostedConfigurationError && error.code === code);
  try {
    delete process.env.AUTH_PROVIDER;
    expect("HOSTED_AUTH_REQUIRED");
    process.env.AUTH_PROVIDER = "supabase";
    delete process.env.STORAGE_PROVIDER;
    expect("HOSTED_STORAGE_REQUIRED");
    process.env.STORAGE_PROVIDER = "supabase";
    delete process.env.DATABASE_URL;
    expect("HOSTED_DATABASE_REQUIRED");
    process.env.DATABASE_URL = "postgres://fixture:secret@example.invalid/fixture";
    config.mode = "mock";
    process.env.BILLING_MODE = "live";
    expect("LIVE_MODE_MISMATCH");
    config.mode = "live";
    process.env.ENABLE_BILLING_SANDBOX = "true";
    expect("LIVE_BILLING_REQUIRED");
    process.env.ENABLE_BILLING_SANDBOX = "false";
    process.env.STRIPE_API_KEY = "sk_live_fixture";
    process.env.STRIPE_STUDIO_PRICE_ID = "price_fixture";
    process.env.STRIPE_WEBHOOK_SECRET = "fixture";
    config.origin = "https://example.invalid";
    config.liveAllowed = false;
    expect("LIVE_PROVIDER_REQUIRED");
    config.liveAllowed = true;
    config.hfKey = "fixture";
    config.hfSecret = "fixture";
    config.claudeKey = "fixture";
    process.env.HF_DAILY_BUDGET_USD = "10";
    delete process.env.WRITING_DAILY_REQUEST_LIMIT;
    expect("WRITING_LIMITS_REQUIRED");
    process.env.WRITING_DAILY_REQUEST_LIMIT = "50";
    process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT = "5";
    assert.doesNotThrow(assertHostedConfiguration);
    process.env.WRITING_WORKSPACE_DAILY_REQUEST_LIMIT = "100";
    expect("WRITING_LIMITS_REQUIRED");
  } finally {
    Object.assign(config, savedConfig);
    for (const key of keys) {
      if (savedEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[key];
    }
  }
});
