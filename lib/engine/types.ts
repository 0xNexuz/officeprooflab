// Shared types for the OfficeProof Lab check engine. The engine has no app, server or browser imports.

export const ENGINE_VERSION = '0.1.0';

export type FileKind = 'xlsx' | 'docx' | 'pptx';

/** How sure a finding is. Only `confirmed` findings can change a verdict. */
export type Label = 'confirmed' | 'visual' | 'ai';
export type Severity = 'fail' | 'warn' | 'info';

export type Where =
  | { kind: 'file' }
  | { kind: 'cell'; sheet: string; ref: string; refs?: string[] }
  | { kind: 'sheet'; sheet: string }
  | { kind: 'paragraph'; index: number; heading?: string }
  | { kind: 'table'; index: number; row?: number; col?: number }
  | { kind: 'slide'; index: number; shape?: string };

export type Finding = {
  /** Stable for the same problem in the same place, so two runs can be compared. */
  id: string;
  check: string;
  label: Label;
  severity: Severity;
  title: string;
  detail: string;
  where: Where;
  expected?: string;
  actual?: string;
  /** How many places this finding covers when similar ones are grouped. */
  count?: number;
};

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info' | 'skipped';
export type CheckResult = { id: string; title: string; label: Label; status: CheckStatus; findings: number; note?: string };

export type Verdict = 'pass' | 'warn' | 'fail';

export type RunResult = {
  engine: string;
  file: { name: string; kind: FileKind; size: number; sha256: string };
  reference: { name: string; sha256: string } | null;
  verdict: Verdict;
  summary: { fail: number; warn: number; info: number; visual: number; ai: number; checksRun: number; checksPassed: number; checksSkipped: number };
  checks: CheckResult[];
  findings: Finding[];
  stats: Record<string, number | string | boolean>;
  durationMs: number;
};

// ---- Spreadsheet model ----
export type CellValue = string | number | boolean | null;
export type CellType = 'n' | 's' | 'b' | 'e' | 'z';
export type Cell = {
  r: number; c: number;
  /** The value stored in the file (for a formula, its cached result). */
  v: CellValue;
  t: CellType;
  /** Formula text with a leading "=". */
  f?: string;
  /** False when a formula has no stored result. */
  cached?: boolean;
  /** Number format code, when not General. */
  fmt?: string;
  date?: boolean;
};
export type Sheet = {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  cells: Cell[];
  rows: number; cols: number;
  merges: string[];
};
export type Workbook = {
  kind: 'xlsx';
  sheets: Sheet[];
  definedNames: { name: string; ref: string }[];
  externalLinks: number;
  hasMacros: boolean;
  truncated: boolean;
};

// ---- Document model ----
export type DocBlock =
  | { type: 'p'; index: number; text: string; style: string; level: number; list: boolean; fonts: string[]; empty: boolean }
  | { type: 'table'; index: number; tableIndex: number; rows: string[][] };
export type DocumentModel = {
  kind: 'docx';
  blocks: DocBlock[];
  page: { width: number; height: number; orientation: 'portrait' | 'landscape'; margins: { top: number; right: number; bottom: number; left: number } } | null;
  fonts: string[];
  defaultFont: string | null;
  images: { target: string; missing: boolean; alt: boolean }[];
  comments: number;
  trackedChanges: number;
  headers: string[];
  footers: string[];
  words: number;
};

// ---- Presentation model ----
export type SlideShape = {
  id: string; name: string;
  type: 'text' | 'picture' | 'table' | 'chart' | 'group' | 'other';
  placeholder: string | null;
  /** Position and size in EMU; null when the file does not say and no layout placeholder supplies it. */
  box: { x: number; y: number; w: number; h: number } | null;
  text: string;
  paragraphs: string[];
  /** Smallest and largest explicit font size in points, when stated. */
  minFont: number | null; maxFont: number | null;
  fonts: string[];
  autofit: boolean;
  missingMedia: boolean;
};
export type Slide = { index: number; layout: string; title: string | null; shapes: SlideShape[]; notes: string; hidden: boolean };
export type Deck = {
  kind: 'pptx';
  size: { w: number; h: number };
  slides: Slide[];
  fonts: string[];
  themeFonts: { major: string | null; minor: string | null };
};

export type Model = Workbook | DocumentModel | Deck;

// ---- Rules (a test case's own expectations) ----
export type Rule =
  // spreadsheets
  | { cell: string; equals: CellValue; tolerance?: number }
  | { cell: string; sumOf: string; tolerance?: number }
  | { cell: string; between: [number, number] }
  | { cell: string; isFormula: boolean }
  | { range: string; noBlanks: true }
  | { range: string; allNumbers: true }
  | { range: string; unique: true }
  | { headers: string; equal: string[] }
  | { sheet: string }
  // documents and slides
  | { heading: string }
  | { contains: string }
  | { notContains: string }
  | { words: { min?: number; max?: number } }
  | { tables: number | { min?: number; max?: number } }
  | { slides: number | { min?: number; max?: number } }
  | { slide: number; title: string };

export type CheckOptions = {
  rules?: Rule[];
  /** Check ids to leave out. */
  disable?: string[];
  /** Extra phrases to treat as leftover placeholders, matched as plain text. */
  placeholders?: string[];
};

export class EngineError extends Error {
  code: 'unsupported' | 'corrupt' | 'too_large' | 'invalid_rule';
  constructor(code: EngineError['code'], message: string) { super(message); this.code = code; }
}
