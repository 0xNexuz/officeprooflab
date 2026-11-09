import { NextResponse, type NextRequest } from 'next/server';
import { EngineError } from '../engine/types.ts';
import { StoreError } from './errors.ts';
import { sameOriginWrite, sessionUser } from './auth.ts';
import { readBodyLimited } from './files.ts';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function failure(error: unknown) {
  if (error instanceof StoreError) return json({ error: error.message },
    error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'rate_limited' ? 429 : error.code === 'forbidden' ? 403 : 400);
  // A file the engine cannot read, or a rule it cannot apply, is the caller's to fix.
  if (error instanceof EngineError) return json({ error: error.message }, error.code === 'too_large' ? 413 : 400);
  if (error instanceof SyntaxError) return json({ error: 'Malformed JSON request' }, 400);
  // File contents are never logged; only the error's own message.
  console.error('OfficeProof request failed:', error instanceof Error ? error.message : 'unknown error');
  return json({ error: 'The server could not complete this request' }, 500);
}

export async function body(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new StoreError('invalid', 'JSON request required');
  const raw = (await readBodyLimited(request, 300_000)).toString('utf8');
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoreError('invalid', 'JSON object required');
  return data as Record<string, unknown>;
}

export function writeGuard(request: NextRequest) {
  if (!sameOriginWrite(request)) return json({ error: 'Same-origin request header required' }, 403);
  return null;
}

type SessionUser = { id: string; username: string };
export async function requireUser(request: NextRequest): Promise<{ user: SessionUser; response?: undefined } | { user?: undefined; response: Response }> {
  const user = await sessionUser(request);
  return user ? { user } : { response: json({ error: 'Sign in to continue' }, 401) };
}
