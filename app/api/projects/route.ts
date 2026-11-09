import type { NextRequest } from 'next/server';
import { body, failure, json, requireUser, writeGuard } from '@/lib/server/http';
import { isId } from '@/lib/server/route';
import { getStore, StoreError } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.user) return auth.response;
    return json({ projects: await (await getStore()).listProjects(auth.user.id) });
  } catch (error) { return failure(error); }
}

/** create | rename */
export async function POST(request: NextRequest) {
  const denied = writeGuard(request);
  if (denied) return denied;
  try {
    const auth = await requireUser(request);
    if (!auth.user) return auth.response;
    const store = await getStore();
    const data = await body(request);
    if (data.action === 'create') return json({ projectId: await store.createProject(auth.user.id, data.name) });
    if (data.action === 'rename') {
      if (!isId(data.projectId)) throw new StoreError('invalid', 'Choose a project');
      await store.renameProject(auth.user.id, data.projectId, data.name);
      return json({ ok: true });
    }
    throw new StoreError('invalid', 'Unknown project action');
  } catch (error) { return failure(error); }
}
