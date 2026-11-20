import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Database } from "../server/db.js";
import { createHostedHandler } from "../server/hosted-handler.js";
import { HostedConfigurationError } from "../server/config.js";

const database = {} as Database;
function request() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: "",
    setHeader: (name: string, value: string) => headers.set(name, value),
    end(value: string) { this.body = value; },
  };
  return { req: {} as IncomingMessage, res: response as unknown as ServerResponse, response, headers };
}
test("concurrent cold requests initialize one app and configuration is checked for every request", async () => {
  let validations = 0, connections = 0, applications = 0;
  const handler = createHostedHandler({
    assertConfiguration: () => { validations++; },
    database: async () => { connections++; return database; },
    createApp: () => { applications++; return (_req, res) => res.end("ready"); },
  });
  const requests = [request(), request(), request()];
  await Promise.all(requests.map(r => handler(r.req, r.res)));
  assert.equal(validations, 3);
  assert.equal(connections, 1);
  assert.equal(applications, 1);
  assert(requests.every(r => r.response.body === "ready"));
});
test("a transient database failure retries initialization and reports only safe diagnostics", async () => {
  let attempts = 0;
  const diagnostics: unknown[] = [];
  const handler = createHostedHandler({
    assertConfiguration: () => {},
    database: async () => {
      if (++attempts === 1) throw Object.assign(new Error("postgres://secret-password@example.test/private"), { code: "28P01" });
      return database;
    },
    createApp: () => (_req, res) => res.end("ready"),
    report: value => diagnostics.push(value),
  });
  const failed = request();
  await handler(failed.req, failed.res);
  assert.equal(failed.response.statusCode, 503);
  assert.equal(failed.headers.get("Cache-Control"), "no-store");
  const body = JSON.parse(failed.response.body);
  assert.equal(body.code, "SERVICE_UNAVAILABLE");
  assert(!body.error.includes("completing"));
  assert.equal((diagnostics[0] as { reference: string }).reference, body.reference);
  assert.deepEqual(diagnostics[0], { event: "inkshot_service_unavailable", reference: body.reference, stage: "database", code: "28P01" });
  assert(!JSON.stringify([diagnostics, body]).includes("secret-password"));
  const recovered = request();
  await handler(recovered.req, recovered.res);
  assert.equal(recovered.response.body, "ready");
  assert.equal(attempts, 2);
});
test("configuration failure blocks a warm app and does not expose raw error codes", async () => {
  let allowed = true, delivered = 0;
  const diagnostics: unknown[] = [];
  const handler = createHostedHandler({
    assertConfiguration: () => { if (!allowed) throw { code: "secret-configuration", message: "private value" }; },
    database: async () => database,
    createApp: () => (_req, res) => { delivered++; res.end("ready"); },
    report: value => diagnostics.push(value),
  });
  const warm = request();
  await handler(warm.req, warm.res);
  allowed = false;
  const failed = request();
  await handler(failed.req, failed.res);
  assert.equal(failed.response.statusCode, 503);
  assert.equal(delivered, 1);
  assert.equal((diagnostics[0] as { stage: string }).stage, "configuration");
  assert(!JSON.stringify(diagnostics).includes("secret-configuration"));
});
test("an application initialization failure clears the shared startup promise", async () => {
  let builds = 0;
  const diagnostics: { stage: string }[] = [];
  const handler = createHostedHandler({
    assertConfiguration: () => {},
    database: async () => database,
    createApp: () => {
      if (++builds === 1) throw new Error("temporary startup failure");
      return (_req, res) => res.end("ready");
    },
    report: value => diagnostics.push(value),
  });
  const failed = request();
  await handler(failed.req, failed.res);
  assert.equal(failed.response.statusCode, 503);
  assert.equal(diagnostics[0].stage, "application");
  const recovered = request();
  await handler(recovered.req, recovered.res);
  assert.equal(recovered.response.body, "ready");
  assert.equal(builds, 2);
});

test("configuration reason is logged while the client receives only a generic code and reference", async () => {
  const diagnostics: unknown[] = [];
  const handler = createHostedHandler({
    assertConfiguration: () => { throw new HostedConfigurationError("LIVE_MODE_MISMATCH", "private diagnostic detail"); },
    database: async () => { throw new Error("must not connect"); },
    createApp: () => { throw new Error("must not initialize"); },
    report: value => diagnostics.push(value),
  });
  const failed = request();
  await handler(failed.req, failed.res);
  const body = JSON.parse(failed.response.body);
  assert.equal(body.code, "SERVICE_UNAVAILABLE");
  assert.equal((diagnostics[0] as { code: string }).code, "LIVE_MODE_MISMATCH");
  assert(!failed.response.body.includes("LIVE_MODE_MISMATCH"));
  assert(!JSON.stringify(diagnostics).includes("private diagnostic detail"));
});
