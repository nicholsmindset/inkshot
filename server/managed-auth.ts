import {recordEvent} from './events.js';
import {pilotInviteOnly} from './pilot-access.js';
import { createServerClient } from '@supabase/ssr';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { User } from '../shared/types.js';
import { config, AppError } from './config.js';
import { rejectDeletedIdentity } from './account-deletion.js';
import { emptyBrand } from './brand.js';
export const managedAuthEnabled = () => process.env.AUTH_PROVIDER === 'supabase';
export const recoveryStorageKey = "inkshot-recovery";
export function authClient(req: Request, res: Response, recovery = false) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AppError(503, 'Sign-in is not configured yet.');
  return createServerClient(url, key, {
    cookieOptions: { ...(recovery && { name: recoveryStorageKey }), httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cookies) => { for (const {name, value, options} of cookies) {
        // Recovery can update a password only inside this request. Never leave
        // a recovery access/refresh token in the browser or overwrite its login.
        if (recovery && !name.startsWith(recoveryStorageKey + "-code-verifier")) continue;
        req.cookies[name] = value;
        res.cookie(name, value, { ...options, maxAge: options.maxAge === undefined ? undefined : (recovery ? Math.min(options.maxAge, 3600) : options.maxAge) * 1000 });
      } },
    },
  });
}
// Only a server-verified Supabase user can reach this function. Metadata is display-only.
export async function provisionManagedUser(db: Database, identity: SupabaseUser): Promise<User> {
  if (!identity.email || !identity.email_confirmed_at) throw new AppError(401, 'Confirm your email before signing in.');
  const email = identity.email;
  let created = false;
  const user = await db.transaction(async tx => {
    // Serializes first-login requests without trusting a client-provided workspace ID.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.id]);
    const existing = (await tx.query<User>('SELECT id,name,email,workspace_id AS "workspaceId",demo FROM users WHERE id=$1', [identity.id])).rows[0];
    if (existing) return existing;
    await rejectDeletedIdentity(tx, identity.id);
    // Invite-only pilot: a new workspace needs an invite redeemed with this email, even if the
    // Supabase sign-up endpoint was called directly instead of Inkshot's own signup route.
    if (pilotInviteOnly() && !(await tx.query('SELECT 1 FROM invites WHERE lower(used_email)=lower($1) AND used_at IS NOT NULL', [email])).rows.length)
      throw new AppError(403, 'Inkshot is invite-only during the pilot. Use the invite code you were sent.');
    const workspaceId = randomUUID();
    const name = String(identity.user_metadata?.name || email.split('@')[0]).slice(0,100);
    await tx.query('INSERT INTO workspaces(id,brand,credits) VALUES($1,$2,0)', [workspaceId, JSON.stringify(emptyBrand)]);
    await tx.query('INSERT INTO users(id,workspace_id,name,email,password_hash,demo) VALUES($1,$2,$3,$4,$5,false)', [identity.id,workspaceId,name,email.toLowerCase(),'SUPABASE_MANAGED']);
    created = true;
    return {id:identity.id,workspaceId,name,email,demo:false};
  });
  if (created) {
    await recordEvent(db, {workspaceId: user.workspaceId, userId: user.id, event: 'signup_completed', dedupeKey: 'signup_completed'});
    await recordEvent(db, {workspaceId: user.workspaceId, userId: user.id, event: 'email_verified', dedupeKey: 'email_verified'});
  }
  return user;
}
