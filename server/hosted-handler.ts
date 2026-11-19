import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { hostedConfigurationCodes } from "./config.js";
import { reportOpsAlert } from "./ops.js";
import { schemaReadinessCodes } from "./schema-readiness.js";

type Stage = "configuration" | "database" | "application" | "request";
type App = (req: IncomingMessage, res: ServerResponse) => unknown;
type Dependencies = {
  assertConfiguration: () => void;
  database: () => Promise<Database>;
  createApp: (db: Database) => App;
  report?: (diagnostic: { event: string; reference: string; stage: Stage; code?: string }) => void;
};
const diagnosticCodes = new Set<string>([
  ...hostedConfigurationCodes,
  ...schemaReadinessCodes,
  "28P01", "42501", "42P01", "42703", "3D000", "53300", "57P01", "08006",
  "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "CERT_HAS_EXPIRED",
]);
class StartupFailure {
  constructor(readonly stage: Stage, readonly cause: unknown) {}
}

export function createHostedHandler(dependencies: Dependencies) {
  let pending: Promise<App> | undefined;
  async function initialize(): Promise<App> {
    let db: Database;
    try {
      db = await dependencies.database();
    } catch (error) {
      throw new StartupFailure("database", error);
    }
    try {
      return dependencies.createApp(db);
    } catch (error) {
      throw new StartupFailure("application", error);
    }
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    let stage: Stage = "configuration";
    try {
      // Recheck before using a warm app, preserving configuration fail-closed behavior.
      dependencies.assertConfiguration();
      pending ??= initialize().catch(error => {
        pending = undefined;
        throw error;
      });
      const app = await pending;
      stage = "request";
      return app(req, res);
    } catch (error) {
      const reference = randomUUID();
      const cause = error instanceof StartupFailure ? error.cause : error;
      if (error instanceof StartupFailure) stage = error.stage;
      const rawCode = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      const code = typeof rawCode === "string" && diagnosticCodes.has(rawCode) ? rawCode : undefined;
      const diagnostic = { event: "inkshot_service_unavailable", reference, stage, ...(code && { code }) };
      // Raw messages and stack traces can contain database URLs or credentials.
      if (dependencies.report) dependencies.report(diagnostic);
      else console.error(JSON.stringify(diagnostic));
      reportOpsAlert("inkshot_service_unavailable", { reference });
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({
        error: "Inkshot is currently unavailable. Please try again later. If this continues, share the reference below with support.",
        code: "SERVICE_UNAVAILABLE",
        reference,
      }));
    }
  };
}
