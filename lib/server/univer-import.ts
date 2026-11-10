// Univer's own Office import (Univer Pro, `@univerjs-pro/exchange-node`): the file's bytes in, Univer's data out, so
// the viewer can show a workbook, document or deck with the design it has in the file. It runs inside this server; no
// file leaves it. The checks never use this reading. They keep the engine's own, so a verdict is the same on the
// command line and in CI, where this package is not installed.
import { strToU8, zipSync } from 'fflate';
import type { FileKind } from '../engine/types.ts';

export type UniverImport = { data: unknown; ms: number };

/** Univer's data is sent to the browser beside the engine's model; a hosted response has a size limit. */
export const MAX_DATA_CHARS = 2_500_000;
const TIMEOUT_MS = 20_000;

type Exchange = typeof import('@univerjs-pro/exchange-node');
let loading: Promise<Exchange | null> | null = null;
let loadError = '';

/**
 * The converter has a native part that exists for common platforms only. Where it cannot load, the viewer does
 * without. `OFFICEPROOF_UNIVER_IMPORT=off` turns it off on purpose.
 */
function load(): Promise<Exchange | null> {
  if (process.env.OFFICEPROOF_UNIVER_IMPORT === 'off') { loadError = 'off'; return Promise.resolve(null); }
  loading ??= import('@univerjs-pro/exchange-node').catch(error => {
    loadError = error instanceof Error ? error.message : String(error);
    // Said once in the server log, so whoever runs the server can see why the viewer is doing without the import.
    console.warn(`Univer's Office import is not available on this server: ${loadError}`);
    return null;
  });
  return loading;
}

const UNIT = { xlsx: 2, docx: 1, pptx: 3 } as const; // UniverInstanceType: UNIVER_DOC = 1, UNIVER_SHEET = 2, UNIVER_SLIDE = 3

/** Reads an Office file with Univer's import. Returns null when it is unavailable, fails, or gives more than the viewer should be sent. */
export async function importWithUniver(bytes: Uint8Array, kind: FileKind, maxChars = MAX_DATA_CHARS): Promise<UniverImport | null> {
  const exchange = await load();
  if (!exchange) return null;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const format = kind === 'xlsx' ? exchange.ExchangeFormat.XLSX : kind === 'docx' ? exchange.ExchangeFormat.DOCX : exchange.ExchangeFormat.PPTX;
    const work = exchange.importBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { type: UNIT[kind], format, fileName: `file.${kind}` } as never) as Promise<unknown>;
    const data = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Univer import took too long')), TIMEOUT_MS); })]);
    if (!data || typeof data !== 'object') return null;
    if (JSON.stringify(data).length > Math.min(maxChars, MAX_DATA_CHARS)) return null;
    return { data, ms: Math.round(performance.now() - started) };
  } catch { return null; } finally { clearTimeout(timer); }
}

const PROBE_SHEET = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1+1</f><v>2</v></c></row></sheetData></worksheet>';
/** The smallest workbook that exercises the converter: one sheet, one number, one formula with its stored result. */
function probeWorkbook(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Probe" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(PROBE_SHEET),
  });
}

export type UniverImportStatus = { available: boolean; ms: number | null; reason: string | null };
let probing: Promise<UniverImportStatus> | null = null;

/** Whether the converter works on this server, found by converting a tiny built-in workbook once. */
export function univerImportStatus(): Promise<UniverImportStatus> {
  probing ??= (async () => {
    const result = await importWithUniver(probeWorkbook(), 'xlsx');
    const sheets = (result?.data as { sheets?: Record<string, { name?: string; cellData?: Record<string, Record<string, { f?: string; v?: unknown }>> }> } | undefined)?.sheets;
    const cell = sheets ? Object.values(sheets)[0]?.cellData?.[0]?.[1] : undefined;
    const read = Boolean(cell?.f) && String(cell?.v) === '2';
    return read ? { available: true, ms: result!.ms, reason: null } : { available: false, ms: null, reason: loadError === 'off' ? 'Turned off by OFFICEPROOF_UNIVER_IMPORT.' : loadError ? 'The converter could not be loaded on this server.' : 'The converter did not read the test workbook.' };
  })();
  return probing;
}
