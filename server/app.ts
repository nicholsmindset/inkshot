import "./render-fonts.js";
import {persistMedia,materializeMedia,signedMediaUrl} from './storage.js';
import { assertApprovedClaims, assertVisualClaims, requireOwnedCertificate } from "./claims.js";
import { managedAuthEnabled, authClient, provisionManagedUser } from './managed-auth.js';
import express from "express";
import { createOpsStatusHandler, reportOpsAlert } from "./ops.js";
import { acceptProviderWebhook } from "./provider-webhooks.js";
import { requestDeletion, rejectFrozenWorkspace, deletionEnabled } from "./account-deletion.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { PostgresRateLimitStore, clientRateLimitKey } from "./rate-limit.js";
import multer from "multer";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { requestCampaignExport, findCampaignExport } from './campaign-exports.js';
import { z } from "zod";
import { config, AppError, videoDurationSeconds } from "./config.js";
import type { Database, Queryable } from "./db.js";
import {
  requireUser,
  createUser,
  verifyPassword,
  session,
  tokenHash,
} from "./auth.js";
import { brandSchema, demoBrand, emptyBrand } from "./brand.js";
import { writeBrief, writeConcepts, writeAssetPrompts } from "./claude.js";
import { rasterizeSiteLogo } from "./site-logo.js";
import { scrape, importedIdentity, fetchSiteLogo } from "./scrape.js";
import { changeCredits } from "./credits.js";
import {billingConfigured,billingMode,checkoutReleased,checkout,portal,webhook} from './billing.js';
import {
  KIT_CREDITS,
  VERSION_CREDITS,
  type Brand,
  type Campaign,
  type CampaignDraft,
  type Asset,
  type Version,
} from "../shared/types.js";
import { isCampaignDestination } from "../shared/destination.js";
import { campaignDraftSchema, selectedConceptIdsSchema, currentDraft, validateDraft, requireDraftRevision } from "./campaign-drafts.js";
const id = z.string().uuid();
const authEmail = z.string().trim().max(254).pipe(z.email()).transform(value => value.toLowerCase());
const onboardingWebsite = z.string().trim().max(2048).transform((value, context) => {
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid website");
    url.protocol = "https:";
    return url.toString();
  } catch {
    context.addIssue({ code: "custom", message: "Enter your business website address." });
    return z.NEVER;
  }
});
const json = (data: unknown) => JSON.stringify(data);
function socialCaption(headline: string, cta: string, brand: Pick<Brand, "description"> & { destinationUrl?: string }) {
  return [headline, brand.description, [cta, brand.destinationUrl].filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
}
async function queueRevision(tx: Queryable, revision: {
  id: string; assetId: string; workspaceId: string; n: number; prompt: string;
  headline: string; cta: string; note: string; cost: number; mock: boolean;
  sourcePath: string | null; videoDuration?: number; firstFrameSource?: string | null; motionPrompt?: string | null; checkpoint?: Record<string, string>;
}) {
  await tx.query(
    "INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,note,credit_cost,mock,source_path,motion_prompt,video_duration_seconds,first_frame_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [revision.id, revision.assetId, revision.workspaceId, revision.n, revision.prompt,
     revision.headline, revision.cta, revision.note, revision.cost, revision.mock, revision.sourcePath, revision.motionPrompt ?? null, revision.videoDuration ?? 15, revision.firstFrameSource ?? null],
  );
  await tx.query(
    "INSERT INTO jobs(id,version_id,workspace_id,checkpoint) VALUES($1,$2,$3,$4)",
    [randomUUID(), revision.id, revision.workspaceId, json(revision.checkpoint ?? {})],
  );
}

async function saveUpload(db: Database, workspaceId: string, buffer: Buffer, isLogo: boolean) {
    const uploadId = randomUUID();
    const dir = path.join(config.dataDir, "uploads");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${uploadId}.${isLogo ? "png" : "jpg"}`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, buffer);
    const storedFile = await persistMedia(file,workspaceId,'brand-uploads');
    await db.query(
      "INSERT INTO uploads(id,workspace_id,file_path) VALUES($1,$2,$3)",
      [uploadId, workspaceId, storedFile],
    );
    return uploadId;
}

export function createApp(db: Database, readSiteLogo = fetchSiteLogo) {
  const app = express();
  let storageSource: string[] = [];
  if (process.env.STORAGE_PROVIDER === 'supabase' && process.env.SUPABASE_URL) {
    try { const url = new URL(process.env.SUPABASE_URL); if(url.protocol==='https:' && !url.username && !url.password) storageSource=[url.origin]; } catch { /* Startup configuration checks handle invalid storage URLs. */ }
  }
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:", ...storageSource],
          mediaSrc: ["'self'", "blob:", ...storageSource],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
    }),
  );
  app.get("/api/ops/status", createOpsStatusHandler(async () => db));
  app.use(cookieParser());
  app.use("/api/auth", (_req, res, next) => {
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    next();
  });
  app.post('/api/webhooks/stripe',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{const signature=req.headers['stripe-signature'];if(typeof signature!=='string')throw new AppError(400,'Missing Stripe signature.');try { await webhook(db,req.body,signature); } catch (error) { reportOpsAlert('inkshot_stripe_webhook_failed'); throw error; } res.json({received:true})});
  app.post('/api/webhooks/higgsfield', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    res.json(await acceptProviderWebhook(db, req.body, req.headers));
  });
  app.use(express.json({ limit: "128kb" }));
  app.use(
    "/api",
    rateLimit({
      store: new PostgresRateLimitStore(db, "api"),
      keyGenerator: clientRateLimitKey,
      passOnStoreError: false,
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
    res.json({ ok: true, mode: config.mode, billingMode: billingMode(), demoAvailable: !managedAuthEnabled() && !config.production && config.mode === 'mock' }),
  );
  const authLimit = rateLimit({
    store: new PostgresRateLimitStore(db, "auth"),
    keyGenerator: clientRateLimitKey,
    passOnStoreError: false,
    windowMs: 15 * 60000,
    limit: 30,
    message: { error: "Too many attempts. Please try again later." },
  });
  const websiteReadLimit = rateLimit({
    store: new PostgresRateLimitStore(db, "website-read"),
    keyGenerator: clientRateLimitKey,
    passOnStoreError: false,
    windowMs: 60_000,
    limit: 8,
    message: { error: 'Too many website reads. Please wait a minute before trying again.' },
  });
  const resendLimit = rateLimit({
    store: new PostgresRateLimitStore(db, "confirmation-resend"),
    keyGenerator: req => authEmail.parse(req.body?.email),
    passOnStoreError: false,
    windowMs: 60_000, limit: 1,
    message: { error: "Please wait a minute before requesting another confirmation email." },
  });
  const verificationLimit = rateLimit({
    store: new PostgresRateLimitStore(db, "email-verification"),
    keyGenerator: req => authEmail.parse(req.body?.email),
    passOnStoreError: false,
    windowMs: 15 * 60_000, limit: 10,
    message: { error: "Too many verification attempts. Please try again later." },
  });
  app.post("/api/auth/demo", authLimit, async (req, res) => {
    if (managedAuthEnabled() || config.production || config.mode !== "mock")
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
        email: authEmail,
        password: z.string().min(12).max(128),
        website: onboardingWebsite.optional(),
      })
      .parse(req.body);
    if (managedAuthEnabled()) {
      const {data,error} = await authClient(req,res).auth.signUp({email:input.email,password:input.password,options:{data:{name:input.name},emailRedirectTo:`${config.origin}/api/auth/callback`}});
      if (error) throw new AppError(400,'Unable to create your account. Check your details or try signing in.');
      if (data.session && data.user) await provisionManagedUser(db,data.user);
      if (!data.session && input.website) {
        res.cookie("inkshot-onboarding-website", input.website, {
          httpOnly: true, secure: config.production, sameSite: "lax", path: "/api/auth/callback", maxAge: 24 * 60 * 60000,
        });
      } else {
        res.clearCookie("inkshot-onboarding-website", { path: "/api/auth/callback" });
      }
      res.status(201).json({ok:true,confirmationRequired:!data.session});
      return;
    }
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
  app.post("/api/auth/resend-confirmation", authLimit, resendLimit, async (req, res) => {
    const { email } = z.object({ email: authEmail }).parse(req.body);
    if (!managedAuthEnabled()) throw new AppError(503, "Confirmation email is unavailable in the local preview.");
    const { error } = await authClient(req, res).auth.resend({
      type: "signup", email, options: { emailRedirectTo: `${config.origin}/api/auth/callback` },
    });
    if (error && (!error.status || error.status === 401 || error.status === 403 || error.status >= 500))
      throw new AppError(503, "Confirmation email is temporarily unavailable. Please try again.");
    // Do not reveal whether this address is registered, confirmed or throttled.
    res.json({ ok: true });
  });
  app.post("/api/auth/verify-email", authLimit, verificationLimit, async (req, res) => {
    const { email, token } = z.object({ email: authEmail, token: z.string().trim().regex(/^\d{6,10}$/) }).parse(req.body);
    if (!managedAuthEnabled()) throw new AppError(503, "Email verification is unavailable in the local preview.");
    // A manually entered email code works without the original browser's PKCE
    // verifier. The existing confirmation-link flow stays browser-bound.
    const { data, error } = await authClient(req, res).auth.verifyOtp({ email, token, type: "email" });
    if (error && (!error.status || error.status >= 500))
      throw new AppError(503, "Email verification is temporarily unavailable. Please try again.");
    if (error || !data.user || !data.session || !data.user.email_confirmed_at)
      throw new AppError(401, "That code is invalid or has expired. Request a new confirmation email.");
    await provisionManagedUser(db, data.user);
    res.json({ ok: true });
  });
  const recoveryCode = "inkshot-reset-code";
  const codeFormat = z.string().min(16).max(512).regex(/^[a-zA-Z0-9_-]+$/);
  const recoveryPath = "/api/auth/reset-password";
  app.post("/api/auth/forgot-password", authLimit, async (req, res) => {
    if (!managedAuthEnabled()) throw new AppError(503, "Password recovery is unavailable in the local preview.");
    const { email } = z.object({ email: authEmail }).parse(req.body);
    const { error } = await authClient(req, res, true).auth.resetPasswordForEmail(email, {
      redirectTo: `${config.origin}/api/auth/recovery-callback`,
    });
    if (error && (!error.status || error.status === 401 || error.status === 403 || error.status >= 500))
      throw new AppError(503, "Recovery email is temporarily unavailable. Please try again.");
    // Identical response for existing and unknown accounts, including per-user throttles.
    res.json({ ok: true });
  });
  app.get("/api/auth/recovery-callback", (req, res) => {
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    const code = codeFormat.safeParse(req.query.code);
    if (!managedAuthEnabled() || !code.success || !Object.keys(req.cookies).some(name =>
      name.startsWith("inkshot-recovery-code-verifier"))) return res.redirect("/forgot-password?expired=1");
    // Exchange on form submission so a link preview cannot consume the reset.
    res.cookie(recoveryCode, code.data, {
      httpOnly: true, secure: config.production, sameSite: "lax", path: recoveryPath, maxAge: 15 * 60000,
    });
    res.redirect("/reset-password");
  });
  app.post(recoveryPath, authLimit, async (req, res) => {
    const { password } = z.object({ password: z.string().min(12).max(128) }).parse(req.body);
    const code = codeFormat.safeParse(req.cookies[recoveryCode]);
    if (!managedAuthEnabled() || !code.success) throw new AppError(401, "Request a new recovery link and open it in this browser.");
    const auth = authClient(req, res, true).auth;
    const { data, error } = await auth.exchangeCodeForSession(code.data);
    res.clearCookie(recoveryCode, { path: recoveryPath });
    if (error || !data.user || !("redirectType" in data) || data.redirectType !== "recovery") throw new AppError(401, "Request a new recovery link and open it in this browser.");
    const result = await auth.updateUser({ password });
    if (result.error) throw new AppError(400, "Password could not be changed. Request a new link and choose a different password.");
    await auth.signOut();
    res.json({ ok: true });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = z
      .object({
        email: authEmail,
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    if (managedAuthEnabled()) {
      const {data,error} = await authClient(req,res).auth.signInWithPassword(input);
      if (error && (!error.status || error.status >= 500))
        throw new AppError(503, 'Sign-in is temporarily unavailable. Please try again.');
      if(error || !data.user) throw new AppError(401,'Unable to sign in. Check your email, password and email confirmation.');
      await provisionManagedUser(db,data.user);
      res.json({ok:true}); return;
    }
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
    if (managedAuthEnabled()) {
      const {error} = await authClient(req,res).auth.signOut();
      if (error) throw new AppError(503,'Sign-out could not finish. Please try again.');
    }
    if (req.cookies.inkshot_session)
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        tokenHash(req.cookies.inkshot_session),
      ]);
    res.clearCookie("inkshot_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get('/api/auth/callback', async(req,res)=> {
    if (!managedAuthEnabled() || typeof req.query.code !== 'string') return res.redirect('/login?confirmation=failed');
    const {data,error}=await authClient(req,res).auth.exchangeCodeForSession(req.query.code);
    if(error || !data.user) return res.redirect('/login?confirmation=failed');
    await provisionManagedUser(db,data.user);
    const website = onboardingWebsite.safeParse(req.cookies["inkshot-onboarding-website"]);
    res.clearCookie("inkshot-onboarding-website", { path: "/api/auth/callback" });
    res.redirect('/studio/brand' + (website.success && website.data ? `?website=${encodeURIComponent(website.data)}` : ""));
  });
  app.use("/api", requireUser(db));
  app.post('/api/account/deletion', async(req,res)=>{
    if(req.headers.origin!==config.origin || req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'Account deletion must start from this studio.');
    if(req.body?.confirmation!=='DELETE MY ACCOUNT')throw new AppError(400,'Type DELETE MY ACCOUNT to confirm.');
    res.status(202).set('Cache-Control','no-store').json(await requestDeletion(db,req.user!));
  });
  app.use('/api',async(req,_res,next)=>{await rejectFrozenWorkspace(db,req.user!.workspaceId);next();});
  app.post('/api/billing/checkout',async(req,res)=>res.json(await checkout(db,req.user!)));
  app.post('/api/billing/portal',async(req,res)=>res.json(await portal(db,req.user!)));
  app.get("/api/studio", async (req, res) => {
    const w = req.user!.workspaceId;
    const [ws, campaigns, assets, versions, ledger] = await Promise.all([
      db.query<{ brand: Brand; credits: number }>(
        "SELECT brand,credits FROM workspaces WHERE id=$1",
        [w],
      ),
      db.query<Campaign>(
        "SELECT id,name,goal,offer,status,concepts,brand,draft,mock,created_at FROM campaigns WHERE workspace_id=$1 ORDER BY created_at DESC",
        [w],
      ),
      db.query<Asset>(
        "SELECT * FROM assets WHERE workspace_id=$1 ORDER BY id",
        [w],
      ),
      db.query<Version>(
        "SELECT id,asset_id,n,status,prompt,motion_prompt,video_duration_seconds,first_frame_source,headline,cta,note,credit_cost,mock,error,created_at FROM versions WHERE workspace_id=$1 ORDER BY n DESC",
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
      assets: assets.rows.map((asset) => {
        const history = versions.rows.filter(v => v.asset_id === asset.id);
        const current = history.find(v => v.id === asset.current_version_id);
        const campaign = campaigns.rows.find(c => c.id === asset.campaign_id);
        const caption = asset.kind === "post" && current && current.n > 1 && campaign && !campaign.draft
          ? socialCaption(current.headline, current.cta, campaign.brand) : asset.caption;
        return { ...asset, caption, versions: history };
      }),
      ledger: ledger.rows,
      mode: config.mode,
      videoDurationSeconds: videoDurationSeconds(),
      providers: {
        higgsfield: !!config.hfKey && !!config.hfSecret,
        claude: !!config.claudeKey || !!config.openrouterKey,
      },
      billingEnabled: billingConfigured()&&!req.user!.demo,
      checkoutReleased: checkoutReleased(),
      accountDeletionEnabled: deletionEnabled(),
      billingMode: billingMode(),
      billingStatus:(await db.query<{status:string}>('SELECT status FROM billing_accounts WHERE workspace_id=$1',[w])).rows[0]?.status||'none',
    });
  });
  app.put("/api/brand", async (req, res) => {
    const brand = brandSchema.parse(req.body);
    await requireOwnedCertificate(db, req.user!.workspaceId, brand);
    for (const uploadId of [brand.photoId, brand.logoId].filter(Boolean)) {
      const upload = await db.query("SELECT id FROM uploads WHERE id=$1 AND workspace_id=$2", [uploadId, req.user!.workspaceId]);
      if (!upload.rows.length) throw new AppError(400, "Choose files uploaded to this workspace.");
    }
    await db.query("UPDATE workspaces SET brand=$2 WHERE id=$1", [
      req.user!.workspaceId,
      json(brand),
    ]);
    res.json(brand);
  });
  app.post("/api/brand/read", websiteReadLimit, async (req, res) => {
    const { url } = z.object({ url: z.url().max(2048) }).parse(req.body);
    const pages = await scrape(url);
    const identity = importedIdentity(pages);
    if (!pages[0].description && pages.reduce((n, p) => n + p.text.length, 0) < 300)
      throw new AppError(
        400,
        "There is very little readable text on this page. Please add your brand details manually.",
      );
    const brief = config.mode === "mock" ? emptyBrand : await writeBrief(db, req.user!.workspaceId, pages);
    res.json({ ...brief, color: emptyBrand.color, ...identity });
  });
  app.post("/api/brand/import-logo", websiteReadLimit, async (req, res) => {
    const { website, logoUrl } = z.object({
      website: z.url().max(2048), logoUrl: z.url().max(2048),
    }).parse(req.body);
    let logo;
    try {
      logo = await readSiteLogo(website, logoUrl);
    } catch {
      throw new AppError(400, "The logo could not be read from your website. Upload a logo file instead.");
    }
    const buffer = await rasterizeSiteLogo(logo.bytes, logo.type);
    const id = await saveUpload(db, req.user!.workspaceId, buffer, true);
    res.status(201).json({ id });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.post("/api/uploads", upload.single("photo"), async (req, res) => {
    if (!req.file) throw new AppError(400, "Choose a JPG, PNG or WebP photo.");
    const isLogo = req.body.purpose === "logo";
    let buffer: Buffer;
    try {
      const raster = sharp(req.file.buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        });
      buffer = await (isLogo ? raster.png() : raster.jpeg({ quality: 90 })).toBuffer();
    } catch {
      throw new AppError(400, "That file is not a supported photo.");
    }
    const uploadId = await saveUpload(db, req.user!.workspaceId, buffer, isLogo);
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
    res.sendFile(await materializeMedia(row.file_path, req.user!.workspaceId, "brand-uploads"));
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
    const concepts = await writeConcepts(db, w, brand, input.goal, input.offer);
    const cid = randomUUID();
    const initialDraft = currentDraft({ id: cid, name: input.name, goal: input.goal,
      offer: input.offer, concepts, brand, status: 'draft', mock: config.mode === 'mock', created_at: '' });
    await db.query(
      "INSERT INTO campaigns(id,workspace_id,name,goal,offer,concepts,brand,mock,draft) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        cid,
        w,
        input.name,
        input.goal,
        input.offer,
        json(concepts),
        json(brand),
        config.mode === "mock",
        json(initialDraft),
      ],
    );
    res.status(201).json({ id: cid, concepts });
  });
  async function ownedCampaign(tx: Queryable, campaignId: string, workspaceId: string, lock = false) {
    const campaign = (await tx.query<Campaign>(
      "SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2" + (lock ? " FOR UPDATE" : ""),
      [campaignId, workspaceId],
    )).rows[0];
    if (!campaign) throw new AppError(404, "Campaign not found.");
    return campaign;
  }
  async function saveDraft(tx: Queryable, campaign: Campaign, workspaceId: string, draft: CampaignDraft) {
    requireDraftRevision(campaign, draft.revision);
    validateDraft(campaign, draft);
    await requireOwnedCertificate(tx, workspaceId, campaign.brand, true);
    if (draft.photoId && !(await tx.query("SELECT id FROM uploads WHERE id=$1 AND workspace_id=$2", [draft.photoId, workspaceId])).rows.length)
      throw new AppError(400, "Choose a photo from this workspace.");
    const saved = { ...draft, videoDurationSeconds: currentDraft(campaign).videoDurationSeconds, revision: draft.revision + 1 };
    if (draft.photoId && draft.photoId === campaign.brand.certifications?.certificateId) throw new AppError(400, "A certificate cannot be used as campaign artwork.");
    await tx.query("UPDATE campaigns SET draft=$2 WHERE id=$1", [campaign.id, json(saved)]);
    return saved;
  }
  app.get("/api/campaigns/:id/draft", async (req, res) => {
    const campaign = await ownedCampaign(db, id.parse(req.params.id), req.user!.workspaceId);
    res.json(currentDraft(campaign));
  });
  app.patch("/api/campaigns/:id/draft", async (req, res) => {
    const input = campaignDraftSchema.parse(req.body);
    const workspaceId = req.user!.workspaceId;
    const campaignId = id.parse(req.params.id);
    const saved = await db.transaction(async tx => saveDraft(tx,
      await ownedCampaign(tx, campaignId, workspaceId, true), workspaceId, input));
    res.json(saved);
  });
  app.post("/api/campaigns/:id/prompts", async (req, res) => {
    const input = z.object({ revision: z.number().int().min(0), selectedConceptIds: selectedConceptIdsSchema }).parse(req.body);
    const workspaceId = req.user!.workspaceId;
    const campaignId = id.parse(req.params.id);
    const campaign = await ownedCampaign(db, campaignId, workspaceId);
    requireDraftRevision(campaign, input.revision);
    const draft = { ...currentDraft(campaign), selectedConceptIds: input.selectedConceptIds, assets: [] };
    validateDraft(campaign, draft);
    const selected = input.selectedConceptIds.map(conceptId => campaign.concepts.find(concept => concept.id === conceptId)!);
    const assets = await writeAssetPrompts(db, workspaceId, campaign.brand, selected, campaign.goal, campaign.offer, draft.videoDurationSeconds);
    const complete = campaignDraftSchema.parse({ ...draft, assets });
    validateDraft(campaign, complete, true);
    const saved = await db.transaction(async tx => saveDraft(tx,
      await ownedCampaign(tx, campaignId, workspaceId, true), workspaceId, complete));
    res.json(saved);
  });
  app.post("/api/campaigns/:id/generate", async (req, res) => {
    const cid = id.parse(req.params.id),
      w = req.user!.workspaceId;
    const input = z.object({
      draftRevision: z.number().int().min(1).optional(),
      destinationUrl: z.string().trim().refine(isCampaignDestination, "Enter a full HTTPS destination URL.").optional(),
      approved: z.literal(true),
      photoId: id.optional(),
      drafts: z.array(z.object({
        conceptId: z.string().min(1),
        kind: z.enum(["video", "image", "post"]),
        headline: z.string().trim().min(1).max(120).optional(),
        cta: z.string().trim().min(1).max(55),
      })).length(9).optional(),
    }).parse(req.body);
    if (config.mode === "live" && (!config.liveAllowed || !config.hfKey || !config.hfSecret || !(Number(process.env.HF_DAILY_BUDGET_USD)>0)))
      throw new AppError(503,"Generation requires provider credentials and a configured spending limit.");
    await db.transaction(async (tx) => {
      const c = (
        await tx.query<Campaign & { brand: Brand }>(
          "SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [cid, w],
        )
      ).rows[0];
      if (!c) throw new AppError(404, "Campaign not found.");
      await requireOwnedCertificate(tx, w, c.brand, true);
      if (c.status !== "draft") return;
      let { drafts, photoId, destinationUrl } = input;
      let conceptsToGenerate = c.concepts.slice(0, 3);
      let approvedDraft: CampaignDraft | undefined;
      if (c.concepts.length !== 3 || c.draft || input.draftRevision !== undefined) {
        if (input.draftRevision === undefined || !c.draft)
          throw new AppError(409, "Save and approve the current draft before generating.");
        requireDraftRevision(c, input.draftRevision);
        approvedDraft = campaignDraftSchema.parse(currentDraft(c));
        validateDraft(c, approvedDraft, true);
        photoId = approvedDraft.photoId;
        destinationUrl = approvedDraft.destinationUrl;
        drafts = approvedDraft.assets;
        conceptsToGenerate = approvedDraft.selectedConceptIds.map(conceptId => c.concepts.find(concept => concept.id === conceptId)!);
      }
      const approvedAssets = new Map(approvedDraft?.assets.map(asset => [`${asset.conceptId}:${asset.kind}`, asset]));
      const overrides = new Map<string, {headline?: string; cta: string}>();
      if (drafts) {
        const concepts = new Set(conceptsToGenerate.map((concept) => concept.id));
        for (const draft of drafts) {
          const key = `${draft.conceptId}:${draft.kind}`;
          if (!concepts.has(draft.conceptId) || overrides.has(key))
            throw new AppError(400, "Review each campaign asset exactly once.");
          overrides.set(key, draft);
        }
        if (concepts.size !== 3)
          throw new AppError(400, "This campaign needs three distinct concepts.");
      }
      if (photoId && photoId === c.brand.certifications?.certificateId) throw new AppError(400, "A certificate cannot be used as campaign artwork.");
      if (photoId) {
        const uploaded = await tx.query(
          "SELECT id FROM uploads WHERE id=$1 AND workspace_id=$2",
          [photoId, w],
        );
        if (!uploaded.rows.length) throw new AppError(400, "Choose a photo from this workspace.");
      }
      if (approvedDraft || photoId || destinationUrl) {
        const approvedBrand = { ...c.brand };
        if (approvedDraft) {
          delete approvedBrand.photoId;
          delete approvedBrand.destinationUrl;
        }
        if (photoId) approvedBrand.photoId = photoId;
        await tx.query("UPDATE campaigns SET brand=$2 WHERE id=$1", [
          cid, json({ ...approvedBrand, ...(destinationUrl && { destinationUrl }) }),
        ]);
      }
      await changeCredits(
        tx,
        w,
        -KIT_CREDITS,
        "generation",
        `${c.name} · nine-asset kit`,
        `kit:${cid}`,
      );
      for (const [index, concept] of conceptsToGenerate.entries()) {
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
          const draft = overrides.get(`${concept.id}:${kind}`);
          const cta = draft?.cta ?? concept.cta;
          const headline = draft?.headline ?? concept.hook;
          const approvedAsset = approvedAssets.get(`${concept.id}:${kind}`);
          const prompt = approvedAsset?.prompt ?? `${concept.description} ${c.brand.description} Editorial product photography, natural light, clean composition. ${c.brand.voice}. No text, no logos. Encode approved headlines in the final layout, not in the generated image.`;
          for (const copy of [headline, cta, approvedAsset?.caption || ""]) assertApprovedClaims(copy, c.brand, c.offer);
          assertVisualClaims(prompt, c.brand, c.offer);
          assertVisualClaims(approvedAsset?.motionPrompt || "", c.brand, c.offer);
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
                ? approvedAsset?.caption ?? socialCaption(headline, cta, { ...c.brand, destinationUrl })
                : "",
              vid,
            ],
          );
          await tx.query(
            "INSERT INTO versions(id,asset_id,workspace_id,n,prompt,headline,cta,credit_cost,mock,motion_prompt,video_duration_seconds) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)",
            [vid, aid, w, prompt, headline, cta, cost, c.mock, approvedAsset?.motionPrompt ?? null, approvedDraft?.videoDurationSeconds ?? 15],
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
      const campaign = await ownedCampaign(tx, a.campaign_id, w);
      await requireOwnedCertificate(tx, w, campaign.brand, true);
      assertApprovedClaims(input.headline, campaign.brand, campaign.offer);
      assertApprovedClaims(input.cta, campaign.brand, campaign.offer);
      if (input.regenerate) assertVisualClaims(input.note, campaign.brand, campaign.offer);
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
      await queueRevision(tx, {
        id: vid, assetId: aid, workspaceId: w, n, prompt: source.prompt +
          (input.regenerate && input.note ? ` Revision: ${input.note}` : ""),
        headline: input.headline, cta: input.cta, note: input.note || "Text and layout updated",
        cost, mock: source.mock, sourcePath: input.regenerate ? null : source.source_path,
        motionPrompt: source.motion_prompt && a.kind === "video" && input.regenerate && input.note
          ? `${source.motion_prompt} Revision: ${input.note}` : source.motion_prompt,
        videoDuration: source.video_duration_seconds,
        firstFrameSource: input.regenerate ? null : source.first_frame_source,
      });
      return vid;
    });
    res.json({ ok: true, versionId });
  });
  app.post("/api/assets/:id/variations", async (req, res) => {
    const assetId = id.parse(req.params.id);
    const workspaceId = req.user!.workspaceId;
    const { versionId, headlines, requestId } = z.object({
      versionId: id, requestId: id,
      headlines: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
    }).parse(req.body);
    if (new Set(headlines.map(h => h.toLowerCase())).size !== headlines.length)
      throw new AppError(400, "Give each variation a distinct headline.");

    const versionIds = await db.transaction(async (tx) => {
      const asset = (await tx.query<{ kind: string; campaign_id: string }>(
        "SELECT kind,campaign_id FROM assets WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [assetId, workspaceId],
      )).rows[0];
      if (!asset) throw new AppError(404, "Asset not found.");
      const campaign = await ownedCampaign(tx, asset.campaign_id, workspaceId);
      await requireOwnedCertificate(tx, workspaceId, campaign.brand, true);
      for (const headline of headlines) assertApprovedClaims(headline, campaign.brand, campaign.offer);
      if (asset.kind !== "image") throw new AppError(400, "Choose an image ad for variations.");

      const previous = (await tx.query<{ id: string; headline: string; source: string }>(
        `SELECT v.id,v.headline,j.checkpoint->>'sourceVersion' AS source
           FROM versions v JOIN jobs j ON j.version_id=v.id
          WHERE v.asset_id=$1 AND j.checkpoint->>'variationRequest'=$2 ORDER BY v.n`,
        [assetId, requestId],
      )).rows;
      if (previous.length) {
        if (previous.length !== headlines.length ||
            previous.some((v, i) => v.source !== versionId || v.headline !== headlines[i]))
          throw new AppError(409, "This request was already used for different variations.");
        return previous.map(v => v.id);
      }
      const source = (await tx.query<Version & { source_path: string | null }>(
        "SELECT * FROM versions WHERE id=$1 AND asset_id=$2",
        [versionId, assetId],
      )).rows[0];
      if (!source) throw new AppError(404, "Version not found.");
      if (source.status !== "ready" || !source.source_path)
        throw new AppError(409, "Choose a finished image with saved source media.");
      const state = (await tx.query<{ next: number; busy: boolean }>(
        `SELECT coalesce(max(n),0)+1 AS next,
                bool_or(status IN ('queued','making','rendering')) AS busy
           FROM versions WHERE asset_id=$1`, [assetId],
      )).rows[0];
      if (state.busy) throw new AppError(409, "Wait for the current versions to finish.");

      const ids: string[] = [];
      for (const [index, headline] of headlines.entries()) {
        const variationId = randomUUID();
        await queueRevision(tx, {
          id: variationId, assetId, workspaceId, n: state.next + index,
          prompt: source.prompt, headline, cta: source.cta, note: "Headline variation",
          cost: 0, mock: source.mock, sourcePath: source.source_path,
          checkpoint: { variationRequest: requestId, sourceVersion: versionId },
        });
        ids.push(variationId);
      }
      return ids;
    });
    res.json({ ok: true, versionIds });
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
    const reference = req.query.preview === "true" ? v.preview_path : v.file_path;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const filename = req.query.download === "true" ? `inkshot-${req.params.id}${path.extname(reference)}` : undefined;
    const url = await signedMediaUrl(reference, req.user!.workspaceId, "generated-media", filename);
    if (url) { res.redirect(302, url); return; }
    const file = await materializeMedia(reference, req.user!.workspaceId, "generated-media");
    if (filename) res.download(file, filename); else res.sendFile(file);
  });
  const exportCategory = z.enum(["all", "video", "image", "post"]).default("all");
  app.post("/api/campaigns/:id/exports", async(req,res)=>{
    const row = await requestCampaignExport(db,id.parse(req.params.id),req.user!.workspaceId,exportCategory.parse(req.body.category));
    res.set("Cache-Control","no-store").status(row.state==='ready'?200:202).json({id:row.id,state:row.state});
  });
  app.get("/api/exports/:id", async(req,res)=>{
    const row = await findCampaignExport(db,id.parse(req.params.id),req.user!.workspaceId);
    res.set("Cache-Control","no-store").json({id:row.id,state:row.state,
      ...(row.state==='ready' && {downloadUrl:`/api/exports/${row.id}/download`})});
  });
  app.get("/api/exports/:id/download", async(req,res)=>{
    const row = await findCampaignExport(db,id.parse(req.params.id),req.user!.workspaceId);
    if(row.state!=='ready'||!row.file_path)throw new AppError(409,"Your download is not ready yet.");
    res.set("Cache-Control","private, no-store").set("Referrer-Policy","no-referrer");
    const filename = `inkshot-${row.category}.zip`;
    const url = await signedMediaUrl(row.file_path,req.user!.workspaceId,'generated-media',filename);
    if(url){res.redirect(302,url);return;}
    res.download(row.file_path,filename);
  });
  // Preserve the old link as a redirect to the owned campaign, where exports
  // are explicitly queued with POST. GET never creates background work.
  app.get("/api/campaigns/:id/download", async(req,res)=>{
    const cid=id.parse(req.params.id);
    if(!(await db.query("SELECT id FROM campaigns WHERE id=$1 AND workspace_id=$2",[cid,req.user!.workspaceId])).rows.length)
      throw new AppError(404,"Campaign not found.");
    res.redirect(303,`/studio/campaign/${cid}`);
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
