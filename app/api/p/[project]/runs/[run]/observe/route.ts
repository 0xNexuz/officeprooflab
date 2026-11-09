import { readModel } from '@/lib/engine/run';
import { AntLingError, antLingConfig } from '@/lib/server/ant-ling';
import { json } from '@/lib/server/http';
import { observe } from '@/lib/server/observe';
import { projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';
import { createThrottle } from '@/lib/server/throttle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { project: string; run: string };

// Ant Ling's allowance is shared by everyone on the deployment.
const perUser = createThrottle({ minGapMs: 4000, maxPerHour: 30 });
const overall = createThrottle({ minGapMs: 500, maxPerHour: 300 });

/** Asks Ling 3.2 Flash for observations on the run's text. Results carry the AI-assisted label and never touch the verdict. */
export const POST = projectRoute<Params>(async (_request, { user, store, projectId }, params) => {
  const config = antLingConfig();
  if (!config) throw new StoreError('invalid', 'AI-assisted observations are not set up on this deployment');
  const file = await store.runFile(user.id, projectId, params.run);
  if (!file.bytes) throw new StoreError('not_found', 'The file for this run is no longer stored');
  if (perUser(user.id) || overall('all')) throw new StoreError('rate_limited', 'Too many AI requests. Wait a moment and try again.');
  try {
    const result = await observe(config, readModel(new Uint8Array(file.bytes)));
    const ai = { model: result.model, ranAt: new Date().toISOString(), ranBy: user.username, findings: result.findings, dropped: result.dropped, tokens: result.tokens };
    await store.saveObservations(user.id, projectId, params.run, ai);
    return json({ ai });
  } catch (error) {
    if (error instanceof AntLingError) return json({ error: error.message }, error.code === 'rate_limited' ? 429 : 502);
    throw error;
  }
}, { write: true });
