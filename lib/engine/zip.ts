// Reads the parts of an Office Open XML package. Sizes are capped before anything is inflated.
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { EngineError } from './types.ts';

/** All the XML in one file, once unpacked. */
export const MAX_UNZIPPED_BYTES = 48 * 1024 * 1024;
/** One part read as a whole tree. Worksheet rows and shared strings are read one element at a time and are not held to this. */
export const MAX_TREE_CHARS = 8 * 1024 * 1024;
export const MAX_ENTRIES = 4000;

export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };
export type Package = {
  /** Every entry name in the archive, including media that was not inflated. */
  names: Set<string>;
  text(path: string): string | null;
  xml(path: string): XNode | null;
  /** Relationship id → target path (resolved against the part), plus type and whether it is external. */
  rels(partPath: string): Map<string, { target: string; type: string; external: boolean }>;
};

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', trimValues: false,
  parseTagValue: false, parseAttributeValue: false, processEntities: true, ignoreDeclaration: true, ignorePiTags: true });

type Raw = Record<string, unknown>;
function convert(list: Raw[]): XNode[] {
  const out: XNode[] = [];
  for (const item of list) {
    for (const key of Object.keys(item)) {
      if (key === ':@' || key === '#text') continue;
      const kids = item[key] as Raw[];
      let text = '';
      for (const kid of kids) if ('#text' in kid) text += String(kid['#text']);
      out.push({ name: key, attrs: (item[':@'] as Record<string, string>) ?? {}, children: convert(kids), text });
    }
  }
  return out;
}

/** Office files never carry a DOCTYPE; refusing one rules out entity tricks. */
export function refuseDoctype(source: string) {
  if (/<!DOCTYPE/i.test(source.slice(0, 2000))) throw new EngineError('corrupt', 'The file contains an XML document type declaration, which Office files do not use');
}

function tree(source: string): XNode {
  let nodes: XNode[];
  try { nodes = convert(parser.parse(source) as Raw[]); }
  catch { throw new EngineError('corrupt', 'A part of the file is not valid XML'); }
  if (!nodes.length) throw new EngineError('corrupt', 'A part of the file is not valid XML');
  return nodes[0];
}

export function parseXml(source: string): XNode {
  refuseDoctype(source);
  // A tree takes many times the memory of its text, so a part read whole has its own limit.
  if (source.length > MAX_TREE_CHARS) throw new EngineError('too_large', 'A part of the file is too large to check');
  return tree(source);
}

/**
 * Reads each `<name>…</name>` element of a large part one at a time, so a sheet with hundreds of thousands of rows is
 * never held in memory as one tree. The caller can stop early. The elements must not nest inside each other.
 */
export function* scan(source: string, name: string): Generator<XNode> {
  const open = `<${name}`, close = `</${name}>`;
  let at = 0;
  for (;;) {
    at = source.indexOf(open, at);
    if (at < 0) return;
    const next = source.charCodeAt(at + open.length);
    // "<row" must not match "<rowBreaks".
    if (next !== 62 && next !== 47 && next !== 32 && next !== 9 && next !== 10 && next !== 13) { at += open.length; continue; }
    const tagEnd = source.indexOf('>', at);
    if (tagEnd < 0) return;
    let end = tagEnd + 1;
    if (source.charCodeAt(tagEnd - 1) !== 47) {
      const closing = source.indexOf(close, tagEnd);
      if (closing < 0) throw new EngineError('corrupt', 'A part of the file is not valid XML');
      end = closing + close.length;
    }
    if (end - at > MAX_TREE_CHARS) throw new EngineError('too_large', 'A part of the file is too large to check');
    yield tree(source.slice(at, end));
    at = end;
  }
}

export const kids = (node: XNode | null | undefined, name: string) => node ? node.children.filter(child => child.name === name) : [];
export const kid = (node: XNode | null | undefined, name: string) => node?.children.find(child => child.name === name) ?? null;
export function path(node: XNode | null | undefined, ...names: string[]): XNode | null {
  let current: XNode | null = node ?? null;
  for (const name of names) { current = kid(current, name); if (!current) return null; }
  return current;
}
export function* walk(node: XNode): Generator<XNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}
export const deep = (node: XNode | null | undefined, name: string) => node ? [...walk(node)].filter(item => item.name === name) : [];

function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop(); else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

export function openPackage(bytes: Uint8Array): Package {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new EngineError('unsupported', 'This is not an Office Open XML file (.xlsx, .docx or .pptx)');
  const names = new Set<string>();
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: file => {
      names.add(file.name);
      if (names.size > MAX_ENTRIES) throw new EngineError('too_large', 'The file has too many parts');
      const wanted = /\.(xml|rels)$/i.test(file.name);
      if (wanted) {
        total += file.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new EngineError('too_large', 'The file is too large once unpacked');
      }
      return wanted;
    } });
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError('corrupt', 'The file could not be unpacked. It may be damaged or password-protected.');
  }
  const cache = new Map<string, XNode | null>();
  const text = (name: string) => entries[name] ? strFromU8(entries[name]) : null;
  const xml = (name: string) => {
    if (!cache.has(name)) { const source = text(name); cache.set(name, source === null ? null : parseXml(source)); }
    return cache.get(name) ?? null;
  };
  return { names, text, xml,
    rels(partPath) {
      const slash = partPath.lastIndexOf('/');
      const relPath = `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
      const out = new Map<string, { target: string; type: string; external: boolean }>();
      for (const rel of kids(xml(relPath), 'Relationship')) {
        const external = rel.attrs.TargetMode === 'External';
        out.set(rel.attrs.Id, { target: external ? rel.attrs.Target : resolve(partPath, rel.attrs.Target ?? ''), type: (rel.attrs.Type ?? '').split('/').pop() ?? '', external });
      }
      return out;
    } };
}

export function detectKind(pkg: Package): 'xlsx' | 'docx' | 'pptx' {
  if (pkg.names.has('xl/workbook.xml')) return 'xlsx';
  if (pkg.names.has('word/document.xml')) return 'docx';
  if (pkg.names.has('ppt/presentation.xml')) return 'pptx';
  throw new EngineError('unsupported', 'This archive is not a spreadsheet (.xlsx), document (.docx) or presentation (.pptx)');
}
