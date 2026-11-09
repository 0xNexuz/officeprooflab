// Text checks shared by documents and slides: leftover placeholders, assistant phrases and unconverted Markdown.
// Every pattern is fixed, so the same text always gives the same result.

export type TextHit = { kind: 'placeholder' | 'ai' | 'markdown'; match: string; what: string };

const PLACEHOLDERS: [RegExp, string][] = [
  [/\{\{[^{}\n]{0,80}\}\}/, 'a template marker'],
  [/\{%[^%\n]{0,80}%\}/, 'a template tag'],
  [/\$\{[A-Za-z_][\w.]{0,60}\}/, 'a template variable'],
  [/<<[^<>\n]{1,60}>>/, 'a merge field'],
  [/\[\[[^\[\]\n]{1,60}\]\]/, 'a template marker'],
  [/\[(?:insert|your|add|enter|placeholder|name|date|company|client|customer|title|amount|number|tbd|tbc|todo|x{2,})\b[^\]\n]{0,60}\]/i, 'a bracketed placeholder'],
  [/<(?:insert|your|add|enter|placeholder)\b[^<>\n]{0,60}>/i, 'a bracketed placeholder'],
  [/\blorem ipsum\b/i, 'filler text'],
  [/\b(?:TODO|FIXME|TBD|TBC)\b(?!\w)/, 'a note to self'],
  [/\bPLACEHOLDER\b/, 'the word PLACEHOLDER'],
  [/\bX{3,}\b|\bXX[\/.-]XX[\/.-]XX(?:XX)?\b/, 'a run of Xs standing in for a value'],
  [/\[object Object\]/, 'an object printed as text'],
  [/(?:^|[:=]\s*)(?:undefined|NaN)\s*$/, 'a missing value printed as text'],
  [/^\s*(?:null|undefined|NaN|None)\s*$/, 'a missing value printed as text'],
  [/\bclick to (?:add|edit) (?:title|text|subtitle|notes)\b/i, 'a slide prompt'],
  [/\b(?:type|enter) (?:your )?text here\b/i, 'an input prompt'],
];

const ASSISTANT: RegExp[] = [
  /\bas an? (?:ai|artificial intelligence) (?:language )?(?:model|assistant)\b/i,
  /\bas a large language model\b/i,
  /\bi(?:'|’)?m sorry,? but i (?:can(?:'|’)?t|cannot|am unable)\b/i,
  /\bi (?:cannot|can(?:'|’)t) (?:fulfil+|assist with|help with|comply with|provide)\b/i,
  /\bi hope this helps\b/i,
  /\blet me know if you(?:'|’)?d? (?:like|need|want|have)\b/i,
  /\bwould you like me to\b/i,
  /\bfeel free to (?:ask|adjust|modify|customi[sz]e|reach out|let me know)\b/i,
  /\b(?:certainly|sure|of course|absolutely)[!,.]? here(?:'|’)?s?\b/i,
  /\bhere(?:'|’)?s (?:the|a|an|your) (?:updated |revised |requested |draft |final )?(?:document|report|presentation|deck|spreadsheet|workbook|summary|table|draft|letter|outline|slides?|version)\b/i,
  /\bhere (?:is|are) (?:the|a|an|your) (?:updated |revised |requested |draft |final )?(?:document|report|presentation|deck|spreadsheet|workbook|summary|table|draft|letter|outline|slides?|version)\b/i,
  /\bi(?:'|’)?ve (?:created|drafted|generated|prepared|updated|written|put together)\b/i,
  /\bi have (?:created|drafted|generated|prepared|updated|written|put together)\b/i,
  /\bas requested,? (?:here|i)\b/i,
  /\b(?:my|the model(?:'|’)s) (?:knowledge cutoff|training data)\b/i,
  /\bin this (?:revised|updated) version,? i\b/i,
];

const MARKDOWN: [RegExp, string][] = [
  [/\*\*[^*\s][^*\n]{0,80}\*\*/, 'bold markers'],
  [/(?:^|\s)__[^_\s][^_\n]{0,80}__(?:\s|$)/, 'bold markers'],
  [/^\s{0,3}#{1,6}\s+\S/m, 'a heading marker'],
  [/```/, 'a code fence'],
  [/`[^`\n]{1,60}`/, 'inline code markers'],
  [/\[[^\]\n]{1,80}\]\((?:https?:\/\/|mailto:|#|\/)[^)\s]*\)/, 'a link written as Markdown'],
  [/^\s*\|.+\|.+\|\s*$/m, 'a table written with pipes'],
  [/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m, 'a table divider'],
  [/^\s{0,3}(?:\*|-)\s+\*\*/m, 'a Markdown list'],
];

const snippet = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - 24), end = Math.min(text.length, index + length + 24);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
};

/**
 * A test case's own leftover phrases (for example an internal template tag). They are matched as plain text, not as
 * regular expressions, so a phrase can never make a check slow.
 */
export function compilePatterns(phrases: string[] = []): RegExp[] {
  return phrases.filter(phrase => typeof phrase === 'string' && phrase.trim()).slice(0, 50)
    .map(phrase => new RegExp(phrase.trim().slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

/** At most one hit of each kind per piece of text, so one paragraph gives one finding per problem. */
export function scanText(text: string, extra: RegExp[] = []): (TextHit & { context: string })[] {
  const hits: (TextHit & { context: string })[] = [];
  if (!text || !text.trim()) return hits;
  for (const [pattern, what] of [...PLACEHOLDERS, ...extra.map(item => [item, 'a phrase listed for this test case'] as [RegExp, string])]) {
    const found = pattern.exec(text);
    if (found) { hits.push({ kind: 'placeholder', match: found[0].trim(), what, context: snippet(text, found.index, found[0].length) }); break; }
  }
  for (const pattern of ASSISTANT) {
    const found = pattern.exec(text);
    if (found) { hits.push({ kind: 'ai', match: found[0].trim(), what: 'a phrase from a model reply', context: snippet(text, found.index, found[0].length) }); break; }
  }
  for (const [pattern, what] of MARKDOWN) {
    const found = pattern.exec(text);
    if (found) { hits.push({ kind: 'markdown', match: found[0].trim(), what, context: snippet(text, found.index, found[0].length) }); break; }
  }
  return hits;
}
