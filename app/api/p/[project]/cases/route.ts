import { body, json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = projectRoute(async (request, { user, store, projectId }) => {
  const data = await body(request);
  return json({ caseId: await store.createCase(user.id, projectId, { name: data.name, kind: data.kind }) });
}, { write: true });
