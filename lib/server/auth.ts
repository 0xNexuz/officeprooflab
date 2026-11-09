import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getStore } from './store.ts';

export const SESSION_COOKIE = 'officeproof_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function validUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
  return { salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = await hashPassword(password, salt);
  const a = Buffer.from(candidate.hash, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function newSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await (await getStore()).createSession(userId, hashToken(token), expiresAt.toISOString());
  return { token, expiresAt };
}

/** Session tokens and CI tokens are stored only as this hash. */
export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function sessionUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? await (await getStore()).sessionUser(hashToken(token)) : null;
}

/**
 * A write must come from this site's own pages: the browser's Origin has to name the host the request was sent to,
 * and carry the header only same-origin script can add. A page on another site can set neither.
 */
export function sameOriginWrite(request: NextRequest) {
  if (request.headers.get('x-officeproof-request') !== '1') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  return host === request.headers.get('host') || host === request.nextUrl.host;
}
