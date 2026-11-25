// Admin script: creates single-use pilot invite codes. Prints each code once; only a hash is stored.
// Usage: npm run -s invite -- [--count 5] [--label "Humble Halal cohort 1"] [--days 30]
// Uses DATABASE_URL (and INKSHOT_SHARED_PROJECT_LIVE) exactly like the app; without it, the local dev database.
import { createDatabase } from "../server/db.js";
import { createInvite } from "../server/pilot-access.js";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const count = Number(arg("count") ?? 1);
const days = arg("days") === undefined ? undefined : Number(arg("days"));
if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("--count must be 1 to 50.");
if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) throw new Error("--days must be 1 to 365.");
if (!process.env.DATABASE_URL && !process.argv.includes("--local"))
  throw new Error("DATABASE_URL is not set, so these codes would only work against a throwaway local database. Set DATABASE_URL (and BILLING_MODE/GENERATION_MODE to match the target) or pass --local.");
const db = await createDatabase();
try {
  for (let i = 0; i < count; i++) console.log(await createInvite(db, arg("label") ?? "", days));
} finally { await db.close(); }
