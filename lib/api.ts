'use client';
// Browser helper for the OfficeProof API: the same-origin header on writes, and readable errors.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-officeproof-request': '1' };
  let body: BodyInit | undefined;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  if (init.form) body = init.form;
  let response: Response;
  try { response = await fetch(path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' }); }
  catch { throw new ApiError('Could not reach the server. Check your connection and try again.', 0); }
  let data: unknown = null;
  try { data = await response.json(); } catch { /* empty or non-JSON body */ }
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === 'string' ? message : response.status === 413 ? 'The file is too large. Files can be up to 4 MB.' : `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';

/** "12 minutes ago", "yesterday", or a date for anything older than a week. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 50) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
