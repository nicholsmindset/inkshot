import { reportOpsAlert } from './ops.js';
import {submitBudgeted} from './provider-budget.js';
import {persistMedia,materializeMedia,cloudStorageEnabled} from './storage.js';
import path from "node:path";
import type { Database } from "./db.js";
import { config } from "./config.js";
import { changeCredits } from "./credits.js";
import { renderMedia, downloadOutput } from "./render.js";
import * as hf from "./higgsfield.js";
type Job = {
  id: string;
  version_id: string;
  workspace_id: string;
  attempts: number;
  checkpoint: Record<string, unknown>;
};
type Work = {
  id: string;
  kind: string;
  format: string;
  headline: string;
  cta: string;
  prompt: string;
  motion_prompt?: string | null;
  mock: boolean;
  source_path: string | null;
  credit_cost: number;
  brand: { name: string; color?: string; photoId?: string; logoId?: string };
  asset_id: string;
  campaign_id: string;
};
async function handle(db:Database,job: Job) {
    let work: Work | undefined;
    try {
      work = (
        await db.query<Work>(
          `SELECT v.*,a.kind,a.format,a.campaign_id,c.brand FROM versions v JOIN assets a ON a.id=v.asset_id JOIN campaigns c ON c.id=a.campaign_id WHERE v.id=$1`,
          [job.version_id],
        )
      ).rows[0];
      if (!work) throw new Error("Asset not found");
      await db.query(
        "UPDATE versions SET status='making',error=NULL WHERE id=$1",
        [work.id],
      );
      let source = work.source_path ? await materializeMedia(work.source_path, job.workspace_id, "generated-media") : null;
      async function merchantFile(id: string) {
        const row = (await db.query<{file_path: string}>(
          "SELECT file_path FROM uploads WHERE id=$1 AND workspace_id=$2",
          [id, job.workspace_id],
        )).rows[0];
        if (!row) throw new TerminalFailure("The approved brand file is unavailable. Credits returned.");
        return materializeMedia(row.file_path, job.workspace_id, "brand-uploads");
      }
      if (!source && work.brand.photoId && (work.mock || work.kind !== "video")) {
        source = await merchantFile(work.brand.photoId);
      }
      if (!source && work.mock) source = path.resolve("public/examples/candle.png");
      if (!source && !work.mock) {
        const checkpoint = job.checkpoint;
        const save = async () => {
          await db.query("UPDATE jobs SET checkpoint=$2 WHERE id=$1", [
            job.id,
            JSON.stringify(checkpoint),
          ]);
        };
        if (!checkpoint.imageId) {
          const result = await submitBudgeted(
            db,
            hf.MODELS.image,
            {
              prompt: work.prompt,
              resolution: "1080p",
              aspect_ratio:
                work.kind === "video"
                  ? "9:16"
                  : work.format === "1:1"
                    ? "1:1"
                    : work.format === "1.91:1"
                      ? "16:9"
                      : "3:4",
            },
            `${work.id}:image`,
          );
          checkpoint.imageId = result.request_id;
          await save();
        }
        const image = await hf.status(String(checkpoint.imageId));
        if (["failed", "nsfw", "canceled"].includes(image.status))
          throw new TerminalFailure(
            "The image could not be generated. Credits returned.",
          );
        if (image.status !== "completed") return await requeue(db, job.id);
        if (!image.images?.[0]?.url)
          throw new TerminalFailure("The provider returned no image.");
        if (work.kind === "video") {
          if (!checkpoint.videoId) {
            const result = await submitBudgeted(
            db,
              hf.MODELS.video,
              {
                image_url: image.images[0].url,
                prompt: work.motion_prompt || `Slow deliberate camera movement. ${work.prompt}. No text or logos.`,
                duration: 15,
                sound: "off",
              },
              `${work.id}:video`,
            );
            checkpoint.videoId = result.request_id;
            await save();
          }
          const video = await hf.status(String(checkpoint.videoId));
          if (["failed", "nsfw", "canceled"].includes(video.status))
            throw new TerminalFailure(
              "The video could not be generated. Credits returned.",
            );
          if (video.status !== "completed") return await requeue(db, job.id);
          if (!video.video?.url)
            throw new TerminalFailure("The provider returned no video.");
          source = await downloadOutput(video.video.url, work.id, true);
        } else source = await downloadOutput(image.images[0].url, work.id);
      }
      if (!source) throw new Error("No source media");
      await db.query(
        "UPDATE versions SET status='rendering',source_path=$2 WHERE id=$1",
        [work.id, await persistMedia(source,job.workspace_id,'generated-media')],
      );
      const files = await renderMedia({
        id: work.id,
        source,
        kind: work.kind,
        format: work.format,
        headline: work.headline,
        cta: work.cta,
        brandName: work.brand.name,
        brandColor: work.brand.color,
        logo: work.brand.logoId ? await merchantFile(work.brand.logoId) : undefined,
        mock: work.mock,
      });
      const savedFile = await persistMedia(files.file_path,job.workspace_id,'generated-media');
      const savedPreview = files.preview_path===files.file_path ? savedFile : await persistMedia(files.preview_path,job.workspace_id,'generated-media');
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE versions SET status='ready',file_path=$2,preview_path=$3 WHERE id=$1",
          [work!.id, savedFile, savedPreview],
        );
        await tx.query(
          "UPDATE jobs SET state='done',locked_until=NULL WHERE id=$1",
          [job.id],
        );
        await tx.query(
          "UPDATE assets SET current_version_id=$2 WHERE id=$1 AND (current_version_id IS NULL OR current_version_id IN (SELECT id FROM versions WHERE asset_id=$1 AND n < (SELECT n FROM versions WHERE id=$2)))",
          [work!.asset_id, work!.id],
        );
      });
    } catch (e) {
      reportOpsAlert("inkshot_worker_failed");
      const terminal = e instanceof TerminalFailure;
      const exhausted = job.attempts >= 6;
      if (!terminal && !exhausted) {
        await db.query(
          "UPDATE jobs SET state='queued',locked_until=NULL,available_at=now()+interval '15 seconds' WHERE id=$1",
          [job.id],
        );
        return;
      }
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE versions SET status='failed',error=$2 WHERE id=$1",
          [
            job.version_id,
            terminal
              ? (e as Error).message
              : "Generation or export could not finish. Retry from the asset.",
          ],
        );
        await tx.query(
          "UPDATE jobs SET state='failed',locked_until=NULL WHERE id=$1",
          [job.id],
        );
        if (work)
          await changeCredits(
            tx,
            job.workspace_id,
            work.credit_cost,
            "refund",
            "Credits returned for an unfinished asset",
            `refund:${job.version_id}`,
          );
      });
    } finally {
      if (work)
        await db.query(
          `UPDATE campaigns SET status=CASE WHEN EXISTS(SELECT 1 FROM assets a JOIN versions v ON v.id=a.current_version_id WHERE a.campaign_id=$1 AND v.status IN ('queued','making','rendering')) THEN 'generating' WHEN EXISTS(SELECT 1 FROM assets a JOIN versions v ON v.id=a.current_version_id WHERE a.campaign_id=$1 AND v.status='failed') THEN 'partial' ELSE 'ready' END WHERE id=$1 AND status <> 'draft'`,
          [work.campaign_id],
        );
    }
  }

export async function runWorkerOnce(db:Database):Promise<boolean> {
 if(process.env.DATABASE_URL && !cloudStorageEnabled())
  throw new Error('A managed database requires private cloud media storage.');
 const job=await db.transaction(async tx=>{
  await tx.query('LOCK TABLE jobs IN EXCLUSIVE MODE');
  const active=Number((await tx.query<{n:string}>("SELECT count(*)::text AS n FROM jobs WHERE state='processing' AND locked_until>now()")).rows[0].n);
  if(active>=config.concurrency)return undefined;
  const row=(await tx.query<Job>("SELECT * FROM jobs WHERE (state='queued' AND available_at<=now()) OR (state='processing' AND locked_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
  if(row){await tx.query("UPDATE jobs SET state='processing',locked_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=$1",[row.id]);row.attempts++;}
  return row;
 });
 if(!job)return false;
 await handle(db,job);return true;
}
export function startWorker(db:Database){
 let stopped=false,active=0;
 const timer=setInterval(()=>{
  if(stopped||active>=config.concurrency)return;
  active++;
  void runWorkerOnce(db).catch(()=>{reportOpsAlert('inkshot_worker_failed');console.error('Worker temporarily unavailable');}).finally(()=>active--);
 },1000);
 return ()=>{stopped=true;clearInterval(timer);};
}
async function requeue(db: Database, id: string) {
  await db.query(
    "UPDATE jobs SET state='queued',locked_until=NULL,available_at=now()+interval '5 seconds',attempts=greatest(0,attempts-1) WHERE id=$1",
    [id],
  );
}
class TerminalFailure extends Error {}
