// One place for "a file arrived": size limit, name, a pace limit, then the engine.
import type { NextRequest } from 'next/server';
import { detectKind, openPackage } from '../engine/zip.ts';
import { EngineError, type FileKind } from '../engine/types.ts';
import { StoreError } from './errors.ts';
import { formDataLimited, safeFileName } from './files.ts';
import { MAX_FILE_BYTES } from './store.ts';
import { createThrottle } from './throttle.ts';

const runThrottle = createThrottle({ minGapMs: 700, maxPerHour: 240 });

/** Leaves room for the multipart wrapper around a 4 MB file. */
const MAX_UPLOAD_REQUEST = MAX_FILE_BYTES + 200_000;

export async function uploadedFile(request: NextRequest, field = 'file'): Promise<{ name: string; bytes: Buffer; form: FormData }> {
  const form = await formDataLimited(request, MAX_UPLOAD_REQUEST, 'Files can be up to 4 MB');
  const file = form.get(field);
  if (!(file instanceof File)) throw new StoreError('invalid', 'Choose a file to upload');
  if (file.size === 0) throw new StoreError('invalid', 'The file is empty');
  if (file.size > MAX_FILE_BYTES) throw new StoreError('invalid', 'Files can be up to 4 MB');
  return { name: safeFileName(file.name, 'upload'), bytes: Buffer.from(await file.arrayBuffer()), form };
}

/** The kind of an Office file, from its content. The file is unpacked within the size limits but not read further. */
export function kindOf(bytes: Buffer): FileKind {
  try { return detectKind(openPackage(new Uint8Array(bytes))); }
  catch (error) { throw new StoreError('invalid', error instanceof EngineError ? error.message : 'The file could not be read'); }
}

export function paceRuns(userId: string) {
  if (runThrottle(userId)) throw new StoreError('rate_limited', 'Too many runs in a short time. Wait a moment and try again.');
}

/** A test case name taken from a file name: "revenue-summary.xlsx" becomes "revenue-summary". */
export const caseNameFromFile = (fileName: string) => fileName.replace(/\.(xlsx|docx|pptx)$/i, '').slice(0, 120) || 'Untitled';
