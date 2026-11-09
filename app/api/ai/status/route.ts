import type { NextRequest } from 'next/server';
import { antLingConfig } from '@/lib/server/ant-ling';
import { failure, json, requireUser } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whether AI-assisted observations are available. The key itself never leaves the server. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.user) return auth.response;
    let config = null;
    try { config = antLingConfig(); } catch { config = null; }
    return json({ configured: Boolean(config), model: config?.model ?? null });
  } catch (error) { return failure(error); }
}
