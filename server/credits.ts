import { randomUUID } from "node:crypto";
import type { Queryable } from "./db";
import { AppError } from "./config";
export async function changeCredits(
  tx: Queryable,
  workspaceId: string,
  amount: number,
  kind: string,
  description: string,
  key: string,
) {
  await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
    workspaceId,
  ]);
  if (
    (await tx.query("SELECT id FROM ledger WHERE event_key=$1", [key])).rows
      .length
  )
    return false;
  const result = await tx.query(
    "UPDATE workspaces SET credits=credits+$2 WHERE id=$1 AND credits+$2>=0 RETURNING credits",
    [workspaceId, amount],
  );
  if (!result.rows.length)
    throw new AppError(
      402,
      "You do not have enough credits for this generation.",
    );
  await tx.query(
    "INSERT INTO ledger(id,workspace_id,amount,kind,description,event_key) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), workspaceId, amount, kind, description, key],
  );
  return true;
}
