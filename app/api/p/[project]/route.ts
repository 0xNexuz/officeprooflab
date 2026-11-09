import { json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = projectRoute(async (_request, { user, store, projectId }) => json(await store.overview(user.id, projectId)));
