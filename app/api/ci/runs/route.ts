import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { hashToken } from '@/lib/server/auth';
import { rebuildCiResult } from '@/lib/server/execute';
import { formDataLimited, safeFileName } from '@/lib/server/files';
import { failure, json } from '@/lib/server/http';
import { getStore, MAX_FILE_BYTES, StoreError } from '@/lib/server/store';
import { createThrottle } from '@/lib/server/throttle';
import { kindOf } from '@/lib/server/upload';
import type { CiInfo } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A pipeline sends its test cases one after another, so there is an hourly cap but no pause between requests.
const perToken = createThrottle({ minGapMs: 0, maxPerHour: 600 });
const perAddress = createThrottle({ minGapMs: 0, maxPerHour: 2000 });
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\x00-\x1F\x7F]/g, '').slice(0, max) : '';

/**
 * Receives a run from the command-line tool or the GitHub Action. Authenticated by a project token (stored hashed);
 * there is no cookie, so no cross-site request can reach it with a person's session.
 */
export async function POST(request: NextRequest) {
  try {
    const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (perAddress(address)) return json({ error: 'Too many requests' }, 429);
    const header = request.headers.get('authorization') ?? '';
    const token = /^Bearer (opl_[A-Za-z0-9_-]{20,80})$/.exec(header)?.[1];
    if (!token) return json({ error: 'A project token is required' }, 401);
    const store = await getStore();
    const owner = await store.tokenProject(hashToken(token));
    if (!owner) return json({ error: 'This token is not valid or has been revoked' }, 401);
    if (perToken(owner.id)) return json({ error: 'Too many runs for this token. Try again shortly.' }, 429);

    const form = await formDataLimited(request, 4_400_000, 'The upload is too large. Leave the file out or use a smaller one.');
    const metaText = form.get('meta');
    if (typeof metaText !== 'string' || metaText.length > 2_000_000) throw new StoreError('invalid', 'The report is missing');
    let meta: Record<string, unknown>;
    try { meta = JSON.parse(metaText) as Record<string, unknown>; } catch { throw new StoreError('invalid', 'The report is not valid JSON'); }
    const file = form.get('file');
    const bytes = file instanceof File && file.size > 0 && file.size <= MAX_FILE_BYTES ? Buffer.from(await file.arrayBuffer()) : null;
    const reported = (meta.result ?? {}) as { file?: { name?: unknown } };
    const fileName = safeFileName(file instanceof File ? file.name : reported.file?.name, 'upload');
    const result = rebuildCiResult(meta.result, fileName);
    let stored = bytes;
    if (bytes) {
      // The file is kept only if it is the file the report describes.
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== result.file.sha256 || kindOf(bytes) !== result.file.kind) stored = null;
    }
    const ciRaw = (meta.ci ?? {}) as Record<string, unknown>;
    const runUrl = clean(ciRaw.runUrl, 300);
    const ci: CiInfo = { provider: clean(ciRaw.provider, 40) || 'CI', commit: /^[0-9a-f]{7,40}$/.test(clean(ciRaw.commit, 40)) ? clean(ciRaw.commit, 40) : '',
      branch: clean(ciRaw.branch, 120), runUrl: /^https:\/\/[^\s"'<>]+$/.test(runUrl) ? runUrl : '' };
    const run = await store.createCiRun(owner, meta.case, { fileName, bytes: stored, fileSize: result.file.size, fileSha256: result.file.sha256, result, source: 'ci', ci });
    return json({ runId: run.id, seq: run.seq, url: `${request.nextUrl.origin}/app/p/${owner.projectId}/runs/${run.id}` });
  } catch (error) { return failure(error); }
}
