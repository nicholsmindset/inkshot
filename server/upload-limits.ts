import type { Database, Queryable } from './db.js';
import { AppError } from './config.js';

// These are storage safety limits, not a paid-plan entitlement. Existing rows
// receive a conservative 10 MiB charge in the migration until measured.
export const UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_WORKSPACE_BYTES = 250 * 1024 * 1024;
export const UPLOAD_MAX_WORKSPACE_FILES = 100;

export async function withUploadQuota<T>(
  db: Database, workspaceId: string, incomingBytes: number,
  save: (tx: Queryable) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes <= 0 || incomingBytes > UPLOAD_MAX_FILE_BYTES)
    throw new AppError(413, 'Choose a photo or logo smaller than 10 MiB after processing.');
  return db.transaction(async tx => {
    // All upload paths use the workspace row, including imports. The callback
    // commits a size-bearing reservation before external storage persistence;
    // ambiguous upload failures must retain that row until cleanup is confirmed.
    const workspace = (await tx.query<{ deletion_requested_at: unknown }>(
      'SELECT deletion_requested_at FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId],
    )).rows[0];
    if (!workspace) throw new AppError(404, 'Workspace not found.');
    if (workspace.deletion_requested_at) throw new AppError(410, 'Account deletion has been requested.');
    const usage = (await tx.query<{ files: string; bytes: string }>(
      'SELECT count(*)::text AS files,coalesce(sum(size_bytes),0)::text AS bytes FROM uploads WHERE workspace_id=$1',
      [workspaceId],
    )).rows[0];
    if (Number(usage.files) >= UPLOAD_MAX_WORKSPACE_FILES || Number(usage.bytes) + incomingBytes > UPLOAD_MAX_WORKSPACE_BYTES)
      throw new AppError(413, 'Your workspace upload limit has been reached. Remove unused uploads before adding another file.');
    return save(tx);
  });
}
