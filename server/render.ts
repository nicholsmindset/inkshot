import staticFfmpeg from 'ffmpeg-static';
import sharp from "sharp";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { config } from "./config.js";
const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function lines(text: string, max = 24) {
  const words = text
    .trim()
    .split(/\s+/)
    .flatMap((word) =>
      word.length > max
        ? word.match(new RegExp(`.{1,${max}}`, "gu")) || []
        : [word],
    );
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    if ((row + " " + word).trim().length > max && row) {
      rows.push(row);
      row = word;
    } else row = (row + " " + word).trim();
  }
  if (row) rows.push(row);
  return rows;
}
export async function ffmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || (process.env.VERCEL ? staticFfmpeg! : config.ffmpeg), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (d) => {
      error = (error + d.toString()).slice(-1000);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Export took too long."));
    }, 120000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("Video export requires FFmpeg."));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error("Video export failed. Please retry the export."));
    });
  });
}
export async function renderMedia(input: {
  id: string;
  source: string;
  kind: string;
  format: string;
  headline: string;
  cta: string;
  brandName: string;
  brandColor?: string;
  logo?: string;
  mock: boolean;
}) {
  const dir = path.join(config.dataDir, "media");
  await mkdir(dir, { recursive: true });
  const width = 1080,
    height =
      input.kind === "video"
        ? 1920
        : input.format === "1:1"
          ? 1080
          : input.format === "1.91:1"
            ? 566
            : 1350;
  const heading = lines(input.headline, height < 800 ? 40 : 27);
  const top = height < 800 ? 130 : 210;
  const fontSize = Math.min(
    height < 800 ? 43 : 65,
    Math.floor((height * 0.34) / (heading.length * 1.15)),
  );
  const lineHeight = Math.ceil(fontSize * 1.15);
  const brandSize = Math.max(
    10,
    Math.min(24, Math.floor(900 / (input.brandName.length * 0.8))),
  );
  const accent = /^#[0-9a-f]{6}$/i.test(input.brandColor || "") ? input.brandColor! : "#78745a";
  const logo = input.logo ? await sharp(input.logo)
    .resize(160, 90, { fit: "inside", withoutEnlargement: true }).png().toBuffer() : undefined;
  const ctaSize = Math.min(29, Math.floor(900 / Math.max(1, [...input.cta].length)));
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${Math.min(height - 160, top + heading.length * lineHeight + 25)}" fill="#fbf9f4" fill-opacity=".84"/>
    <rect x="0" y="0" width="${width}" height="14" fill="${accent}"/>
    <text x="${logo ? 235 : 76}" y="74" font-family="sans-serif" font-size="${brandSize}" letter-spacing="${input.brandName.length > 45 ? 1 : 3}" fill="#34312c">${xml(input.brandName.toUpperCase())}</text>
    ${heading.map((s, i) => `<text x="70" y="${top + i * lineHeight}" font-family="serif" font-size="${fontSize}" fill="#171614">${xml(s)}</text>`).join("")}
    <rect x="60" y="${height - 132}" width="960" height="80" rx="2" fill="#fbf9f4" fill-opacity=".93"/>
    <rect x="60" y="${height - 132}" width="12" height="80" fill="${accent}"/>
    <text x="540" y="${height - 80}" text-anchor="middle" font-family="sans-serif" font-size="${ctaSize}" fill="#171614">${xml(input.cta)}</text>
    ${input.mock ? `<text x="1030" y="${height - 18}" text-anchor="end" font-family="sans-serif" font-size="18" fill="#34312c">SAMPLE CREATIVE</text>` : ""}
  </svg>`;
  const overlay = path.join(dir, `${input.id}-overlay.png`);
  const graphic = sharp(Buffer.from(svg));
  if (logo) graphic.composite([{ input: logo, left: 55, top: 24 }]);
  await graphic.png().toFile(overlay);
  const preview = path.join(dir, `${input.id}.jpg`);
  const output = path.join(dir, `${input.id}.mp4`);
  if (input.kind === "video" && !input.mock && input.source.endsWith(".mp4")) {
    await ffmpeg([
      "-y",
      "-i",
      input.source,
      "-i",
      overlay,
      "-filter_complex",
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];[bg][1:v]overlay=0:0:format=auto[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ]);
    await ffmpeg(["-y", "-i", output, "-frames:v", "1", preview]);
  } else {
    await sharp(input.source)
      .resize(width, height, { fit: "cover", position: "centre" })
      .composite([{ input: overlay }])
      .jpeg({ quality: 88 })
      .toFile(preview);
    if (input.kind === "video")
      await ffmpeg([
        "-y",
        "-loop",
        "1",
        "-i",
        preview,
        "-t",
        "5",
        "-vf",
        "scale=540:960",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output,
      ]);
  }
  return {
    file_path: input.kind === "video" ? output : preview,
    preview_path: preview,
  };
}
export async function downloadOutput(url: string, id: string, video = false) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:")
    throw new Error("Provider returned an invalid media URL.");
  const { lookup } = await import("node:dns/promises");
  const { isPublicIp } = await import("./scrape.js");
  const addresses = await lookup(parsed.hostname, { all: true });
  if (addresses.some((a) => !isPublicIp(a.address)))
    throw new Error("Invalid media address");
  if(parsed.username || parsed.password || (parsed.port && parsed.port!=='443') || !addresses.length) throw new Error('Invalid media URL');
  const https = await import('node:https');
  const selected=addresses[0];
  const bytes=await new Promise<Buffer>((resolve,reject)=>{
    const request=https.get(parsed,{
      lookup:((_host:unknown,options:{all?:boolean},cb:Function)=>options.all?cb(null,[selected]):cb(null,selected.address,selected.family)) as never,
      timeout:90000,
    },response=>{
      if(response.statusCode!==200){response.resume();reject(new Error('Could not download generated media'));return;}
      const chunks:Buffer[]=[];let length=0;
      response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>100*1024*1024){request.destroy(new Error('Generated file too large'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',reject);
    });
    request.on('timeout',()=>request.destroy(new Error('Download timed out')));request.on('error',reject);
  });
  const dir = path.join(config.dataDir, "media");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}-source.${video ? "mp4" : "jpg"}`);
  await writeFile(file, bytes);
  return file;
}
