import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import archiver from "archiver";
import { z } from "zod";
import { config, AppError } from "./config";
import type { Database } from "./db";
import {
  requireUser,
  createUser,
  verifyPassword,
  session,
  tokenHash,
} from "./auth";
import { brandSchema, demoBrand, emptyBrand } from "./brand";
import { writeBrief, writeConcepts } from "./claude";
import { scrape } from "./scrape";
import { changeCredits } from "./credits";
import {billingConfigured,checkout,portal,webhook} from './billing';
import {
  KIT_CREDITS,
  VERSION_CREDITS,
  type Brand,
  type Campaign,
  type Asset,
  type Version,
} from "../shared/types";
const id = z.string().uuid();
const json = (data: unknown) => JSON.stringify(data);
export function createApp(db: Database) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());
  app.post('/api/webhooks/stripe',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{const signature=req.headers['stripe-signature'];if(typeof signature!=='string')throw new AppError(400,'Missing Stripe signature.');await webhook(db,req.body,signature);res.json({received:true})});
  app.use(express.json({ limit: "128kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = [
        config.origin,
        ...(!config.production
          ? ["http://127.0.0.1:5173", "http://localhost:5173"]
          : []),
      ];
      if (origin && !allowed.includes(origin))
        return next(
          new AppError(403, "This request came from another website."),
        );
      if (req.headers["sec-fetch-site"] === "cross-site")
        return next(new AppError(403, "Cross-site request refused."));
    }
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, mode: config.mode }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    message: { error: "Too many attempts. Please try again later." },
  });
  app.post("/api/auth/demo", authLimit, async (req, res) => {
    if (config.production || config.mode !== "mock")
      throw new AppError(404, "Preview is unavailable.");
    const { userId } = await createUser(
      db,
      {
        name: "Alex",
        email: `preview-${randomUUID()}@inkshot.local`,
        password: randomBytes(24).toString("hex"),
        demo: true,
      },
      demoBrand,
    );
    await session(db, userId, res);
    res.json({ ok: true });
  });
  app.post("/api/auth/signup", authLimit, async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    if (
      (await db.query("SELECT id FROM users WHERE email=$1", [input.email]))
        .rows.length
    )
      throw new AppError(
        409,
        "An account with this email already exists. Please sign in.",
      );
    const { userId } = await createUser(db, input, emptyBrand);
    await session(db, userId, res);
    res.status(201).json({ ok: true });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const user = (
      await db.query<{ id: string; password_hash: string }>(
        "SELECT id,password_hash FROM users WHERE email=$1",
        [input.email],
      )
    ).rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash)))
      throw new AppError(401, "That email and password do not match.");
    await session(db, user.id, res);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.cookies.inkshot_session)
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        tokenHash(req.cookies.inkshot_session),
      ]);
    res.clearCookie("inkshot_session", { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", requireUser(db));
  app.post('/api/billing/checkout',async(req,res)=>res.json(await checkout(db,req.user!)));
  app.post('/api/billing/portal',async(req,res)=>res.json(await portal(db,req.user!)));
  app.get("/api/studio", async (req, res) => {
    const w = req.user!.workspaceId;
    const [ws, campaigns, assets, versions, ledger] = await Promise.all([
      db.query<{ brand: Brand; credits: number }>(
        "SELECT brand,credits FROM workspaces WHERE id=$1",
        [w],
      ),
      db.query(
        "SELECT id,name,goal,offer,status,concepts,mock,created_at FROM campaigns WHERE workspace_id=$1 ORDER BY created_at DESC",
        [w],
      ),
      db.query<Asset>(
        "SELECT * FROM assets WHERE workspace_id=$1 ORDER BY id",
        [w],
      ),
      db.query<Version>(
        "SELECT id,asset_id,n,status,prompt,headline,cta,note,credit_cost,mock,error,created_at FROM versions WHERE workspace_id=$1 ORDER BY n DESC",
        [w],
      ),
      db.query(
        "SELECT id,amount,kind,description,created_at FROM ledger WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
        [w],
      ),
    ]);
    res.json({
      user: req.user,
      brand: ws.rows[0].brand,
      balance: ws.rows[0].credits,
      campaigns: campaigns.rows,
      assets: assets.rows.map((a) => ({
        ...a,
        versions: versions.rows.filter((v) => v.asset_id === a.id),
      })),
      ledger: ledger.rows,
      mode: config.mode,
      providers: {
        higgsfield: !!config.hfKey && !!config.hfSecret,
        claude: !!config.claudeKey,
      },
      billingEnabled: billingConfigured()&&!req.user!.demo,
      billingStatus:(await db.query<{status:string}>('SELECT status FROM billing_accounts WHERE workspace_id=$1',[w])).rows[0]?.status||'none',
    });
  });
  app.put("/api/brand", async (req, res) => {
    const brand = brandSchema.parse(req.body);
    if (
      brand.photoId &&
      !(
        await db.query(
          "SELECT id FROM uploads WHERE id=$1 AND workspace_id=$2",
          [brand.photoId, req.user!.workspaceId],
        )
      ).rows.length
    )
      throw new AppError(400, "Please upload that photo again.");
    await db.query("UPDATE workspaces SET brand=$2 WHERE id=$1", [
      req.user!.workspaceId,
      json(brand),
    ]);
    res.json(brand);
  });
  app.post("/api/brand/read", async (req, res) => {
    const { url } = z.object({ url: z.url().max(2048) }).parse(req.body);
    const pages = await scrape(url);
    if (pages.reduce((n, p) => n + p.text.length, 0) < 300)
      throw new AppError(
        400,
        "There is very little readable text on this page. Please add your brand details manually.",
      );
    if (config.mode === "mock")
      return res.json({
        ...emptyBrand,
        name:
          pages[0].title.split(/[|–—]/)[0].trim().slice(0, 100) ||
          "My business",
        website: url,
        description: pages[0].text.slice(0, 1000),
        sources: pages.map((p) => ({ url: p.url, text: p.text.slice(0, 400) })),
      });
    res.json(await writeBrief(pages));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.post("/api/uploads", upload.single("photo"), async (req, res) => {
    if (!req.file) throw new AppError(400, "Choose a JPG, PNG or WebP photo.");
    let buffer: Buffer;
    try {
      buffer = await sharp(req.file.buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new AppError(400, "That file is not a supported photo.");
    }
    const uploadId = randomUUID();
    const dir = path.join(config.dataDir, "uploads");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${uploadId}.jpg`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, buffer);
    await db.query(
      "INSERT INTO uploads(id,workspace_id,file_path) VALUES($1,$2,$3)",
      [uploadId, req.user!.workspaceId, file],
    );
    res.status(201).json({ id: uploadId });
  });
  app.get("/api/uploads/:id", async (req, res) => {
    const row = (
      await db.query<{ file_path: string }>(
        "SELECT file_path FROM uploads WHERE id=$1 AND workspace_id=$2",
        [id.parse(req.params.id), req.user!.workspaceId],
      )
    ).rows[0];
    if (!row) throw new AppError(404, "Photo not found.");
    res.sendFile(row.file_path);
  });
  app.post("/api/campaigns", async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        goal: z.enum(["Sales", "Bookings", "Enquiries", "Awareness"]),
        offer: z.string().max(500),
      })
      .parse(req.body);
    const w = req.user!.workspaceId;
    const brand = (
      await db.query<{ brand: Brand }>(
        "SELECT brand FROM workspaces WHERE id=$1",
        [w],
      )
    ).rows[0].brand;
    if (!brand.description?.trim())
      throw new AppError(
        400,
        "Add a short description of your business first.",
      );
    const concepts = await writeConcepts(brand, input.goal, input.offer);
    const cid = randomUUID();
    await db.query(
      "INSERT INTO campaigns(id,workspace_id,name,goal,offer,concepts,brand,mock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        cid,
        w,
        input.name,
        input.goal,
        input.offer,
        json(concepts),
        json(brand),
        config.mode === "mock",
      ],
    );
    res.status(201).json({ id: cid, concepts });
  });
  app.post("/api/campaigns/:id/generate", async (req, res) => {
    const cid = id.parse(req.params.id),
      w = req.user!.workspaceId;
    const { approved } = z
      .object({ approved: z.literal(true) })
      .parse(req.body);
    void approved;
    if (config.mode === "live")
      throw new AppError(
        503,
        "Live campaigns are not enabled yet. Model validation and provider cost limits must be configured before paid generation.",
      );
    await db.transaction(async (tx) => {
      const c = (
        await tx.query<Campaign & { brand: Brand }>(
          "SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [cid, w],
        )
      ).rows[0];
      if (!c) throw new AppError(404, "Campaign not found.");
      if (c.status !== "draft") return;
      await changeCredits(
        tx,
        w,
        -KIT_CREDITS,
        "generation",
        `${c.name} · nine-asset kit`,
        `kit:${cid}`,
      );
      for (const [index, concept] of c.concepts.entries()) {
        for (const kind of ["video", "image", "post"] as const) {
          const aid = randomUUID(),
            vid = randomUUID();
          const format =
            kind === "video"
              ? "9:16"
              : kind === "image"
                ? "4:5"
                : ["1:1", "4:5", "1.91:1"][index];
          const cost =
            VERSION_CREDITS[kind] + (kind === "post" && index === 2 ? 1 : 0);
          const prompt = `${concept.description} ${c.brand.description} Editorial product photography, natural light, clean composition. ${c.brand.voice}. No text, no logos. Encode approved headlines in the final layout, not in the generated image.`;
          await tx.query(
            "INSERT INTO assets(id,workspace_id,campaign_id,kind,title,format,caption,current_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              aid,
              w,
              cid,
              kind,
              concept.title,
              format,
              kind === "post"
                ? `${concept.hook}\n\n${c.brand.description}\n\n${concept.cta}.`
                : "",
              vid,
            ],
          );
          await tx.query(
            "INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,credit_cost,mock) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)",
            [vid, aid, w, prompt, concept.hook, concept.cta, cost, c.mock],
          );
          await tx.query(
            "INSERT INTO jobs(id,version_id,workspace_id) VALUES($1,$2,$3)",
            [randomUUID(), vid, w],
          );
        }
      }
      await tx.query("UPDATE campaigns SET status='generating' WHERE id=$1", [
        cid,
      ]);
    });
    res.json({ ok: true });
  });
  app.post("/api/assets/:id/revise", async (req, res) => {
    const aid = id.parse(req.params.id),
      w = req.user!.workspaceId;
    const input = z
      .object({
        versionId: z.string().uuid(),
        headline: z.string().trim().min(1).max(120),
        cta: z.string().trim().min(1).max(55),
        note: z.string().max(500),
        regenerate: z.boolean().default(false),
      })
      .parse(req.body);
    const versionId = await db.transaction(async (tx) => {
      const a = (
        await tx.query<Asset>(
          "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [aid, w],
        )
      ).rows[0];
      if (!a) throw new AppError(404, "Asset not found.");
      if (
        (
          await tx.query(
            "SELECT id FROM versions WHERE asset_id=$1 AND status IN ('queued','making','rendering')",
            [aid],
          )
        ).rows.length
      )
        throw new AppError(409, "Wait for the current version to finish.");
      const source = (
        await tx.query<Version & { source_path: string }>(
          "SELECT * FROM versions WHERE id=$1 AND asset_id=$2",
          [input.versionId, aid],
        )
      ).rows[0];
      if (!source) throw new AppError(404, "Version not found.");
      if (!input.regenerate && !source.source_path)
        throw new AppError(
          400,
          "No source media is available. Choose regenerate.",
        );
      const cost = input.regenerate ? VERSION_CREDITS[a.kind] : 0;
      const vid = randomUUID();
      const n = (
        await tx.query<{ n: number }>(
          "SELECT coalesce(max(n),0)+1 AS n FROM versions WHERE asset_id=$1",
          [aid],
        )
      ).rows[0].n;
      await changeCredits(
        tx,
        w,
        -cost,
        input.regenerate ? "revision" : "edit",
        `${a.title} · ${input.regenerate ? "regeneration" : "text edit"}`,
        `version:${vid}`,
      );
      await tx.query(
        "INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,note,credit_cost,mock,source_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          vid,
          aid,
          w,
          n,
          source.prompt +
            (input.regenerate && input.note ? ` Revision: ${input.note}` : ""),
          input.headline,
          input.cta,
          input.note || "Text and layout updated",
          cost,
          source.mock,
          input.regenerate ? null : source.source_path,
        ],
      );
      await tx.query(
        "INSERT INTO jobs(id,version_id,workspace_id) VALUES($1,$2,$3)",
        [randomUUID(), vid, w],
      );
      return vid;
    });
    res.json({ ok: true, versionId });
  });
  app.put("/api/assets/:id/current", async (req, res) => {
    const aid = id.parse(req.params.id),
      vid = id.parse(req.body.versionId),
      w = req.user!.workspaceId;
    const row = (
      await db.query(
        "SELECT id FROM versions WHERE id=$1 AND asset_id=$2 AND workspace_id=$3 AND status='ready'",
        [vid, aid, w],
      )
    ).rows[0];
    if (!row) throw new AppError(404, "That version is not ready.");
    await db.query(
      "UPDATE assets SET current_version_id=$2 WHERE id=$1 AND workspace_id=$3",
      [aid, vid, w],
    );
    res.json({ ok: true });
  });
  app.get("/api/media/:id", async (req, res) => {
    const v = (
      await db.query<{ file_path: string; preview_path: string }>(
        "SELECT file_path,preview_path FROM versions WHERE id=$1 AND workspace_id=$2 AND status='ready'",
        [id.parse(req.params.id), req.user!.workspaceId],
      )
    ).rows[0];
    if (!v) throw new AppError(404, "This export is not ready.");
    const file = req.query.preview === "true" ? v.preview_path : v.file_path;
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (req.query.download === "true")
      res.download(file, `inkshot-${req.params.id}${path.extname(file)}`);
    else res.sendFile(file);
  });
  app.get("/api/campaigns/:id/download", async (req, res) => {
    const cid = id.parse(req.params.id),
      w = req.user!.workspaceId;
    const c = (
      await db.query(
        "SELECT id FROM campaigns WHERE id=$1 AND workspace_id=$2",
        [cid, w],
      )
    ).rows[0];
    if (!c) throw new AppError(404, "Campaign not found.");
    const rows = (
      await db.query<{
        id: string;
        kind: string;
        title: string;
        caption: string;
        file_path: string;
        mock: boolean;
      }>(
        "SELECT a.id,a.kind,a.title,a.caption,v.file_path,v.mock FROM assets a JOIN versions v ON v.id=a.current_version_id WHERE a.campaign_id=$1 AND a.workspace_id=$2 AND v.status='ready'",
        [cid, w],
      )
    ).rows;
    if (!rows.length)
      throw new AppError(400, "Your first asset is still being made.");
    res.attachment("inkshot-kit.zip");
    const zip = archiver("zip", { zlib: { level: 5 } });
    zip.on("error", () => res.destroy());
    zip.pipe(res);
    rows.forEach((a, i) =>
      zip.file(a.file_path, {
        name: `${i + 1}-${a.kind}${path.extname(a.file_path)}`,
      }),
    );
    zip.append(
      rows
        .filter((a) => a.kind === "post")
        .map((a) => `${a.title}\n${a.caption}`)
        .join("\n\n---\n\n"),
      { name: "captions.txt" },
    );
    if (rows.some((a) => a.mock))
      zip.append(
        "Sample creatives for product preview. These use a sample photo or your uploaded image. Sample videos are 5-second still-image previews, not Higgsfield generations.",
        { name: "SAMPLE-README.txt" },
      );
    await zip.finalize();
  });
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({
            error: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          });
      if (error instanceof AppError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof multer.MulterError)
        return res
          .status(400)
          .json({ error: "Choose one photo smaller than 10 MB." });
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
      res
        .status(500)
        .json({
          error: "Something did not finish. Your saved work is still here.",
        });
    },
  );
  return app;
}
