import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalAuthDestination } from "../src/auth-origin";

test("auth starts on the callback host without forwarding secrets or arbitrary destinations", () => {
  const origin = "https://stable.example.com";
  assert.equal(canonicalAuthDestination(origin, "https://build.example.com/login?code=secret&next=https://evil.example#token"), origin + "/login");
  assert.equal(canonicalAuthDestination(origin, "https://build.example.com/forgot-password?email=private@example.com"), origin + "/forgot-password");
  assert.equal(canonicalAuthDestination(origin, "https://build.example.com/signup?website=https%3A%2F%2Fshop.example"), origin + "/signup?website=https%3A%2F%2Fshop.example");
  assert.equal(canonicalAuthDestination(origin, origin + "/login"), null);
  assert.equal(canonicalAuthDestination(null, "http://localhost:5173/signup"), null);
  for (const bad of ["http://localhost:3000", "https://user:password@stable.example.com", "https://stable.example.com/path", "javascript:alert(1)"])
    assert.throws(() => canonicalAuthDestination(bad, "https://build.example.com/login"));
});
