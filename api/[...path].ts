import { createApp } from "../server/app.js";
import { hostedDatabase } from "../server/hosted.js";
import { assertHostedConfiguration } from "../server/config.js";
import { createHostedHandler } from "../server/hosted-handler.js";

export default createHostedHandler({
  assertConfiguration: assertHostedConfiguration,
  database: hostedDatabase,
  createApp,
});
