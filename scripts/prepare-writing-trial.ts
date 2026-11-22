// Offline only: exports reproducible requests; never loads keys or calls providers.
import { createHash } from "node:crypto";
import { BRIEF_SYSTEM_PROMPT, BRIEF_PROMPT_VERSION } from "../server/brief-prompt.js";
import fixtures from "../benchmarks/briefs/fixtures.json";
import baseline from "../benchmarks/briefs/baseline.json";

const smokeIds = new Set(["LB01", "BK02", "HL04", "IN08"]);
const selected = process.argv.includes("--full") ? fixtures : fixtures.filter(f => smokeIds.has(f.id));
const requests = selected.flatMap(f => [
  { version: `baseline:${baseline.commit}`, system: baseline.prompt },
  { version: BRIEF_PROMPT_VERSION, system: BRIEF_SYSTEM_PROMPT },
].map(p => ({
  caseId: f.id,
  version: p.version,
  inputHash: createHash("sha256").update(JSON.stringify(f.pages)).digest("hex"),
  system: p.system,
  input: f.pages,
  maxOutputTokens: 5000,
  review: f.review,
})));
if (new Set(fixtures.map(f => f.id)).size !== 12) throw new Error("Expected 12 distinct benchmark cases");
for (const r of requests) {
  if (Buffer.byteLength(r.system) + Buffer.byteLength(JSON.stringify(r.input)) > 128 * 1024)
    throw new Error(`Oversized fixture: ${r.caseId}`);
}
console.log(JSON.stringify({
  status: "prepared-not-executed",
  networkCalls: 0,
  requestCount: requests.length,
  repeats: 1,
  automaticRetries: 0,
  financialCap: null,
  blockers: ["Configure a writing-provider key securely", "Approve a monetary cap and enforce it at the provider", "Pin and verify model availability and pricing"],
  limitations: ["LB01 uses a short verified excerpt, not a full crawl", "Schema and excerpt matching do not establish semantic correctness", "No quality score until model outputs and human review exist"],
  requests,
}, null, 2));
