import { toHtml, toJUnit, toMarkdown } from '@/lib/engine/report';
import { summarise } from '@/lib/engine/run';
import { projectRoute } from '@/lib/server/route';
import { StoreError } from '@/lib/server/store';
import { runNumber } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { project: string; run: string };

const FORMATS = {
  json: ['application/json; charset=utf-8', 'json'], md: ['text/markdown; charset=utf-8', 'md'],
  html: ['text/html; charset=utf-8', 'html'], junit: ['application/xml; charset=utf-8', 'junit.xml'],
} as const;

/** The verification report as a download. AI-assisted observations are included under their own label. */
export const GET = projectRoute<Params>(async (request, { user, store, projectId }, params) => {
  const format = request.nextUrl.searchParams.get('format') ?? 'html';
  if (!(format in FORMATS)) throw new StoreError('invalid', 'Choose json, md, html or junit');
  const detail = await store.getRun(user.id, projectId, params.run);
  const findings = [...detail.result.findings, ...(detail.ai?.findings ?? [])];
  const result = { ...detail.result, findings, summary: summarise(findings, detail.result.checks) };
  const body = format === 'json' ? JSON.stringify({ run: runNumber(detail.run.seq), testCase: detail.testCase.name, source: detail.run.source, ci: detail.run.ci, createdAt: detail.run.createdAt, result }, null, 2)
    : format === 'md' ? toMarkdown(result) : format === 'junit' ? toJUnit([result]) : toHtml(result);
  const [type, extension] = FORMATS[format as keyof typeof FORMATS];
  const name = `officeproof-${runNumber(detail.run.seq)}.${extension}`;
  return new Response(body, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
});
