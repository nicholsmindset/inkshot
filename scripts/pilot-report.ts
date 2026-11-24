// Admin-only, read-only. Prints per-merchant and overall pilot metrics from product_events.
// Usage: npx tsx scripts/pilot-report.ts [--days 7] [--json]
import { createDatabase } from "../server/db.js";
import { buildPilotReport } from "../server/pilot-report.js";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const days = arg("days") ? Number(arg("days")) : undefined;
if (days !== undefined && (!Number.isFinite(days) || days <= 0)) throw new Error("--days must be a positive number.");
const db = await createDatabase();
try {
  const report = await buildPilotReport(db, { since: days ? new Date(Date.now() - days * 86400e3) : undefined });
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("\nOverall"); console.table([{ ...report.overall, failureReasons: JSON.stringify(report.overall.failureReasons) }]);
    console.log("Per merchant"); console.table(report.merchants.map(m => ({ ...m, workspaceId: m.workspaceId.slice(0, 8), failureReasons: JSON.stringify(m.failureReasons) })));
    console.log("Definitions\n- " + report.definitions.join("\n- "));
  }
} finally { await db.close(); }
