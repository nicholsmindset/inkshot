import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEnvironmentPresence, checkHeaders, requiredVariables } from "../scripts/preflight-production.js";

test("preflight reports missing variable names only, and requires more in live mode", () => {
  const sandbox = Object.fromEntries(requiredVariables.all.map(name => [name, "secret-value"]));
  assert.equal(checkEnvironmentPresence(sandbox, false).status, "PASS");
  const live = checkEnvironmentPresence(sandbox, true);
  assert.equal(live.status, "FAIL");
  assert(live.detail.includes("STRIPE_API_KEY") && live.detail.includes("HF_WEBHOOK_SECRET"));
  assert(!live.detail.includes("secret-value"), "values are never printed");
  const full = { ...sandbox, ...Object.fromEntries(requiredVariables.live.map(name => [name, "x"])), ANTHROPIC_API_KEY: "x", PLAN_PRICES: "usd:7900", STRIPE_PRICE_IDS: "usd:price_x" };
  assert.equal(checkEnvironmentPresence(full, true).status, "PASS");
  assert.match(checkEnvironmentPresence({ ...full, ANTHROPIC_API_KEY: "" }, true).detail, /ANTHROPIC_API_KEY or OPENROUTER_API_KEY/);
  assert.match(checkEnvironmentPresence({ ...full, PLAN_PRICES: "" }, true).detail, /PLAN_PRICES/);
  assert.equal(checkEnvironmentPresence({ ...full, PLAN_PRICES: "", PLAN_PRICE_AMOUNT: "3900", STRIPE_PRICE_IDS: "", STRIPE_STUDIO_PRICE_ID: "price_x" }, true).status, "PASS", "the single-price settings still count");
});

test("preflight header check enforces CSP, noindex, nosniff and frame denial", () => {
  const good = new Headers({ "content-security-policy": "default-src 'self'; script-src 'self'", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
  assert.equal(checkHeaders(good).status, "PASS");
  const bad = new Headers({ "content-security-policy": "default-src 'self'; script-src 'unsafe-eval'" });
  const result = checkHeaders(bad);
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /unsafe-eval/); assert.match(result.detail, /noindex/);
});
