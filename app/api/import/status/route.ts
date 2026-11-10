import { json } from '@/lib/server/http';
import { univerImportStatus } from '@/lib/server/univer-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Whether Univer's Office import works on this server. It converts one tiny built-in workbook, once per server
 * instance, and reads no user data, so it needs no sign-in.
 */
export async function GET() {
  return json({ univerImport: await univerImportStatus() });
}
