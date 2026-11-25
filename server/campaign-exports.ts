import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import type { Database, Queryable } from './db.js';
import type { Brand } from '../shared/types.js';
import { AppError, config } from './config.js';
import { materializeMedia, persistMedia } from './storage.js';
import { assertExportReviewed } from './asset-review.js';

export type ExportCategory = 'all' | 'video' | 'image' | 'post';
type Entry = { id: string; kind: string; title: string; caption: string; n: number; headline: string; cta: string; file_path: string; mock: boolean };
type Manifest = { entries: Entry[]; destinationUrl?: string; failureCode?: 'archive_too_large' };
export type CampaignExport = { id: string; workspace_id: string; campaign_id: string; category: ExportCategory; state: string; file_path: string | null; attempts: number; manifest: Manifest };

export async function requestCampaignExport(database: Database, campaignId: string, workspaceId: string, category: ExportCategory) {
  return database.transaction(async db => {
  const workspace=(await db.query<{deletion_requested_at:string|null}>('SELECT deletion_requested_at FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId])).rows[0];
  if(!workspace) throw new AppError(404,'Campaign not found.');
  if(workspace.deletion_requested_at) throw new AppError(410,'This account is being deleted.');
  const campaign = (await db.query<{ brand: Brand & { destinationUrl?: string }; draft: unknown }>('SELECT brand,draft FROM campaigns WHERE id=$1 AND workspace_id=$2', [campaignId, workspaceId])).rows[0];
  if (!campaign) throw new AppError(404, 'Campaign not found.');
  const entries = (await db.query<Entry>(`SELECT v.id,a.kind,a.title,a.caption,v.n,v.headline,v.cta,v.file_path,v.mock FROM assets a
    JOIN versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id
    WHERE a.campaign_id=$1 AND a.workspace_id=$2 AND v.status='ready' AND ($3='all' OR a.kind=$3) ORDER BY a.id`, [campaignId, workspaceId, category])).rows;
  if (!entries.length) throw new AppError(400, 'No ready assets in this category yet.');
  if (entries.length > 30) throw new AppError(400, 'Download this campaign in smaller categories.');
  await assertExportReviewed(db,workspaceId,entries.map(entry=>entry.id));
  const manifest: Manifest = { entries, destinationUrl: campaign.brand.destinationUrl };
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const row = (await db.query<CampaignExport>(`INSERT INTO campaign_exports(id,workspace_id,campaign_id,category,fingerprint,manifest)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,campaign_id,category,fingerprint)
    DO UPDATE SET state=CASE WHEN campaign_exports.state='failed' AND campaign_exports.manifest->>'failureCode' IS DISTINCT FROM 'archive_too_large' THEN 'queued' ELSE campaign_exports.state END,
    attempts=CASE WHEN campaign_exports.state='failed' AND campaign_exports.manifest->>'failureCode' IS DISTINCT FROM 'archive_too_large' THEN 0 ELSE campaign_exports.attempts END,
    available_at=CASE WHEN campaign_exports.state='failed' AND campaign_exports.manifest->>'failureCode' IS DISTINCT FROM 'archive_too_large' THEN now() ELSE campaign_exports.available_at END
    RETURNING *`, [randomUUID(),workspaceId,campaignId,category,fingerprint,JSON.stringify(manifest)])).rows[0];
  return row;
  });
}

// Return only allowlisted diagnostics, never storage paths or provider errors.
export function campaignExportFailureCode(row: CampaignExport) {
  return row.state === 'failed' && row.manifest.failureCode === 'archive_too_large' ? 'archive_too_large' : undefined;
}

export async function findCampaignExport(db: Database, id: string, workspaceId: string) {
  const row = (await db.query<CampaignExport>('SELECT * FROM campaign_exports WHERE id=$1 AND workspace_id=$2', [id,workspaceId])).rows[0];
  if (!row) throw new AppError(404, 'Download not found.');
  return row;
}

export async function runExportOnce(db: Database): Promise<boolean> {
  const row = await db.transaction(async tx => {
    // Follow workspace → claim mutex → export order, also used by deletion.
    const candidate=(await tx.query<CampaignExport>(`SELECT e.* FROM campaign_exports e JOIN workspaces w ON w.id=e.workspace_id
      WHERE w.deletion_requested_at IS NULL AND ((e.state='queued' AND e.available_at<=now()) OR (e.state='processing' AND e.locked_until<now())) ORDER BY e.created_at,e.id LIMIT 1`)).rows[0];
    if(!candidate) return undefined;
    const workspace=(await tx.query<{deletion_requested_at:string|null}>('SELECT deletion_requested_at FROM workspaces WHERE id=$1 FOR UPDATE',[candidate.workspace_id])).rows[0];
    if(!workspace || workspace.deletion_requested_at) return undefined;
    // Only one archive runs at a time, without a table lock blocking requests.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('inkshot-export-claim'))");
    if ((await tx.query("SELECT id FROM campaign_exports WHERE state='processing' AND locked_until>now() LIMIT 1")).rows.length) return undefined;
    const found = (await tx.query<CampaignExport>(`SELECT * FROM campaign_exports WHERE id=$1 AND ((state='queued' AND available_at<=now()) OR (state='processing' AND locked_until<now())) FOR UPDATE SKIP LOCKED`,[candidate.id])).rows[0];
    if (!found) return undefined;
    await tx.query("UPDATE campaign_exports SET state='processing',attempts=attempts+1,locked_until=now()+interval '5 minutes' WHERE id=$1", [found.id]);
    found.attempts++; return found;
  });
  if (!row) return false;
  const dir = path.join(config.dataDir, 'exports', row.id);
  let zip: ZipArchive | undefined;
  let output: ReturnType<typeof createWriteStream> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let pendingMedia: Promise<unknown> | undefined;
  try {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${row.id}.zip`);
    zip = new ZipArchive({ zlib: { level: 1 } });
    output = createWriteStream(file);
    const completed = finished(output);
    // Attach rejection handling immediately, including while inputs are downloaded.
    completed.catch(() => {});
    zip.on('error', error => output!.destroy(error));
    zip.on('warning', error => output!.destroy(error));
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const error=new Error('Archive deadline reached'); controller.abort(error); zip?.abort(); output!.destroy(error); reject(error); }, 150_000);
    });
    deadline.catch(() => {});
    zip.pipe(output);
    let bytes = 0;
    for (const [index, entry] of row.manifest.entries.entries()) {
      const media = materializeMedia(entry.file_path, row.workspace_id, 'generated-media', controller.signal, path.join(dir, 'inputs'));
      pendingMedia = media;
      const source = await Promise.race([media,deadline]);
      bytes += (await stat(source)).size;
      // Existing private bucket limit is 100 MiB. Keep headroom for ZIP headers/captions.
      if (bytes > 95 * 1024 * 1024) throw new AppError(413, 'Download this campaign in smaller categories.');
      zip.file(source, { name: `${index+1}-${entry.kind}${path.extname(entry.file_path)}` });
    }
    zip.append(row.manifest.entries.map(entry => `${entry.title}\n${entry.caption || [entry.headline,entry.cta].join('\n')}`).join('\n\n---\n\n'), { name: 'captions.txt' });
    if (row.manifest.destinationUrl) zip.append(row.manifest.destinationUrl+'\n', { name: 'destination-url.txt' });
    if (row.manifest.entries.some(entry => entry.mock)) zip.append('Sample creatives for product preview. Videos are still-image previews, not paid provider generations.', { name: 'SAMPLE-README.txt' });
    await Promise.race([zip.finalize(),deadline]); await Promise.race([completed,deadline]);
    const upload = persistMedia(file, row.workspace_id, 'generated-media', controller.signal);
    pendingMedia = upload;
    const stored = await Promise.race([upload,deadline]);
    await writeExportState(db,row,tx=>tx.query("UPDATE campaign_exports SET state='ready',file_path=$2,locked_until=NULL WHERE id=$1", [row.id,stored]));
    if (stored.startsWith('supabase://')) await rm(dir, { recursive: true, force: true });
  } catch (error) {
    controller.abort();
    // Do not release the lease while an aborted upload/download can still finish.
    await pendingMedia?.catch(() => {});
    zip?.abort(); output?.destroy();
    await rm(dir,{recursive:true,force:true});
    if(error instanceof AppError && error.status===413) {
      await writeExportState(db,row,tx=>tx.query("UPDATE campaign_exports SET state='failed',locked_until=NULL,manifest=jsonb_set(manifest,'{failureCode}','\"archive_too_large\"'::jsonb) WHERE id=$1", [row.id]));
    } else {
      await writeExportState(db,row,tx=>tx.query("UPDATE campaign_exports SET state=$2,locked_until=NULL,available_at=now()+interval '15 seconds' WHERE id=$1", [row.id,row.attempts>=3?'failed':'queued']));
    }
  } finally { controller.abort(); if (timer) clearTimeout(timer); }
  return true;
}

// Completion must not lock an export before the workspace trigger does. Attempts
// fence stale workers so a reclaimed lease cannot be overwritten by old output.
async function writeExportState(db:Database,row:CampaignExport,write:(tx:Queryable)=>Promise<unknown>) {
  return db.transaction(async tx=>{
    const workspace=(await tx.query<{deletion_requested_at:string|null}>('SELECT deletion_requested_at FROM workspaces WHERE id=$1 FOR UPDATE',[row.workspace_id])).rows[0];
    if(!workspace || workspace.deletion_requested_at) return false;
    const current=(await tx.query<{attempts:number;state:string}>('SELECT attempts,state FROM campaign_exports WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[row.id,row.workspace_id])).rows[0];
    if(!current || current.state!=='processing' || current.attempts!==row.attempts) return false;
    await write(tx); return true;
  });
}
