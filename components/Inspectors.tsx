'use client';
// The run's file opened in Univer: Sheets for a workbook, Docs for a document, Slides for a deck. Each loads on demand.
import { useEffect, useRef, useState } from 'react';
import { errorText } from '@/lib/api';
import type { CheckOptions, Deck, DocumentModel, Finding, Model, Workbook } from '@/lib/engine/types';
import type { DocView } from '@/lib/univer-docs';
import type { SheetView } from '@/lib/univer-sheets';
import type { SlideView } from '@/lib/univer-slides';

type EditResult = { fixed: Finding[]; still: number; added: Finding[] };
/** Checks that compare with what the file stored. An edited workbook has been recalculated, so they no longer apply. */
const STORED_ONLY = ['XL-STALE', 'XL-NO-RESULT'];

export function SheetInspector({ workbook, reference, findings, selected, options }: { workbook: Workbook; reference: Model | null; findings: Finding[]; selected: Finding | null; options: CheckOptions }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SheetView | null>(null);
  const [ready, setReady] = useState(false);
  const [edited, setEdited] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState('');
  const marks = JSON.stringify(findings.map(finding => finding.id));

  useEffect(() => {
    let dead = false;
    setReady(false); setEdited(false); setResult(null);
    import('@/lib/univer-sheets').then(module => {
      if (dead || !host.current) return;
      view.current = module.mountSheet(host.current, workbook, findings);
      view.current.onEdit(() => { setEdited(true); setResult(null); });
      setReady(true);
    }).catch(e => setError(errorText(e)));
    return () => { dead = true; view.current?.dispose(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, marks]);

  useEffect(() => {
    if (!ready || !selected) return;
    const timer = setTimeout(() => view.current?.select(selected.where), 250);
    return () => clearTimeout(timer);
  }, [ready, selected]);

  const recheck = async () => {
    if (!view.current) return;
    setError('');
    try {
      const [{ evaluate }, { compareRuns }] = await Promise.all([import('@/lib/engine/run'), import('@/lib/engine/diff')]);
      const now = await view.current.snapshot();
      const after = evaluate(now.workbook, now.recalc, reference, { ...options, disable: [...(options.disable ?? []), ...STORED_ONLY] });
      const before = findings.filter(finding => finding.label !== 'ai' && !STORED_ONLY.includes(finding.check));
      const diff = compareRuns(before, after.findings);
      setResult({ fixed: diff.fixed, still: diff.still.length, added: diff.added });
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      <div ref={host} className="univer-host" />
      <div className="viewer-foot">
        <span>Cells show the results stored in the file. Try a fix: edit a cell, then run the checks again on the edited workbook. Nothing is saved.</span>
        <button type="button" className="op-ghost" disabled={!edited} onClick={recheck}>Run checks on my edits</button>
      </div>
      {error && <p className="notice notice--error" role="alert" style={{ margin: 16 }}>{error}</p>}
      {result && (
        <div className="edit-result" aria-live="polite">
          <span className="chips">
            <span className={`op-chip ${result.fixed.length ? 'op-chip--pass' : 'op-chip--info'}`}>{result.fixed.length} fixed</span>
            <span className="op-chip op-chip--info">{result.still} still there</span>
            <span className={`op-chip ${result.added.length ? 'op-chip--warn' : 'op-chip--info'}`}>{result.added.length} new</span>
          </span>
          {result.fixed.length > 0 && <div><strong>Fixed by your edits</strong><ul>{result.fixed.map(finding => <li key={finding.id}>{finding.title}</li>)}</ul></div>}
          {result.added.length > 0 && <div><strong>New with your edits</strong><ul>{result.added.map(finding => <li key={finding.id}>{finding.title}</li>)}</ul></div>}
          <span className="muted small">This is a check of the edited copy in your browser, recalculated by Univer. Checks on stored results are left out. To record it, fix the generator and run the new file.</span>
        </div>
      )}
    </>
  );
}

export function DocInspector({ doc, findings, selected }: { doc: DocumentModel; findings: Finding[]; selected: Finding | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<DocView | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const marks = JSON.stringify(findings.map(finding => finding.id));
  useEffect(() => {
    let dead = false;
    setReady(false);
    import('@/lib/univer-docs').then(module => {
      if (dead || !host.current) return;
      view.current = module.mountDoc(host.current, doc, findings);
      setReady(true);
    }).catch(e => setError(errorText(e)));
    return () => { dead = true; view.current?.dispose(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, marks]);
  useEffect(() => {
    if (!ready || !selected) return;
    const timer = setTimeout(() => view.current?.select(selected.where), 250);
    return () => clearTimeout(timer);
  }, [ready, selected]);
  return (
    <>
      <div ref={host} className="univer-host univer-host--doc" />
      {error && <p className="notice notice--error" role="alert" style={{ margin: 16 }}>{error}</p>}
      <div className="viewer-foot"><span>Read-only. Tables are shown one row per line, with bars between the cells.</span></div>
    </>
  );
}

export function SlideInspector({ deck, reference, findings, selected, showReference }: { deck: Deck; reference: Deck | null; findings: Finding[]; selected: Finding | null; showReference: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SlideView | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const marks = JSON.stringify(findings.map(finding => finding.id));
  const slideIndex = selected?.where.kind === 'slide' ? selected.where.index : null;
  useEffect(() => {
    let dead = false;
    setReady(false);
    import('@/lib/univer-slides').then(module => {
      if (dead || !host.current) return;
      view.current = module.mountSlides(host.current, deck, findings, showReference ? reference : null);
      setReady(true);
    }).catch(e => setError(errorText(e)));
    return () => { dead = true; view.current?.dispose(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, marks, showReference, reference]);
  useEffect(() => {
    if (!ready || slideIndex === null) return;
    const timer = setTimeout(() => view.current?.show(slideIndex), 300);
    return () => clearTimeout(timer);
  }, [ready, slideIndex]);
  return (
    <>
      <div ref={host} className="univer-host univer-host--slides" />
      {error && <p className="notice notice--error" role="alert" style={{ margin: 16 }}>{error}</p>}
      <div className="viewer-foot"><span>Each slide is rebuilt from where its boxes sit and what they say; it is not a rendering of the original design. Flagged boxes are outlined, and the reference&apos;s boxes are drawn in violet.</span></div>
    </>
  );
}
