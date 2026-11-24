import { createHash, randomUUID } from 'node:crypto';
import type { Database, Queryable } from './db.js';
import type { User } from '../shared/types.js';
import { AppError } from './config.js';
import { reportOpsAlert } from './ops.js';
import { reconcileBillingForDeletion, type DeletionBillingReader } from './billing.js';

export const deletionEnabled = () => process.env.ENABLE_ACCOUNT_DELETION === 'true' && process.env.INKSHOT_SHARED_PROJECT_LIVE !== 'true';
export const identityHash = (id: string) => createHash('sha256').update(id).digest('hex');
export async function rejectDeletedIdentity(db: Queryable, id: string) {
  if ((await db.query('SELECT id FROM account_deletions WHERE user_hash=$1', [identityHash(id)])).rows.length)
    throw new AppError(410, 'Account deletion has been requested. Your studio is closed while deletion is processed.');
}
export async function rejectFrozenWorkspace(db: Queryable, workspaceId: string) {
  if ((await db.query('SELECT id FROM workspaces WHERE id=$1 AND deletion_requested_at IS NOT NULL',[workspaceId])).rows.length)
    throw new AppError(410, 'Account deletion has been requested. Your studio is closed while deletion is processed.');
}
export async function requestDeletion(db: Database, user: User, readBilling?: DeletionBillingReader) {
  if (!deletionEnabled()) throw new AppError(503,'Account deletion is not enabled for this environment.');
  if (user.demo) throw new AppError(400,'Preview demo accounts cannot request deletion.');
  return db.transaction(async tx => {
    await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[user.workspaceId]);
    const existing = (await tx.query<{id:string;state:string}>('SELECT id,state FROM account_deletions WHERE workspace_id=$1 AND user_hash=$2',[user.workspaceId,identityHash(user.id)])).rows[0];
    if(existing) return existing;
    const members = (await tx.query<{id:string}>('SELECT id FROM users WHERE workspace_id=$1',[user.workspaceId])).rows;
    if(members.length!==1 || members[0].id!==user.id) throw new AppError(409,'Shared workspaces require an ownership review before deletion.');
    await reconcileBillingForDeletion(tx,user.workspaceId,readBilling);
    if((await tx.query("SELECT id FROM jobs WHERE workspace_id=$1 AND state IN ('queued','processing') LIMIT 1",[user.workspaceId])).rows.length)
      throw new AppError(409,'Wait for current creative jobs to finish before deleting your account.');
    if((await tx.query<{present:boolean}>("SELECT to_regclass('campaign_exports') IS NOT NULL AS present")).rows[0].present &&
      (await tx.query("SELECT id FROM campaign_exports WHERE workspace_id=$1 AND state IN ('queued','processing') LIMIT 1",[user.workspaceId])).rows.length)
      throw new AppError(409,'Wait for current downloads to finish before deleting your account.');
    // Never retry an unresolved provider submission while deleting: that could create new spend.
    if((await tx.query("SELECT request_key FROM provider_spend p JOIN versions v ON split_part(p.request_key,':',1)=v.id WHERE v.workspace_id=$1 AND p.provider_request_id IS NULL LIMIT 1",[user.workspaceId])).rows.length)
      throw new AppError(409,'A generation receipt needs reconciliation before account deletion.');
    const id=randomUUID();
    await tx.query('UPDATE workspaces SET deletion_requested_at=now() WHERE id=$1',[user.workspaceId]);
    await tx.query('INSERT INTO account_deletions(id,workspace_id,user_id,user_hash,managed_auth) VALUES($1,$2,$3,$4,$5)',[id,user.workspaceId,user.id,identityHash(user.id),process.env.AUTH_PROVIDER==='supabase']);
    return {id,state:'pending'};
  });
}

type Task={id:string;workspace_id:string;user_id:string;user_hash:string;managed_auth:boolean;provider_ids:string[];provider_deleted:string[];provider_done:boolean;storage_done:boolean;auth_done:boolean};
export type DeletionAdapters={
  deleteProviderRequest:(id:string)=>Promise<void>;
  deleteWorkspaceStorage:(workspaceId:string)=>Promise<void>;
  deleteAuthUser:(id:string)=>Promise<void>;
};
export async function runDeletionOnce(db: Database, adapters: DeletionAdapters):Promise<boolean> {
  if(!deletionEnabled()) return false;
  const task=await db.transaction(async tx=>{
    const task=(await tx.query<Task>("SELECT * FROM account_deletions WHERE state<>'complete' AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if(!task)return;
    await tx.query("UPDATE account_deletions SET state='deleting',locked_until=now()+interval '10 minutes',attempts=attempts+1,error_code=NULL WHERE id=$1",[task.id]);
    return task;
  });
  if(!task)return false;
  let stage='provider';
  try {
    // Snapshot identifiers only. Persist before external calls so retries can repeat safely.
    if(!task.provider_done){
      const receipts=(await db.query<{provider_request_id:string}>("SELECT p.provider_request_id FROM provider_spend p JOIN versions v ON split_part(p.request_key,':',1)=v.id WHERE v.workspace_id=$1 AND p.provider_request_id IS NOT NULL",[task.workspace_id])).rows;
      const checkpoints=(await db.query<{checkpoint:Record<string,unknown>}>('SELECT checkpoint FROM jobs WHERE workspace_id=$1',[task.workspace_id])).rows;
      const ids=new Set(task.provider_ids);
      for(const row of receipts)ids.add(row.provider_request_id);
      for(const row of checkpoints)for(const key of ['imageId','videoId'])if(typeof row.checkpoint[key]==='string')ids.add(row.checkpoint[key] as string);
      await db.query('UPDATE account_deletions SET provider_ids=$2 WHERE id=$1',[task.id,JSON.stringify([...ids])]);
      const deleted=new Set(task.provider_deleted);
      for(const id of [...ids].filter(id=>!deleted.has(id)).slice(0,3)){
        await adapters.deleteProviderRequest(id);deleted.add(id);
        await db.query('UPDATE account_deletions SET provider_deleted=$2 WHERE id=$1',[task.id,JSON.stringify([...deleted])]);
      }
      await db.query('UPDATE account_deletions SET provider_done=$2,locked_until=NULL,available_at=now() WHERE id=$1',[task.id,[...ids].every(id=>deleted.has(id))]);
      return true;
    }
    stage='storage';
    if(!task.storage_done){await adapters.deleteWorkspaceStorage(task.workspace_id);await db.query('UPDATE account_deletions SET storage_done=true,locked_until=NULL,available_at=now() WHERE id=$1',[task.id]);return true;}
    stage='identity';
    if(!task.auth_done){
      if(task.managed_auth)await adapters.deleteAuthUser(task.user_id);
      await db.query('UPDATE account_deletions SET auth_done=true,locked_until=NULL,available_at=now() WHERE id=$1',[task.id]);return true;
    }
    stage='database';
    await db.transaction(async tx=>{
      // Matches first-login provisioning; the hash tombstone prevents recreation by a stale verified request.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[task.user_id]);
      if((await tx.query<{present:boolean}>("SELECT to_regclass('provider_events') IS NOT NULL AS present")).rows[0].present)
        await tx.query('DELETE FROM provider_events WHERE request_id=ANY($1::text[])',[task.provider_ids]);
      if((await tx.query<{present:boolean}>("SELECT to_regclass('campaign_exports') IS NOT NULL AS present")).rows[0].present)
        await tx.query('DELETE FROM campaign_exports WHERE workspace_id=$1',[task.workspace_id]);
      // Keep spend totals for the daily budget while removing provider IDs and version linkage.
      await tx.query("UPDATE provider_spend p SET request_key=$2||md5(p.request_key),input_hash='deleted',provider_request_id=NULL FROM versions v WHERE split_part(p.request_key,':',1)=v.id AND v.workspace_id=$1",[task.workspace_id,`deleted:${task.id}:`]);
      await tx.query("DELETE FROM writing_daily_usage WHERE scope=$1",[`workspace:${task.workspace_id}`]);
      for(const table of ['jobs','versions','assets','campaigns','uploads','ledger','billing_accounts'])
        await tx.query(`DELETE FROM ${table} WHERE workspace_id=$1`,[task.workspace_id]);
      await tx.query('DELETE FROM users WHERE workspace_id=$1',[task.workspace_id]);
      await tx.query('DELETE FROM workspaces WHERE id=$1',[task.workspace_id]);
      await tx.query("UPDATE account_deletions SET state='complete',user_id=NULL,provider_ids='[]',provider_deleted='[]',locked_until=NULL,error_code=NULL,completed_at=now() WHERE id=$1",[task.id]);
    });
  }catch{
    // Only an aggregate event is allowed; never log the task or adapter error.
    reportOpsAlert('inkshot_deletion_failed', { count: 1 });
    // Never report completion while a provider, storage or identity call is uncertain.
    await db.query("UPDATE account_deletions SET locked_until=NULL,error_code=$2,available_at=now()+interval '5 minutes' WHERE id=$1",[task.id,`DELETION_${stage.toUpperCase()}_RETRY`]);
  }
  return true;
}
