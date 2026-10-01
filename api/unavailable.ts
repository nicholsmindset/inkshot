import type { IncomingMessage, ServerResponse } from "node:http";

// The local persistent worker must not be started inside a serverless request.
// Replace this adapter once managed identity, database and worker are connected.
export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 503;
  res.end(JSON.stringify({ error: "This is an Inkshot preview. Account creation and generation will open when setup is complete." }));
}
