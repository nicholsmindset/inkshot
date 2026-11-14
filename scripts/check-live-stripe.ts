import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const apiVersion = "2026-08-26.dahlia";
const accountId = "acct_1RKb5BDjNCv7xF61";
const productId = "prod_VcriAoyQSsH5QA";
const priceId = "price_1UbbydDjNCv7xF61FEzeGu5I";
const portalId = "bpc_1Ubc4cDjNCv7xF61XYQJpfqA";
const events = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "invoice.paid", "invoice.payment_failed", "customer.subscription.created",
  "customer.subscription.updated", "customer.subscription.deleted",
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
  const [account, product, price, portal] = await Promise.all([
    stripe.accounts.retrieveCurrent(), stripe.products.retrieve(productId),
    stripe.prices.retrieve(priceId), stripe.billingPortal.configurations.retrieve(portalId),
  ]);
  assert(account.id === accountId && account.charges_enabled, "Expected the charge-enabled ONN GROUP LLP account.");
  assert(product.active && product.livemode && product.default_price === priceId, "Unexpected live Inkshot product configuration.");
  assert(price.active && price.livemode && price.product === productId && price.currency === "usd" &&
    price.unit_amount === 3900 && price.recurring?.interval === "month" && price.recurring.interval_count === 1,
    "Expected the live Inkshot USD 39 monthly price.");
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
