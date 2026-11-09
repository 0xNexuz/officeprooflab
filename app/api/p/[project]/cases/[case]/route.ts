import { body, json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { project: string; case: string };

export const GET = projectRoute<Params>(async (_request, { user, store, projectId }, params) => json(await store.getCase(user.id, projectId, params.case)));

/** update | delete | clearReference */
export const POST = projectRoute<Params>(async (request, { user, store, projectId }, params) => {
  const data = await body(request);
  if (data.action === 'update') { await store.updateCase(user.id, projectId, params.case, { name: data.name, rules: data.rules, disable: data.disable, phrases: data.phrases }); return json({ ok: true }); }
  if (data.action === 'delete') { await store.deleteCase(user.id, projectId, params.case); return json({ ok: true }); }
  if (data.action === 'clearReference') { await store.setReference(user.id, projectId, params.case, null); return json({ ok: true }); }
  throw new StoreError('invalid', 'Unknown test case action');
}, { write: true });
