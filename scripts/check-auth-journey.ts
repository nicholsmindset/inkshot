// Only the disposable Supabase stack and its captured local email are permitted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { load } from "cheerio";

for (const key of ["DATABASE_URL", "SUPABASE_URL"]) {
  assert.equal(new URL(process.env[key] ?? "").hostname, "127.0.0.1", "Use the disposable local stack.");
}
assert.equal(process.env.GENERATION_MODE, "mock");
assert.equal(process.env.ALLOW_LIVE_GENERATION, "false");
process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "inkshot-auth-"));
const { createApp } = await import("../server/app");
const { createDatabase } = await import("../server/db");
const db = await createDatabase();
const server = createApp(db).listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const provider = new URL(process.env.SUPABASE_URL!);
const email = `journey-${randomUUID()}@example.com`;
const password = randomUUID(), newPassword = randomUUID();
const jar = new Map<string, string>();
function takeCookies(response: Response, cookies = jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator), value = pair.slice(separator + 1);
    if (!value || /max-age=0(?:;|$)/i.test(cookie)) cookies.delete(name);
    else cookies.set(name, value);
  }
}
async function request(route: string, body?: object, cookies = jar) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { "content-type": "application/json", cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    ...(body && { body: JSON.stringify(body) }),
  });
  takeCookies(response, cookies);
  return response;
}
const seenMessages = new Set<string>();
async function emailMessage(recipientEmail = email): Promise<{ HTML: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json();
    const item = inbox.messages.find((m: { ID: string; To: { Address: string }[] }) =>
      !seenMessages.has(m.ID) && m.To.some(recipient => recipient.Address === recipientEmail));
    if (item) {
      seenMessages.add(item.ID);
      return (await fetch(`http://127.0.0.1:54324/api/v1/message/${item.ID}`)).json();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Expected an authentication email in the disposable mailbox.");
}
async function emailLink() {
  const message = await emailMessage();
  const href = load(message.HTML)("a[href]").first().attr("href");
  assert(href, "Expected an authentication email link.");
  const url = new URL(href);
  assert.equal(url.origin, provider.origin, "Never follow email links outside the disposable Auth server.");
  const verification = await fetch(url, { redirect: "manual" });
  const location = verification.headers.get("location");
  assert(location);
  const callback = new URL(location);
  assert.equal(callback.origin, process.env.APP_ORIGIN);
  return callback.pathname + callback.search;
}
try {
  assert.equal((await request("/api/studio")).status, 401);
  const signup = await request("/api/auth/signup", {
    name: "Journey merchant", email, password, website: "https://example.com/offer",
  });
  assert.equal(signup.status, 201);
  assert.equal((await signup.json()).confirmationRequired, true, "This job must require email confirmation.");
  assert.equal((await request("/api/auth/login", { email, password })).status, 401);
  assert.equal((await request("/api/studio")).status, 401);
  const callback = await emailLink();
  assert(callback.startsWith("/api/auth/callback?"));
  const confirmation = await request(callback);
  assert.equal(confirmation.status, 302);
  assert.match(confirmation.headers.get("cache-control") ?? "", /no-store/);
  const destination = new URL(confirmation.headers.get("location")!, base);
  assert.equal(destination.pathname, "/studio/brand");
  assert.equal(destination.searchParams.get("website"), "https://example.com/offer");
  const first = await request("/api/studio");
  assert.equal(first.status, 200);
  const identity = (await first.json()).user;
  assert.equal((await request("/api/auth/logout", {})).status, 200);
  assert.equal((await request("/api/studio")).status, 401);
  assert.equal((await request("/api/auth/login", { email, password: "wrong-password" })).status, 401);
  assert.equal((await request("/api/auth/login", { email: `  ${email.toUpperCase()}  `, password })).status, 200);
  const returning = await request("/api/studio");
  assert.equal(returning.status, 200);
  assert.deepEqual((await returning.json()).user, identity, "Returning sign-in must reuse the account and workspace.");
  assert.equal((await db.query("SELECT id FROM users WHERE email=$1", [email])).rows.length, 1);
  assert.equal((await request("/api/auth/logout", {})).status, 200);
  const invalidLink = await request("/api/auth/callback?error=access_denied");
  assert.equal(invalidLink.headers.get("location"), "/login?confirmation=failed");
  assert.equal((await request("/api/auth/forgot-password", { email })).status, 200);
  const recovery = await emailLink();
  assert(recovery.startsWith("/api/auth/recovery-callback?"));
  const form = await request(recovery);
  assert.equal(form.headers.get("location"), "/reset-password");
  assert.equal((await request("/api/auth/reset-password", { password: newPassword })).status, 200);
  assert.equal((await request("/api/auth/reset-password", { password: randomUUID() })).status, 401);
  assert.equal((await request("/api/auth/login", { email, password })).status, 401);
  assert.equal((await request("/api/auth/login", { email, password: newPassword })).status, 200);
  const recovered = await request("/api/studio");
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).user.workspaceId, identity.workspaceId);

  // Start a separate signup, resend its email, then enter the captured code on
  // a completely new device (no original session or PKCE verifier cookies).
  const codeEmail = `code-${randomUUID()}@example.com`, codePassword = randomUUID();
  const signupDevice = new Map<string, string>(), otherDevice = new Map<string, string>();
  const codeSignup = await request("/api/auth/signup", { name: "Code merchant", email: codeEmail, password: codePassword }, signupDevice);
  assert.equal(codeSignup.status, 201);
  assert.equal((await codeSignup.json()).confirmationRequired, true);
  await emailMessage(codeEmail);
  // Only the disposable CI server uses a 1-second mail frequency, allowing a
  // real resend to be checked without bypassing production resend controls.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const resend = await request("/api/auth/resend-confirmation", { email: ` ${codeEmail.toUpperCase()} ` }, signupDevice);
  assert.equal(resend.status, 200);
  assert.equal(resend.headers.get("cache-control"), "no-store");
  const resendBody = await resend.json();
  const unknownResend = await request("/api/auth/resend-confirmation", { email: `unknown-${randomUUID()}@example.com` }, new Map());
  assert.equal(unknownResend.status, 200);
  assert.deepEqual(await unknownResend.json(), resendBody, "Resend must not disclose account existence.");
  const resentMessage = await emailMessage(codeEmail);
  const token = load(resentMessage.HTML)("[data-inkshot-code]").text().trim();
  assert.match(token, /^\d{6,10}$/, "The confirmation template must include its verification code.");
  assert.equal(otherDevice.size, 0);
  assert.equal((await request("/api/studio", undefined, otherDevice)).status, 401);
  const incorrectToken = `${token[0] === "0" ? "1" : "0"}${token.slice(1)}`;
  assert.equal((await request("/api/auth/verify-email", { email: codeEmail, token: incorrectToken }, otherDevice)).status, 401);
  assert.equal((await request("/api/studio", undefined, otherDevice)).status, 401);
  const verified = await request("/api/auth/verify-email", { email: codeEmail, token }, otherDevice);
  assert.equal(verified.status, 200);
  const verifiedStudio = await request("/api/studio", undefined, otherDevice);
  assert.equal(verifiedStudio.status, 200);
  const codeIdentity = (await verifiedStudio.json()).user;
  assert.equal(codeIdentity.email, codeEmail);
  const thirdDevice = new Map<string, string>();
  assert.equal((await request("/api/auth/verify-email", { email: codeEmail, token }, thirdDevice)).status, 401, "A used code must not authenticate another browser.");
  assert.equal((await request("/api/studio", undefined, thirdDevice)).status, 401);
  assert.equal((await request("/api/auth/logout", {}, otherDevice)).status, 200);
  assert.equal((await request("/api/auth/login", { email: codeEmail, password: codePassword }, otherDevice)).status, 200);
  const codeReturning = await request("/api/studio", undefined, otherDevice);
  assert.equal(codeReturning.status, 200);
  assert.deepEqual((await codeReturning.json()).user, codeIdentity);
  assert.equal((await db.query("SELECT id FROM users WHERE email=$1", [codeEmail])).rows.length, 1);
  console.log("Confirmed signup, first session, returning login, callback continuation, password recovery, private resend and cross-device single-use email verification passed.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.close();
  await rm(process.env.DATA_DIR, { recursive: true, force: true });
}
