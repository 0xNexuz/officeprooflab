import { json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';
import { kindOf, uploadedFile } from '@/lib/server/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { project: string; case: string };

/** Sets the approved reference file. It must be the same kind of file as the test case. */
export const POST = projectRoute<Params>(async (request, { user, store, projectId }, params) => {
  const testCase = await store.getCase(user.id, projectId, params.case);
  const file = await uploadedFile(request);
  const kind = kindOf(file.bytes);
  if (kind !== testCase.kind) throw new StoreError('invalid', `This test case is for ${testCase.kind} files, but the reference is ${kind}`);
  await store.setReference(user.id, projectId, params.case, { name: file.name, bytes: file.bytes });
  return json({ ok: true });
}, { write: true });
