import assert from "node:assert/strict";
import test from "node:test";
import { checkDestination, productionOrigin } from "../scripts/check-live-stripe";

const origin = "https://inkshot.example.org";
const destination = {
  url: origin + "/api/webhooks/stripe", status: "enabled", livemode: true,
  api_version: "2026-08-26.dahlia", enabled_events: ["checkout.session.completed",
    "checkout.session.async_payment_succeeded", "invoice.paid", "invoice.payment_failed",
    "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"],
} as const;
const endpoint = { ...destination, enabled_events: [...destination.enabled_events] };

test("preflight rejects sandbox, credential-bearing and non-origin destinations", () => {
  for (const invalid of ["https://inkshot-omega.vercel.app", "http://inkshot.example.org",
    "https://inkshot.example.org/?t=1", "https://user:pass@inkshot.example.org"]) {
    assert.throws(() => productionOrigin(invalid));
  }
});

test("preflight accepts one correctly scoped live endpoint and rejects ambiguous or broken configs", () => {
  checkDestination([endpoint], origin);
  for (const value of [[], [endpoint, endpoint], [{ ...endpoint, livemode: false }],
    [{ ...endpoint, url: origin }], [{ ...endpoint, status: "disabled" as const }],
    [{ ...endpoint, api_version: "unrelated" }], [{ ...endpoint, enabled_events: ["invoice.paid" as const] }]]) {
    assert.throws(() => checkDestination(value, origin));
  }
});
