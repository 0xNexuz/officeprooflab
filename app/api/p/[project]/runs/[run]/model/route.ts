import { readModel } from '@/lib/engine/run';
import { json } from '@/lib/server/http';
import { projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_VIEW_CELLS = 100_000;

type Params = { project: string; run: string };

/** The run's file, and its reference when there is one, read into the engine's model so the browser can open them in Univer. */
export const GET = projectRoute<Params>(async (_request, { user, store, projectId }, params) => {
  const file = await store.runFile(user.id, projectId, params.run);
  if (!file.bytes) throw new StoreError('not_found', 'The file for this run is no longer stored. Its report is still available.');
  const model = readModel(new Uint8Array(file.bytes));
  // A very large grid would stall the browser; the report itself does not need the grid.
  if (model.kind === 'xlsx' && model.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0) > MAX_VIEW_CELLS) {
    throw new StoreError('invalid', 'This workbook is too large to open on this page (more than 100,000 filled cells). The findings below are complete without it.');
  }
  let reference = null;
  if (file.reference) { try { const parsed = readModel(new Uint8Array(file.reference)); if (parsed.kind === model.kind) reference = parsed; } catch { /* a reference that no longer reads is left out */ } }
  return json({ model, reference });
});
