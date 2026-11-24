import { createApp } from "../server/app.js";
import { hostedDatabase } from "../server/hosted.js";
import { assertHostedConfiguration } from "../server/config.js";
import { createHostedHandler } from "../server/hosted-handler.js";

import { createOpsStatusHandler } from "../server/ops.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const application = createHostedHandler({
  assertConfiguration: assertHostedConfiguration,
  database: hostedDatabase,
  createApp,
});

const status = createOpsStatusHandler(hostedDatabase);
export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Keep diagnostics available even when normal app initialization fails.
  if (req.url?.split("?")[0] === "/api/ops/status") return status(req, res);
  return application(req, res);
}
