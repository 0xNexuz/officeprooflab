'use client';
// A test case's own rules: read as sentences, added through a small form, or edited as JSON for a whole set at once.
import { useState } from 'react';
import { describeRule } from '@/lib/engine/describe';
import type { FileKind, Rule } from '@/lib/engine/types';
import { errorText } from '@/lib/api';
import { Icon } from './Bits';

type Field = { key: string; label: string; placeholder: string };
type Template = { id: string; label: string; fields: Field[]; build: (values: Record<string, string>) => Rule };

const value = (text: string): string | number | boolean => {
  const trimmed = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return trimmed;
};
const bounds = (min: string, max: string) => ({ ...(min.trim() ? { min: Number(min) } : {}), ...(max.trim() ? { max: Number(max) } : {}) });
const cell: Field = { key: 'cell', label: 'Cell', placeholder: 'Summary!E14' };
const range: Field = { key: 'range', label: 'Range', placeholder: 'Summary!E4:E13' };
const textField: Field = { key: 'text', label: 'Text', placeholder: 'Exact words to look for' };

const TEMPLATES: Record<FileKind, Template[]> = {
  xlsx: [
    { id: 'sum', label: 'A cell is the sum of a range', fields: [cell, { key: 'range', label: 'Range', placeholder: 'E4:E13' }], build: v => ({ cell: v.cell, sumOf: v.range }) },
    { id: 'equals', label: 'A cell equals a value', fields: [cell, { key: 'value', label: 'Value', placeholder: '1359' }], build: v => ({ cell: v.cell, equals: value(v.value) }) },
    { id: 'between', label: 'A cell is between two numbers', fields: [cell, { key: 'min', label: 'Lowest', placeholder: '0' }, { key: 'max', label: 'Highest', placeholder: '100' }], build: v => ({ cell: v.cell, between: [Number(v.min), Number(v.max)] }) },
    { id: 'formula', label: 'A cell is a formula', fields: [cell], build: v => ({ cell: v.cell, isFormula: true }) },
    { id: 'noBlanks', label: 'A range has no blank cells', fields: [range], build: v => ({ range: v.range, noBlanks: true }) },
    { id: 'allNumbers', label: 'A range holds only numbers', fields: [range], build: v => ({ range: v.range, allNumbers: true }) },
    { id: 'unique', label: 'A range has no repeated values', fields: [range], build: v => ({ range: v.range, unique: true }) },
    { id: 'headers', label: 'A header row matches', fields: [{ key: 'range', label: 'Header row', placeholder: 'Summary!A3:G3' }, { key: 'names', label: 'Names, separated by commas', placeholder: 'Month, Orders, Units' }], build: v => ({ headers: v.range, equal: v.names.split(',').map(name => name.trim()).filter(Boolean) }) },
    { id: 'sheet', label: 'A sheet exists', fields: [{ key: 'name', label: 'Sheet name', placeholder: 'Forecast' }], build: v => ({ sheet: v.name.trim() }) },
    { id: 'contains', label: 'Some cell contains text', fields: [textField], build: v => ({ contains: v.text }) },
    { id: 'notContains', label: 'No cell contains text', fields: [textField], build: v => ({ notContains: v.text }) },
  ],
  docx: [
    { id: 'heading', label: 'A heading exists', fields: [{ key: 'text', label: 'Heading text', placeholder: 'Summary' }], build: v => ({ heading: v.text.trim() }) },
    { id: 'contains', label: 'The document contains text', fields: [textField], build: v => ({ contains: v.text }) },
    { id: 'notContains', label: 'The document does not contain text', fields: [textField], build: v => ({ notContains: v.text }) },
    { id: 'words', label: 'Word count is within limits', fields: [{ key: 'min', label: 'At least', placeholder: '200' }, { key: 'max', label: 'At most', placeholder: '900' }], build: v => ({ words: bounds(v.min, v.max) }) },
    { id: 'tables', label: 'Number of tables', fields: [{ key: 'count', label: 'Exactly', placeholder: '1' }], build: v => ({ tables: Number(v.count) }) },
  ],
  pptx: [
    { id: 'slides', label: 'Number of slides', fields: [{ key: 'count', label: 'Exactly', placeholder: '6' }], build: v => ({ slides: Number(v.count) }) },
    { id: 'slideRange', label: 'Slide count is within limits', fields: [{ key: 'min', label: 'At least', placeholder: '5' }, { key: 'max', label: 'At most', placeholder: '12' }], build: v => ({ slides: bounds(v.min, v.max) }) },
    { id: 'slide', label: 'A slide has a title', fields: [{ key: 'number', label: 'Slide number', placeholder: '1' }, { key: 'title', label: 'Title', placeholder: 'Board update' }], build: v => ({ slide: Number(v.number), title: v.title.trim() }) },
    { id: 'contains', label: 'Some slide contains text', fields: [textField], build: v => ({ contains: v.text }) },
    { id: 'notContains', label: 'No slide contains text', fields: [textField], build: v => ({ notContains: v.text }) },
  ],
};

export default function RulesEditor({ kind, rules, onSave }: { kind: FileKind; rules: Rule[]; onSave: (rules: Rule[]) => Promise<void> }) {
  const templates = TEMPLATES[kind];
  const [mode, setMode] = useState<'list' | 'add' | 'json'>('list');
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const template = templates.find(item => item.id === templateId) ?? templates[0];

  const save = async (next: Rule[]) => {
    setBusy(true); setError('');
    try { await onSave(next); setMode('list'); setValues({}); }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (template.fields.some(field => !['min', 'max'].includes(field.key) && !(values[field.key] ?? '').trim())) { setError('Fill in every field.'); return; }
    void save([...rules, template.build(Object.fromEntries(template.fields.map(field => [field.key, values[field.key] ?? ''])))]);
  };
  const saveJson = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(draft); } catch { setError('This is not valid JSON.'); return; }
    if (!Array.isArray(parsed)) { setError('The rules must be a JSON list.'); return; }
    void save(parsed as Rule[]);
  };

  return (
    <section className="op-card panel" aria-labelledby="rules-title">
      <div className="panel-head">
        <h2 id="rules-title">Rules</h2>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="op-ghost op-ghost--sm" onClick={() => { setError(''); setDraft(JSON.stringify(rules, null, 2)); setMode(mode === 'json' ? 'list' : 'json'); }}>{mode === 'json' ? 'Close JSON' : 'Edit as JSON'}</button>
          <button type="button" className="op-ghost op-ghost--sm" onClick={() => { setError(''); setMode(mode === 'add' ? 'list' : 'add'); }}><Icon.plus size={15} />{mode === 'add' ? 'Close' : 'Add a rule'}</button>
        </span>
      </div>
      {mode !== 'json' && rules.length === 0 && <div className="empty"><strong>No rules yet</strong><span>The built-in checks always run. Rules add what only you know about this file: the total that must match, the heading that must be there.</span></div>}
      {mode !== 'json' && rules.length > 0 && (
        <ul className="rule-list">
          {rules.map((rule, index) => (
            <li key={`${index}-${JSON.stringify(rule)}`}>
              <span style={{ overflowWrap: 'anywhere' }}>{describeRule(rule)}</span>
              <button type="button" className="icon-btn" aria-label={`Remove rule ${index + 1}: ${describeRule(rule)}`} disabled={busy} onClick={() => void save(rules.filter((_item, i) => i !== index))}><Icon.trash /></button>
            </li>
          ))}
        </ul>
      )}
      {mode === 'add' && (
        <form className="rule-form" onSubmit={add}>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Rule
            <select className="op-input" value={templateId} onChange={event => { setTemplateId(event.target.value); setValues({}); setError(''); }}>
              {templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {template.fields.map(field => (
            <label key={field.key} className="field">{field.label}
              <input className="op-input" value={values[field.key] ?? ''} placeholder={field.placeholder} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
            </label>
          ))}
          <button type="submit" className="op-btn op-btn--sm op-btn--ink" disabled={busy} style={{ justifySelf: 'start' }}>Add rule</button>
        </form>
      )}
      {mode === 'json' && (
        <div className="panel-body">
          <label className="field">Rules as JSON<textarea className="op-input" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} /></label>
          <span className="small muted">The same list goes in <code className="code-pill">officeproof.json</code> under <code className="code-pill">&quot;rules&quot;</code> when the test case runs in CI.</span>
          <button type="button" className="op-btn op-btn--sm op-btn--ink" disabled={busy} onClick={saveJson} style={{ alignSelf: 'flex-start' }}>Save rules</button>
        </div>
      )}
      {error && <p className="notice notice--error" role="alert" style={{ margin: '0 20px 16px' }}>{error}</p>}
    </section>
  );
}
