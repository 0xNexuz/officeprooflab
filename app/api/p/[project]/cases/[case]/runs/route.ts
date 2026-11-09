import { createHash } from 'node:crypto';
import { executeRun } from '@/lib/server/execute';
import { json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';
import { paceRuns, uploadedFile } from '@/lib/server/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { project: string; case: string };

/** Runs an uploaded file against this test case's rules and reference. */
export const POST = projectRoute<Params>(async (request, { user, store, projectId }, params) => {
  const testCase = await store.caseForRun(user.id, projectId, params.case);
  paceRuns(user.id);
  const file = await uploadedFile(request);
  const result = await executeRun(file.name, file.bytes, testCase);
  const run = await store.createRun(user.id, projectId, params.case, { fileName: file.name, bytes: file.bytes, fileSize: file.bytes.length,
    fileSha256: createHash('sha256').update(file.bytes).digest('hex'), result, source: 'upload' });
  return json({ runId: run.id, seq: run.seq, verdict: result.verdict });
}, { write: true });
