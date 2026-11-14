// This regression runs only against a disposable Supabase stack and its test mailbox.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";

export async function checkPasswordRecovery(base: string, otherLogin: string) {
  const provider = new URL(process.env.SUPABASE_URL!);
  assert.equal(provider.hostname, "127.0.0.1");
  assert.equal(new URL(base).hostname, "127.0.0.1");
  const email = `recovery-${randomUUID()}@example.com`;
  const oldPassword = randomUUID(), newPassword = randomUUID();
  const post = (route: string, body: object, cookie = "") => fetch(base + route, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  });
  const cookies = (resp: Response) => resp.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  assert.equal((await post("/auth/signup", { email, password: oldPassword, name: "Recovery test" })).status, 201);
  assert.equal((await post("/auth/reset-password", { password: newPassword }, otherLogin)).status, 401);
  const start = await post("/auth/forgot-password", { email });
  assert.equal(start.status, 200);
  const verifier = cookies(start);
  assert(verifier.includes("inkshot-recovery-code-verifier"));
  let messageId: string | undefined;
  for (let i = 0; i < 20 && !messageId; i++) {
    const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json();
    messageId = inbox.messages.find((m: { To: { Address: string }[] }) => m.To.some(r => r.Address === email))?.ID;
    if (!messageId) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(messageId, "Expected a recovery email in the disposable mailbox");
  const message = await (await fetch("http://127.0.0.1:54324/api/v1/message/" + messageId)).json();
  const href = load(message.HTML)("a[href]").first().attr("href");
  assert(href);
  const emailUrl = new URL(href);
  assert.equal(emailUrl.host, provider.host);
  const verify = await fetch(emailUrl, { redirect: "manual" });
  const callback = new URL(verify.headers.get("location")!);
  assert.equal(callback.pathname, "/api/auth/recovery-callback");
  const url = base + "/auth/recovery-callback" + callback.search;
  const wrongBrowser = await fetch(url, { redirect: "manual" });
  assert.equal(wrongBrowser.headers.get("location"), "/forgot-password?expired=1");
  const link = await fetch(url, { redirect: "manual", headers: { cookie: verifier } });
  assert.equal(link.headers.get("location"), "/reset-password");
  const recoveryCookies = verifier + "; " + cookies(link);
  const reset = await post("/auth/reset-password", { password: newPassword }, recoveryCookies);
  assert.equal(reset.status, 200);
  assert(!reset.headers.getSetCookie().some(c => /^inkshot-recovery(?:\.\d+)?=.+?;/.test(c)));
  assert.equal((await post("/auth/reset-password", { password: randomUUID() }, recoveryCookies)).status, 401);
  assert.equal((await post("/auth/login", { email, password: oldPassword })).status, 401);
  assert.equal((await post("/auth/login", { email, password: newPassword })).status, 200);
  console.log("Recovery email, browser-bound reset, single use and sign-in verified.");
}
