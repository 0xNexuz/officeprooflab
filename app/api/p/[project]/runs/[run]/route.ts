import { json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { project: string; run: string };

export const GET = projectRoute<Params>(async (_request, { user, store, projectId }, params) => json(await store.getRun(user.id, projectId, params.run)));
