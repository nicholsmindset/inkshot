import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHostedAuthEnvironment } from "../scripts/check-hosted-build";

const configured = {
  APP_ORIGIN: "https://preview.example.com",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  SUPABASE_SECRET_KEY: "test-secret",
  DATABASE_URL: "postgres://role:private-value@db.example.com/postgres",
};
test("hosted builds reject missing auth configuration without leaking secrets", () => {
  assert.doesNotThrow(() => checkHostedAuthEnvironment(configured));
  for (const name of Object.keys(configured)) {
    assert.throws(() => checkHostedAuthEnvironment({ ...configured, [name]: "" }), new RegExp(`Missing ${name}`));
  }
  for (const origin of ["http://preview.example.com", "https://preview.example.com/path", "https://preview.example.com/", "https://user:private-value@preview.example.com"]) {
    assert.throws(() => checkHostedAuthEnvironment({ ...configured, APP_ORIGIN: origin }), error => {
      assert(error instanceof Error);
      assert(!error.message.includes("private-value"));
      return /APP_ORIGIN/.test(error.message);
    });
  }
  assert.throws(() => checkHostedAuthEnvironment({ ...configured, DATABASE_URL: "https://private-value@example.com" }), /valid PostgreSQL/);
});
