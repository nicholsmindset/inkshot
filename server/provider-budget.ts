import { createHash } from "node:crypto";
import type { Database, Queryable } from "./db.js";
import { AppError } from "./config.js";
import * as hf from "./higgsfield.js";

type Reservation = { input_hash: string; provider_request_id: string | null };
type Provider = Pick<typeof hf, "estimate" | "submit">;

async function findReservation(db: Queryable, key: string) {
  return (await db.query<Reservation>(
    "SELECT input_hash,provider_request_id FROM provider_spend WHERE request_key=$1",
    [key],
  )).rows[0];
}

function recover(reservation: Reservation, digest: string) {
  if (reservation.input_hash !== digest) throw new Error("Provider idempotency input changed");
  if (!reservation.provider_request_id)
    throw new AppError(503, "Provider submission is awaiting confirmation.");
  return { request_id: reservation.provider_request_id };
}

// A reservation is also the single right to submit. After a crash, a missing
// receipt may mean a paid request already ran. Only resume known request IDs.
export async function submitBudgeted(
  db: Database, model: string, input: unknown, key: string, provider: Provider = hf,
): Promise<{ request_id: string }> {
  const digest = createHash("sha256").update(JSON.stringify({ model, input })).digest("hex");
  const existing = await findReservation(db, key);
  if (existing) return recover(existing, digest);

  const quote = await provider.estimate(model, input);
  const amount = Number(quote.usd);
  const cap = Number(process.env.HF_DAILY_BUDGET_USD || "0");
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cap) || cap <= 0)
    throw new AppError(503, "A valid generation spending limit is required.");

  const competing = await db.transaction(async tx => {
    await tx.query("LOCK TABLE provider_spend IN EXCLUSIVE MODE");
    const reservation = await findReservation(tx, key);
    if (reservation) return reservation;
    const used = Number((await tx.query<{ used: string }>(
      "SELECT COALESCE(sum(usd),0)::text AS used FROM provider_spend WHERE created_at >= date_trunc('day',now())",
    )).rows[0].used);
    if (used + amount > cap) throw new AppError(503, "The daily generation spending limit has been reached.");
    await tx.query("INSERT INTO provider_spend(request_key,input_hash,usd) VALUES($1,$2,$3)", [key, digest, amount]);
  });
  if (competing) return recover(competing, digest);

  const receipt = await provider.submit(model, input, key);
  if (typeof receipt.request_id !== "string" || !receipt.request_id.trim())
    throw new AppError(503, "The provider did not return a request ID.");
  await db.query("UPDATE provider_spend SET provider_request_id=$2 WHERE request_key=$1", [key, receipt.request_id]);
  return { request_id: receipt.request_id };
}
