import { config } from "./config.js";
import { createDatabase } from "./db.js";
import { createApp } from "./app.js";
import { startWorker } from "./worker.js";
if (config.production)
  throw new Error(
    "Production launch is gated pending managed identity, payment fulfillment, private object storage and live provider validation. See README.",
  );
const db = await createDatabase();
const app = createApp(db);
const stopWorker = startWorker(db);
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(
    `Inkshot API ready at http://127.0.0.1:${config.port} · ${config.mode} generation`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopWorker();
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });
