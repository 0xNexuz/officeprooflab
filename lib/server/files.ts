import { StoreError } from './errors.ts';

/**
 * Reads a request body, refusing it as soon as it passes `max` bytes. A declared Content-Length is checked
 * first; a chunked body (no length) is counted while it streams, so an oversized upload is never buffered.
 */
export async function readBodyLimited(request: Request, max: number, message = 'Request is too large'): Promise<Buffer> {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw new StoreError('invalid', message);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new StoreError('invalid', message);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

/** A multipart form read with the same limit. */
export async function formDataLimited(request: Request, max: number, message: string) {
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) throw new StoreError('invalid', 'A file upload is required');
  const bytes = await readBodyLimited(request, max, message);
  try { return await new Response(new Uint8Array(bytes), { headers: { 'content-type': type } }).formData(); }
  catch { throw new StoreError('invalid', 'The upload could not be read'); }
}

/** Uploaded names are shown back to people and written into reports: keep the base name, drop control characters. */
export function safeFileName(name: unknown, fallback: string): string {
  const base = typeof name === 'string' ? name.split(/[\\/]/).pop() ?? '' : '';
  const clean = base.replace(/[\x00-\x1F\x7F<>:"|?*]/g, '').trim().slice(0, 120);
  return clean || fallback;
}
