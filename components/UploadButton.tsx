'use client';
import { useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';

/** A button that picks one Office file and posts it. Errors are shown beside the button. */
export default function UploadButton<T>({ action, className, children, busyText = 'Checking', onDone }: { action: string; className: string; children: React.ReactNode; busyText?: string; onDone: (result: T) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!/\.(xlsx|docx|pptx)$/i.test(file.name)) { setError('Choose a .xlsx, .docx or .pptx file.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Files can be up to 4 MB.'); return; }
    setBusy(true);
    try { const form = new FormData(); form.set('file', file); onDone(await api<T>(action, { form })); }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>{busy ? <>{busyText}<span className="busy-dots" /></> : children}</button>
      <input ref={input} type="file" accept=".xlsx,.docx,.pptx" className="sr" tabIndex={-1} aria-hidden="true" onChange={event => void send(event.target.files?.[0])} />
      {error && <span className="notice notice--error" role="alert" style={{ fontSize: 13.5, padding: '8px 10px' }}>{error}</span>}
    </span>
  );
}
