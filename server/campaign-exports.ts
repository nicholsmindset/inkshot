import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import type { Database } from './db.js';
import type { Brand } from '../shared/types.js';
import { AppError, config } from './config.js';
import { materializeMedia, persistMedia } from './storage.js';

export type ExportCategory = 'all' | 'video' | 'image' | 'post';
type Entry = { id: string; kind: string; title: string; caption: string; n: number; headline: string; cta: string; file_path: string; mock: boolean };
type Manifest = { entries: Entry[]; destinationUrl?: string };
export type CampaignExport = { id: string; workspace_id: string; campaign_id: string; category: ExportCategory; state: string; file_path: string | null; attempts: number; manifest: Manifest };

export async function requestCampaignExport(db: Database, campaignId: string, workspaceId: string, category: ExportCategory) {
  const campaign = (await db.query<{ brand: Brand & { destinationUrl?: string }; draft: unknown }>('SELECT brand,draft FROM campaigns WHERE id=$1 AND workspace_id=$2', [campaignId, workspaceId])).rows[0];
  if (!campaign) throw new AppError(404, 'Campaign not found.');
  const entries = (await db.query<Entry>(`SELECT v.id,a.kind,a.title,a.caption,v.n,v.headline,v.cta,v.file_path,v.mock FROM assets a
    JOIN versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id
    WHERE a.campaign_id=$1 AND a.workspace_id=$2 AND v.status='ready' AND ($3='all' OR a.kind=$3) ORDER BY a.id`, [campaignId, workspaceId, category])).rows;
  if (!entries.length) throw new AppError(400, 'No ready assets in this category yet.');
  if (entries.length > 30) throw new AppError(400, 'Download this campaign in smaller categories.');
  for (const entry of entries) {
    if (entry.n > 1 && !campaign.draft) entry.caption = [entry.headline, campaign.brand.description, [entry.cta, campaign.brand.destinationUrl].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
  }
  const manifest: Manifest = { entries, destinationUrl: campaign.brand.destinationUrl };
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const row = (await db.query<CampaignExport>(`INSERT INTO campaign_exports(id,workspace_id,campaign_id,category,fingerprint,manifest)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,campaign_id,category,fingerprint)
    DO UPDATE SET state=CASE WHEN campaign_exports.state='failed' THEN 'queued' ELSE campaign_exports.state END,
    attempts=CASE WHEN campaign_exports.state='failed' THEN 0 ELSE campaign_exports.attempts END,
    available_at=CASE WHEN campaign_exports.state='failed' THEN now() ELSE campaign_exports.available_at END
    RETURNING *`, [randomUUID(),workspaceId,campaignId,category,fingerprint,JSON.stringify(manifest)])).rows[0];
  return row;
}

export async function findCampaignExport(db: Database, id: string, workspaceId: string) {
  const row = (await db.query<CampaignExport>('SELECT * FROM campaign_exports WHERE id=$1 AND workspace_id=$2', [id,workspaceId])).rows[0];
  if (!row) throw new AppError(404, 'Download not found.');
  return row;
}

export async function runExportOnce(db: Database): Promise<boolean> {
  const row = await db.transaction(async tx => {
    // Only one archive runs at a time, independently of media-generation slots.
    await tx.query('LOCK TABLE campaign_exports IN EXCLUSIVE MODE');
    if ((await tx.query("SELECT id FROM campaign_exports WHERE state='processing' AND locked_until>now() LIMIT 1")).rows.length) return undefined;
    const found = (await tx.query<CampaignExport>(`SELECT * FROM campaign_exports WHERE (state='queued' AND available_at<=now()) OR (state='processing' AND locked_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
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
    await db.query("UPDATE campaign_exports SET state='ready',file_path=$2,locked_until=NULL WHERE id=$1", [row.id,stored]);
    if (stored.startsWith('supabase://')) await rm(dir, { recursive: true, force: true });
  } catch {
    controller.abort();
    // Do not release the lease while an aborted upload/download can still finish.
    await pendingMedia?.catch(() => {});
    zip?.abort(); output?.destroy();
    await rm(dir,{recursive:true,force:true});
    await db.query("UPDATE campaign_exports SET state=$2,locked_until=NULL,available_at=now()+interval '15 seconds' WHERE id=$1", [row.id,row.attempts>=3?'failed':'queued']);
  } finally { controller.abort(); if (timer) clearTimeout(timer); }
  return true;
}
