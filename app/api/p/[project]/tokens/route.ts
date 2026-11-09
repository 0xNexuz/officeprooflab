import { body, json } from '@/lib/server/http';
import { isId, projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = projectRoute(async (_request, { user, store, projectId }) => json({ tokens: await store.listTokens(user.id, projectId) }));

/** create | revoke. A new token is returned once and never again. */
export const POST = projectRoute(async (request, { user, store, projectId }) => {
  const data = await body(request);
  if (data.action === 'create') return json({ token: await store.createToken(user.id, projectId, data.name) });
  if (data.action === 'revoke') {
    if (!isId(data.tokenId)) throw new StoreError('invalid', 'Choose a token');
    await store.revokeToken(user.id, projectId, data.tokenId);
    return json({ ok: true });
  }
  throw new StoreError('invalid', 'Unknown token action');
}, { write: true });
