'use client';
// Where a file is dropped or chosen to be checked. The odd one out looks up while a file is over it.
import { useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Icon } from './Bits';

type Props = {
  /** Where the file is posted. */
  action: string;
  title: string;
  hint: string;
  /** Test cases to choose from; leave out to post without a choice. */
  cases?: { id: string; name: string }[];
  onDone: (result: { runId: string }) => void;
};

export default function DropZone({ action, title, hint, cases, onDone }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [caseId, setCaseId] = useState('');

  const send = async (file: File | undefined) => {
    if (!file || busy) return;
    setError('');
    if (!/\.(xlsx|docx|pptx)$/i.test(file.name)) { setError('Choose a .xlsx, .docx or .pptx file.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Files can be up to 4 MB.'); return; }
    setBusy(file.name);
    try {
      const form = new FormData();
      form.set('file', file);
      if (caseId) form.set('caseId', caseId);
      onDone(await api<{ runId: string }>(action, { form }));
    } catch (e) { setError(errorText(e)); setBusy(''); }
    if (input.current) input.current.value = '';
  };

  return (
    <div className={`op-drop drop${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
      onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); void send(event.dataTransfer.files[0]); }}
      onClick={event => { if (event.target === event.currentTarget) input.current?.click(); }}>
      <strong>{title}</strong>
      {busy ? <span className="muted" aria-live="polite">Checking {busy}<span className="busy-dots" /></span> : <span className="muted" style={{ fontSize: 15 }}>{hint}</span>}
      {cases && cases.length > 0 && !busy && (
        <label className="field" style={{ fontWeight: 600, fontSize: 13 }}>Test case
          <select className="op-input" value={caseId} onChange={event => setCaseId(event.target.value)}>
            <option value="">Match by file name</option>
            {cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      )}
      {!busy && <button type="button" className="op-ghost" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => input.current?.click()}><Icon.upload size={16} />Choose a file</button>}
      {error && <p className="notice notice--error" role="alert" style={{ fontSize: 14 }}>{error}</p>}
      <input ref={input} type="file" accept=".xlsx,.docx,.pptx" aria-label={title} onChange={event => void send(event.target.files?.[0])} />
      <img className="op-peek" src="/art/odd.png" alt="" width={128} height={158} />
    </div>
  );
}
