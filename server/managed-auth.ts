import { createServerClient } from '@supabase/ssr';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import { config, AppError } from './config.js';
import { emptyBrand } from './brand.js';
export const managedAuthEnabled = () => process.env.AUTH_PROVIDER === 'supabase';
export function authClient(req: Request, res: Response) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AppError(503, 'Sign-in is not configured yet.');
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cookies) => { for (const {name, value, options} of cookies) {
        req.cookies[name] = value;
        res.cookie(name, value, { ...options, maxAge: options.maxAge === undefined ? undefined : options.maxAge * 1000 });
      } },
    },
  });
}
// Only a server-verified Supabase user can reach this function. Metadata is display-only.
export async function provisionManagedUser(db: Database, identity: SupabaseUser): Promise<User> {
  if (!identity.email || !identity.email_confirmed_at) throw new AppError(401, 'Confirm your email before signing in.');
  const email = identity.email;
  return db.transaction(async tx => {
    // Serializes first-login requests without trusting a client-provided workspace ID.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.id]);
    const existing = (await tx.query<User>('SELECT id,name,email,workspace_id AS "workspaceId",demo FROM users WHERE id=$1', [identity.id])).rows[0];
    if (existing) return existing;
    const workspaceId = randomUUID();
    const name = String(identity.user_metadata?.name || email.split('@')[0]).slice(0,100);
    await tx.query('INSERT INTO workspaces(id,brand,credits) VALUES($1,$2,0)', [workspaceId, JSON.stringify(emptyBrand)]);
    await tx.query('INSERT INTO users(id,workspace_id,name,email,password_hash,demo) VALUES($1,$2,$3,$4,$5,false)', [identity.id,workspaceId,name,email.toLowerCase(),'SUPABASE_MANAGED']);
    return {id:identity.id,workspaceId,name,email,demo:false};
  });
}
