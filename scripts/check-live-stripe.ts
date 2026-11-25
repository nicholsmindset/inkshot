import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { planConfig, stripePriceIds } from "../server/plan.js";

const apiVersion = "2026-08-26.dahlia";
const accountId = process.env.STRIPE_ACCOUNT_ID || "acct_1RKb5BDjNCv7xF61";
const priceId = process.env.STRIPE_STUDIO_PRICE_ID || process.env.PLAN_PRICE_ID || stripePriceIds().get(planConfig().currency) || "";
const portalId = process.env.STRIPE_PORTAL_CONFIGURATION_ID || "bpc_1Ubc4cDjNCv7xF61XYQJpfqA";
const events = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "invoice.paid", "invoice.payment_failed", "customer.subscription.created",
  "customer.subscription.updated", "customer.subscription.deleted",
  "charge.refunded", "charge.dispute.created",
];

export function productionOrigin(value: string) {
  const url = new URL(value);
  assert(url.protocol === "https:" && value === url.origin && !url.username && !url.password,
    "Supply the exact HTTPS production origin without a trailing slash.");
  assert(url.origin !== "https://inkshot-omega.vercel.app", "This origin serves the existing sandbox.");
  return url.origin;
}

type Destination = Pick<Stripe.WebhookEndpoint, "url" | "status" | "livemode" | "enabled_events" | "api_version">;

export function checkDestination(endpoints: Destination[], origin: string) {
  const url = productionOrigin(origin) + "/api/webhooks/stripe";
  const matching = endpoints.filter(endpoint => endpoint.url === url && endpoint.status === "enabled");
  assert(matching.length === 1, "Expected exactly one enabled endpoint at the Inkshot production URL.");
  const [endpoint] = matching;
  assert(endpoint.livemode && endpoint.api_version === apiVersion, "Webhook mode or event API version differs from Inkshot.");
  assert.deepEqual([...endpoint.enabled_events].sort(), [...events].sort(), "Webhook event selection differs from the Inkshot setup.");
}

async function main() {
  const origin = productionOrigin(process.argv[2] ?? "");
  const key = process.env.STRIPE_API_KEY ?? "";
  assert(/^[sr]k_live_/.test(key), "Supply a live Stripe API key through STRIPE_API_KEY.");
  const stripe = new Stripe(key, { apiVersion, timeout: 15000, maxNetworkRetries: 1 });
  const plan = planConfig();
  assert(priceId, "Set STRIPE_PRICE_IDS (or STRIPE_STUDIO_PRICE_ID) to the live price for the primary currency.");
  const [account, price, portal] = await Promise.all([
    stripe.accounts.retrieveCurrent(), stripe.prices.retrieve(priceId),
    stripe.billingPortal.configurations.retrieve(portalId),
  ]);
  const product = await stripe.products.retrieve(typeof price.product === "string" ? price.product : price.product.id);
  assert(account.id === accountId && account.charges_enabled, "Expected the charge-enabled ONN GROUP LLP account.");
  assert(product.active && product.livemode, "Unexpected live Inkshot product configuration.");
  // The price must match the configured plan exactly (PLAN_CURRENCY / PLAN_PRICE_AMOUNT).
  assert(price.active && price.livemode && price.currency === plan.currency &&
    price.unit_amount === plan.priceAmount && price.recurring?.interval === "month" && price.recurring.interval_count === 1,
    `Expected an active live monthly ${plan.currency.toUpperCase()} ${plan.priceAmount / 100} price.`);
  // Every other currency we sell in must also have a matching live price.
  for (const [currency, id] of stripePriceIds()) {
    if (id === priceId) continue;
    const other = await stripe.prices.retrieve(id);
    const want = plan.prices.find(p => p.currency === currency);
    assert(want && other.active && other.livemode && other.currency === currency && other.unit_amount === want.amount && other.recurring?.interval === "month",
      `Expected an active live monthly ${currency.toUpperCase()} price matching PLAN_PRICES.`);
  }
  assert(portal.active && portal.livemode && portal.metadata?.application === "inkshot" &&
    portal.features.subscription_cancel.enabled && portal.features.subscription_cancel.mode === "at_period_end" &&
    portal.features.payment_method_update.enabled && portal.features.invoice_history.enabled,
    "Unexpected Inkshot portal settings.");
  const endpoints = [];
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) endpoints.push(endpoint);
  checkDestination(endpoints, origin);
  // Health is public. Never forward the Stripe credential to the application.
  const response = await fetch(origin + "/api/health", { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert(response.ok, "Hosted health check failed.");
  const health = await response.json();
  assert(health.ok === true && health.billingMode === "live" && health.mode === "live" &&
    health.demoAvailable === false, "Production origin is not serving live Inkshot billing and generation.");
  console.log("Verified live Stripe catalogue, portal, webhook configuration and Inkshot health.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof assert.AssertionError ? error.message : "Check failed. Verify the origin, credentials, Stripe permissions and connectivity.");
    process.exitCode = 1;
  });
}
