import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Queryable} from './db.js';
import {AppError} from './config.js';

export const pilotInviteOnly=()=>process.env.PILOT_INVITE_ONLY==='true';
const normalize=(code:string)=>code.trim().toUpperCase().replace(/\s+/g,'');
// Codes are high-entropy random values, so a plain SHA-256 is sufficient and lets us look them up.
export const inviteHash=(code:string)=>createHash('sha256').update(normalize(code)).digest('hex');
export function newInviteCode(){const raw=randomBytes(10).toString('hex').toUpperCase();return `INK-${raw.slice(0,5)}-${raw.slice(5,10)}-${raw.slice(10,15)}-${raw.slice(15,20)}`;}

export async function createInvite(db:Queryable,label='',expiresInDays?:number){
  const code=newInviteCode();
  await db.query('INSERT INTO invites(id,code_hash,label,expires_at) VALUES($1,$2,$3,CASE WHEN $4::int IS NULL THEN NULL ELSE now()+make_interval(days=>$4::int) END)',
    [randomUUID(),inviteHash(code),label.slice(0,100),expiresInDays??null]);
  return code;
}

const refusal=()=>new AppError(403,'Inkshot is invite-only during the pilot. Enter the invite code you were sent, or join the waitlist.');
// Atomically claims one single-use code. Returns the invite id so a failed signup can release it.
export async function redeemInvite(db:Queryable,code:string|undefined,email:string){
  if(!code||!code.trim())throw refusal();
  const row=(await db.query<{id:string}>(
    'UPDATE invites SET used_at=now(),used_email=$2 WHERE code_hash=$1 AND used_at IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING id',
    [inviteHash(code),email])).rows[0];
  if(!row)throw refusal();
  return row.id;
}
export async function releaseInvite(db:Queryable,id:string){
  await db.query('UPDATE invites SET used_at=NULL,used_email=NULL WHERE id=$1',[id]);
}
export async function joinWaitlist(db:Queryable,email:string,businessUrl:string){
  await db.query('INSERT INTO waitlist(id,email,business_url) VALUES($1,$2,$3) ON CONFLICT (email) DO NOTHING',[randomUUID(),email,businessUrl]);
}
