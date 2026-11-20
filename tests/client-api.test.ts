import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.js";

test("client API reports a non-JSON outage without exposing the response body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>private upstream failure</html>", { status: 503 });
  try {
    await assert.rejects(api("/auth/login", { email: "test@example.com", password: "example" }), (error: Error & { status?: number }) => {
      assert.equal(error.status, 503);
      assert.equal(error.message, "Inkshot is temporarily unavailable. Please try again.");
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("client API rejects an HTML success response instead of treating auth as successful", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>login redirect</html>", { status: 200 });
  try {
    await assert.rejects(api("/auth/signup", {}), (error: Error & { status?: number }) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /unreadable response/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("client API preserves auth error status and safe diagnostic reference", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: "Unable to sign in." }, { status: 401 });
    await assert.rejects(api("/auth/login", {}), (error: Error & { status?: number }) => {
      assert.equal(error.status, 401);
      assert.equal(error.message, "Unable to sign in.");
      return true;
    });
    const reference = "bd9b3233-86af-4eae-a0ab-df85c465de4d";
    globalThis.fetch = async () => Response.json({ error: "Service unavailable.", code: "SERVICE_UNAVAILABLE", reference }, { status: 503 });
    await assert.rejects(api("/studio"), { message: "Service unavailable. Reference " + reference });
  } finally { globalThis.fetch = original; }
});

test("client API handles disconnected requests with a recoverable message", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try {
    await assert.rejects(api("/auth/logout", {}), { message: "Could not connect to Inkshot. Check your connection and try again." });
  } finally { globalThis.fetch = original; }
});
