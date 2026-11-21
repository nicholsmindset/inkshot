import type { Database, Queryable } from './db.js';
import { AppError } from './config.js';
import { removePrivateMedia } from './storage.js';

// Reservations commit before external persistence. The grace window exceeds
// the HTTP function's 120-second lifetime so another tab cannot remove an
// in-flight reservation and let its late write become an untracked object.
const inUseSql = `(u.created_at>now()-interval '5 minutes'
  OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=u.workspace_id AND position(u.id in w.brand::text)>0)
  OR EXISTS(SELECT 1 FROM campaigns c WHERE c.workspace_id=u.workspace_id
    AND (position(u.id in c.brand::text)>0 OR position(u.id in coalesce(c.draft::text,''))>0)))`;

export type ManagedUpload = { id: string; sizeBytes: number; createdAt: string; inUse: boolean };

export async function listUploads(db: Queryable, workspaceId: string): Promise<ManagedUpload[]> {
  const rows=(await db.query<{id:string;size_bytes:string;created_at:Date|string;in_use:boolean}>(
    `SELECT u.id,u.size_bytes::text,u.created_at,${inUseSql} AS in_use FROM uploads u
     WHERE u.workspace_id=$1 ORDER BY u.created_at DESC,u.id LIMIT 100`,[workspaceId])).rows;
  return rows.map(row=>({id:row.id,sizeBytes:Number(row.size_bytes),createdAt:typeof row.created_at==='string'?row.created_at:row.created_at.toISOString(),inUse:row.in_use}));
}

export async function removeUnusedUpload(db:Database,workspaceId:string,uploadId:string) {
  return db.transaction(async tx=>{
    // Reference-setting routes must take this same lock before validating and
    // saving upload IDs. That prevents a new reference during storage removal.
    const workspace=(await tx.query<{deletion_requested_at:unknown}>(
      'SELECT deletion_requested_at FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId])).rows[0];
    if(!workspace)throw new AppError(404,'Workspace not found.');
    if(workspace.deletion_requested_at)throw new AppError(410,'Account deletion has been requested.');
    const row=(await tx.query<{file_path:string;in_use:boolean}>(
      `SELECT u.file_path,${inUseSql} AS in_use FROM uploads u WHERE u.id=$1 AND u.workspace_id=$2 FOR UPDATE`,[uploadId,workspaceId])).rows[0];
    if(!row)throw new AppError(404,'Upload not found.');
    if(row.in_use)throw new AppError(409,'This upload is still processing or used by your brand or a campaign. Wait five minutes after uploading; keep files used by existing creatives.');
    // Ambiguous storage failures abort the transaction and retain quota. A
    // retry is safe: deleting an already absent object succeeds idempotently.
    await removePrivateMedia(row.file_path,workspaceId,'brand-uploads');
    await tx.query('DELETE FROM uploads WHERE id=$1 AND workspace_id=$2',[uploadId,workspaceId]);
    return {ok:true};
  });
}
