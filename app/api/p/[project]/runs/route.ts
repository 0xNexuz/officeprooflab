import { createHash } from 'node:crypto';
import { executeRun } from '@/lib/server/execute';
import { json } from '@/lib/server/http';
import { isId, projectRoute } from '@/lib/server/route';
import { caseNameFromFile, kindOf, paceRuns, uploadedFile } from '@/lib/server/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = projectRoute(async (_request, { user, store, projectId }) => json({ runs: await store.listRuns(user.id, projectId) }));

/** Runs a dropped file. With no test case chosen, one named after the file is used, and created if it is new. */
export const POST = projectRoute(async (request, { user, store, projectId }) => {
  paceRuns(user.id);
  const file = await uploadedFile(request);
  const chosen = file.form.get('caseId');
  const caseId = isId(chosen) ? chosen : await store.ensureCase(user.id, projectId, caseNameFromFile(file.name), kindOf(file.bytes));
  const testCase = await store.caseForRun(user.id, projectId, caseId);
  const result = await executeRun(file.name, file.bytes, testCase);
  const run = await store.createRun(user.id, projectId, caseId, { fileName: file.name, bytes: file.bytes, fileSize: file.bytes.length,
    fileSha256: createHash('sha256').update(file.bytes).digest('hex'), result, source: 'upload' });
  return json({ runId: run.id, seq: run.seq, caseId, verdict: result.verdict });
}, { write: true });
