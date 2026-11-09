import type { NextRequest } from 'next/server';
import { failure, json, requireUser, writeGuard } from './http.ts';
import { getStore, type OfficeProofStore } from './store.ts';

export type Ctx = { user: { id: string; username: string }; store: OfficeProofStore; projectId: string };
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Wraps a project-scoped handler: requires a session, a same-origin header for writes and well-formed ids.
 * Ownership itself is checked by the store on every query.
 */
export function projectRoute<P extends { project: string }>(handler: (request: NextRequest, ctx: Ctx, params: P) => Promise<Response>, options: { write?: boolean } = {}) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    if (options.write) { const denied = writeGuard(request); if (denied) return denied; }
    try {
      const auth = await requireUser(request);
      if (!auth.user) return auth.response;
      const params = await context.params;
      for (const value of Object.values(params)) if (!isId(value)) return json({ error: 'Not found' }, 404);
      return await handler(request, { user: auth.user, store: await getStore(), projectId: params.project }, params);
    } catch (error) { return failure(error); }
  };
}
