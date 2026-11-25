// Read-only production preflight. Prints PASS / FAIL / SKIP per item and never prints a secret value.
// Usage: npx tsx scripts/preflight-production.ts [origin] [--send-alert]
//   origin defaults to APP_ORIGIN. Live-only checks are SKIPped (and labelled) unless BILLING_MODE=live.
// Needs the same environment variables as the deployment (use a local, untracked env file or `vercel env pull`).
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { assertHostedConfiguration, HostedConfigurationError } from "../server/config.js";
import { createDatabase } from "../server/db.js";
import { verifySchemaReadiness } from "../server/schema-readiness.js";
import { planConfig, stripePriceIds } from "../server/plan.js";
import { checkHostedAuthEnvironment } from "./check-hosted-build.js";
import { checkDestination } from "./check-live-stripe.js";

export type Result = { name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const pass = (name: string, detail = ""): Result => ({ name, status: "PASS", detail });
const fail = (name: string, detail: string): Result => ({ name, status: "FAIL", detail });
const skip = (name: string, detail: string): Result => ({ name, status: "SKIP", detail });

// Names only. "server" values must never reach the browser bundle.
export const requiredVariables = {
  all: ["APP_ORIGIN", "AUTH_PROVIDER", "STORAGE_PROVIDER", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "CRON_SECRET"],
  live: ["BILLING_MODE", "GENERATION_MODE", "ALLOW_LIVE_GENERATION", "STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", "HF_API_KEY_ID", "HF_API_KEY_SECRET", "HF_DAILY_BUDGET_USD",
    "WRITING_DAILY_REQUEST_LIMIT", "WRITING_WORKSPACE_DAILY_REQUEST_LIMIT", "OPS_ALERTS_ENABLED", "OPS_ALERT_WEBHOOK_URL", "HF_WEBHOOKS_ENABLED", "HF_WEBHOOK_SECRET", "PLAN_CURRENCY", "VIDEO_REGEN_MONTHLY_CAP"],
};
export function checkEnvironmentPresence(env: NodeJS.ProcessEnv, live: boolean): Result {
  const names = [...requiredVariables.all, ...(live ? requiredVariables.live : [])];
  const missing = names.filter(name => !env[name]?.trim());
  const anyWriter = !!(env.ANTHROPIC_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim());
  if (live && !anyWriter) missing.push("ANTHROPIC_API_KEY or OPENROUTER_API_KEY");
  // Either the multi-currency settings or the single-price ones, and a Stripe price ID in one of its forms.
  if (live && !env.PLAN_PRICES?.trim() && !env.PLAN_PRICE_AMOUNT?.trim()) missing.push("PLAN_PRICES (or PLAN_PRICE_AMOUNT)");
  if (live && !env.STRIPE_PRICE_IDS?.trim() && !env.STRIPE_STUDIO_PRICE_ID?.trim() && !env.PLAN_PRICE_ID?.trim()) missing.push("STRIPE_PRICE_IDS (or STRIPE_STUDIO_PRICE_ID)");
  return missing.length ? fail("Environment variables present", `missing: ${missing.join(", ")}`) : pass("Environment variables present", `${names.length} names checked`);
}
export function checkHeaders(headers: Headers): Result {
  const csp = headers.get("content-security-policy") ?? "";
  const robots = headers.get("x-robots-tag") ?? "";
  const problems = [
    !/default-src 'self'/.test(csp) && "missing CSP default-src 'self'",
    /unsafe-eval/.test(csp) && "CSP allows unsafe-eval",
    !/noindex/i.test(robots) && "missing X-Robots-Tag noindex",
    !/nosniff/i.test(headers.get("x-content-type-options") ?? "") && "missing nosniff",
    !/deny/i.test(headers.get("x-frame-options") ?? "") && "missing X-Frame-Options DENY",
  ].filter(Boolean);
  return problems.length ? fail("CSP / noindex headers", problems.join("; ")) : pass("CSP / noindex headers");
}

async function guarded(name: string, run: () => Promise<Result>): Promise<Result> {
  try { return await run(); }
  catch (error) { return fail(name, error instanceof Error ? error.message.slice(0, 200) : "check failed"); }
}

export async function runPreflight(env: NodeJS.ProcessEnv, origin: string, options: { sendAlert?: boolean } = {}): Promise<Result[]> {
  const live = env.BILLING_MODE === "live";
  const liveOnly = (name: string) => skip(name, "LIVE-ONLY check skipped: BILLING_MODE is not live (sandbox/preview run)");
  const results: Result[] = [checkEnvironmentPresence(env, live)];

  results.push(await guarded("Hosted configuration", async () => {
    checkHostedAuthEnvironment(env);
    try { assertHostedConfiguration(); } catch (e) { if (e instanceof HostedConfigurationError) return fail("Hosted configuration", e.code); throw e; }
    planConfig();
    return pass("Hosted configuration");
  }));

  results.push(await guarded("Database schema and environment marker", async () => {
    const db = await createDatabase();
    try {
      await verifySchemaReadiness(db, env.INKSHOT_SHARED_PROJECT_LIVE === "true");
      const tables = (await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('invites','waitlist','product_events','campaign_copy') AND table_schema=current_schema()")).rows.map(r => r.table_name);
      const missing = ["invites", "waitlist", "product_events", "campaign_copy"].filter(t => !tables.includes(t));
      if (missing.length) return fail("Database schema and environment marker", `pilot migrations not applied: ${missing.join(", ")}`);
      const marker = (await db.query<{ mode: string }>("SELECT mode FROM inkshot_environment WHERE singleton")).rows[0]?.mode;
      if (live && marker !== "live") return fail("Database schema and environment marker", `marker is "${marker}", expected "live"`);
      if (!live && marker === "live") return fail("Database schema and environment marker", "database is live-bound but BILLING_MODE is not live");
      return pass("Database schema and environment marker", `schema ready; marker=${marker}`);
    } finally { await db.close(); }
  }));

  results.push(!live ? liveOnly("Stripe live mode and webhook events") : await guarded("Stripe live mode and webhook events", async () => {
    const key = env.STRIPE_API_KEY ?? "";
    if (!/^[sr]k_live_/.test(key)) return fail("Stripe live mode and webhook events", "STRIPE_API_KEY is not a live key");
    const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia", timeout: 15000, maxNetworkRetries: 1 });
    const endpoints = [];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) endpoints.push(endpoint);
    checkDestination(endpoints, origin);
    const plan = planConfig();
    const ids = stripePriceIds(env);
    const wrong: string[] = [];
    for (const { currency, amount } of plan.prices) {
      const id = ids.get(currency);
      if (!id) { wrong.push(`${currency}: no Stripe price ID (those customers fall back to ${plan.currency})`); continue; }
      const price = await stripe.prices.retrieve(id);
      if (!price.livemode || !price.active || price.currency !== currency || price.unit_amount !== amount || price.recurring?.interval !== "month") wrong.push(`${currency}: price differs from the plan`);
    }
    if (wrong.some(w => !w.includes("fall back"))) return fail("Stripe live mode and webhook events", wrong.join("; "));
    return pass("Stripe live mode and webhook events", `endpoint events incl. charge.refunded and charge.dispute.created; ${ids.size} price(s) match the plan${wrong.length ? `; note: ${wrong.join("; ")}` : ""}`);
  }));

  results.push(env.GENERATION_MODE !== "live" ? liveOnly("Higgsfield key validity") : await guarded("Higgsfield key validity", async () => {
    // Free: a status lookup for an unknown request. 404 = authenticated; 401/403 = bad key. Nothing is generated or billed.
    const response = await fetch("https://api.higgsfield.ai/requests/00000000-0000-4000-8000-000000000000/status", {
      headers: { Authorization: `Key ${env.HF_API_KEY_ID}:${env.HF_API_KEY_SECRET}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401 || response.status === 403) return fail("Higgsfield key validity", `provider rejected the key (${response.status})`);
    return response.status < 500 ? pass("Higgsfield key validity", `authenticated (HTTP ${response.status}); no generation requested`)
      : fail("Higgsfield key validity", `provider unavailable (${response.status})`);
  }));

  results.push(!options.sendAlert ? skip("Alert test send", "pass --send-alert to post one clearly-labelled test message") : await guarded("Alert test send", async () => {
    const url = env.OPS_ALERT_WEBHOOK_URL?.trim();
    if (!url || !/^https:\/\//.test(url)) return fail("Alert test send", "OPS_ALERT_WEBHOOK_URL is not an https URL");
    const secret = env.OPS_ALERT_WEBHOOK_SECRET?.trim();
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ event: "inkshot_preflight_test", test: true, text: "Inkshot preflight: this is a test alert. No action needed." }), signal: AbortSignal.timeout(10000) });
    return response.ok ? pass("Alert test send", "delivered; confirm you received it") : fail("Alert test send", `receiver returned ${response.status}`);
  }));

  results.push(await guarded("Headers on the web app", async () => checkHeaders((await fetch(origin + "/", { redirect: "manual", signal: AbortSignal.timeout(15000) })).headers)));
  results.push(await guarded("Health and protected ops status", async () => {
    const health = await fetch(origin + "/api/health", { signal: AbortSignal.timeout(15000) });
    if (!health.ok) return fail("Health and protected ops status", `/api/health returned ${health.status}`);
    const body = await health.json() as { billingMode?: string; mode?: string; demoAvailable?: boolean };
    if (live && (body.billingMode !== "live" || body.mode !== "live" || body.demoAvailable)) return fail("Health and protected ops status", "origin is not serving live mode");
    const anonymous = await fetch(origin + "/api/ops/status", { signal: AbortSignal.timeout(15000) });
    if (anonymous.status !== 401 && anonymous.status !== 403) return fail("Health and protected ops status", `anonymous ops status returned ${anonymous.status}, expected 401/403`);
    const authorised = await fetch(origin + "/api/ops/status", { headers: { authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(15000) });
    return authorised.status === 200 ? pass("Health and protected ops status", "health ok; ops status 200 with secret, refused without")
      : fail("Health and protected ops status", `ops status with secret returned ${authorised.status}`);
  }));
  return results;
}

async function main() {
  const origin = (process.argv.find(a => a.startsWith("https://")) ?? process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
  if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error("Supply the exact HTTPS origin as an argument or APP_ORIGIN.");
  const results = await runPreflight(process.env, origin, { sendAlert: process.argv.includes("--send-alert") });
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n${failed ? `${failed} check(s) FAILED` : "No failures"}; ${results.filter(r => r.status === "SKIP").length} skipped.`);
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : "Preflight failed."); process.exitCode = 1; });
