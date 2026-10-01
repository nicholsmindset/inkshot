import { managedAuthEnabled, authClient, provisionManagedUser } from './managed-auth.js';
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import type { Database } from "./db.js";
import { config, AppError } from "./config.js";
import type { User } from "../shared/types.js";
const scrypt = promisify(scryptCallback);
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const a = (await scrypt(password, salt, 64)) as Buffer;
  const b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
export async function session(db: Database, userId: string, res: Response) {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions VALUES ($1,$2,$3)", [
    tokenHash(token),
    userId,
    new Date(Date.now() + 7 * 86400000),
  ]);
  res.cookie("inkshot_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.production,
    maxAge: 7 * 86400000,
    path: "/",
  });
}
export function requireUser(db: Database) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (managedAuthEnabled()) {
        const {data, error} = await authClient(req,res).auth.getUser();
        if (error || !data.user) throw new AppError(401, 'Please sign in to your studio.');
        req.user = await provisionManagedUser(db,data.user);
        return next();
      }
      const token = req.cookies?.inkshot_session;
      if (!token) throw new AppError(401, "Please sign in to your studio.");
      const { rows } = await db.query<User>(
        `SELECT u.id,u.name,u.email,u.workspace_id AS "workspaceId",u.demo FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
        [tokenHash(token)],
      );
      if (!rows[0])
        throw new AppError(401, "Your session has expired. Please sign in.");
      req.user = rows[0];
      next();
    } catch (e) {
      next(e);
    }
  };
}
export async function createUser(
  db: Database,
  input: { name: string; email: string; password: string; demo?: boolean },
  brand: unknown,
) {
  const userId = randomUUID(),
    workspaceId = randomUUID();
  const hash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO workspaces(id,brand,credits) VALUES($1,$2,$3)",
      [workspaceId, JSON.stringify(brand), config.mode === "mock" ? 300 : 0],
    );
    await tx.query(
      "INSERT INTO users(id,workspace_id,name,email,password_hash,demo) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, workspaceId, input.name, input.email, hash, !!input.demo],
    );
    if (config.mode === "mock")
      await tx.query(
        "INSERT INTO ledger(id,workspace_id,amount,kind,description,event_key) VALUES($1,$2,300,'grant','Preview credits · no payment',$3)",
        [randomUUID(), workspaceId, `welcome:${userId}`],
      );
  });
  return { userId, workspaceId };
}
