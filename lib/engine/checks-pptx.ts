// Deterministic slide checks, plus the one estimate that carries the "visual" label.
import { Collector, clip, textKey } from './collect.ts';
import { scanText } from './text.ts';
import type { Deck, Slide, SlideShape } from './types.ts';

const EMU_PER_POINT = 12700;
const KIND_CHECK = { placeholder: 'PPT-PLACEHOLDER', ai: 'PPT-AI-ARTIFACT', markdown: 'PPT-MARKDOWN' } as const;
const KIND_TITLE = { placeholder: 'A placeholder was left on', ai: 'Assistant text was left on', markdown: 'Markdown was not converted on' } as const;
const FURNITURE = new Set(['dt', 'ftr', 'sldNum', 'hdr']);

export const hasContent = (shape: SlideShape) => shape.type === 'picture' || shape.type === 'table' || shape.type === 'chart' || Boolean(shape.text.trim());
const shapeName = (shape: SlideShape) => shape.name || (shape.placeholder ? `${shape.placeholder} placeholder` : `shape ${shape.id}`);
const inches = (emu: number) => `${(emu / 914400).toFixed(2)} in`;

function overlap(a: NonNullable<SlideShape['box']>, b: NonNullable<SlideShape['box']>) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How many lines the text needs and how many the box holds, from the font size alone. An estimate, not a rendering. */
export function fitEstimate(shape: SlideShape): { needs: number; holds: number; over: boolean } | null {
  if (!shape.box || shape.autofit || !shape.maxFont || shape.type !== 'text' || !shape.text.trim()) return null;
  const size = shape.maxFont;
  const width = shape.box.w / EMU_PER_POINT - 14.4, height = shape.box.h / EMU_PER_POINT - 7.2;
  if (width <= 0 || height <= 0) return null;
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  const needs = shape.paragraphs.reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  const holds = Math.max(1, Math.floor(height / (size * 1.2)));
  // Two or more lines over, or twice the room with a clear margin: a line that only just wraps is not reported.
  const longest = Math.max(...shape.paragraphs.map(paragraph => paragraph.length));
  const over = needs >= holds + 2 || (needs >= holds * 2 && (shape.paragraphs.length > holds || longest > perLine * 1.25));
  return { needs, holds, over };
}

export function checkDeck(deck: Deck, out: Collector, extraPatterns: RegExp[] = []) {
  const { w: W, h: H } = deck.size;
  const visible = deck.slides.filter(slide => !slide.hidden);

  for (const slide of deck.slides) {
    const at = (shape?: SlideShape) => ({ kind: 'slide' as const, index: slide.index, ...(shape ? { shape: shapeName(shape) } : {}) });
    const n = slide.index + 1;

    for (const shape of slide.shapes) {
      for (const hit of scanText(shape.text, extraPatterns)) {
        out.add(KIND_CHECK[hit.kind], at(shape), `${KIND_TITLE[hit.kind]} slide ${n}`, `Found ${hit.what} in "${clip(shapeName(shape), 40)}": ${clip(hit.context, 140)}`, { actual: clip(hit.match, 80) }, `s${slide.index}:${textKey(shape.text)}`);
      }
      if (shape.missingMedia) out.add('PPT-IMAGE', at(shape), `A picture is missing on slide ${n}`, `"${clip(shapeName(shape), 60)}" refers to an image that is not in the file.`);
      if (shape.minFont !== null && shape.minFont < 10 && shape.text.trim()) {
        out.add('PPT-SMALL-TEXT', at(shape), `Slide ${n} has text at ${shape.minFont} pt`, `"${clip(shape.text, 80)}" in "${clip(shapeName(shape), 40)}" is set smaller than 10 points.`, { expected: '10 pt or larger', actual: `${shape.minFont} pt` });
      }
      if (shape.placeholder && !FURNITURE.has(shape.placeholder) && shape.type === 'text' && !shape.text.trim()) {
        out.add('PPT-EMPTY-BOX', at(shape), `Slide ${n} has an empty ${shape.placeholder === 'title' || shape.placeholder === 'ctrTitle' ? 'title' : 'content'} placeholder`, `"${clip(shapeName(shape), 60)}" was left empty.`);
      }
      // Outside the slide. Text, tables and charts must be on the slide; a picture may bleed off the edge, so only one that is mostly off is flagged.
      if (shape.box && hasContent(shape)) {
        const { x, y, w, h } = shape.box;
        const over = Math.max(-x / W, -y / H, (x + w - W) / W, (y + h - H) / H);
        const inside = overlap(shape.box, { x: 0, y: 0, w: W, h: H }) / Math.max(1, w * h);
        if (shape.type === 'picture' ? inside < 0.5 : over > 0.02) {
          const sides = [x < -W * 0.02 ? 'left' : '', x + w > W * 1.02 ? 'right' : '', y < -H * 0.02 ? 'top' : '', y + h > H * 1.02 ? 'bottom' : ''].filter(Boolean);
          out.add('PPT-OFF-SLIDE', at(shape), `"${clip(shapeName(shape), 40)}" runs off the ${sides.join(' and ') || 'edge'} of slide ${n}`,
            `The box starts at ${inches(x)}, ${inches(y)} and is ${inches(w)} by ${inches(h)}; the slide is ${inches(W)} by ${inches(H)}.${shape.text ? ` Text: "${clip(shape.text, 60)}".` : ''}`,
            { expected: 'Inside the slide', actual: `${Math.round((1 - inside) * 100)}% outside` });
        }
      }
      const fit = fitEstimate(shape);
      if (fit?.over) {
        out.add('PPT-VIS-OVERFLOW', at(shape), `Text on slide ${n} may not fit its box`,
          `"${clip(shapeName(shape), 40)}": about ${fit.needs} line${fit.needs === 1 ? '' : 's'} at ${shape.maxFont} pt in a box that holds ${fit.holds}. An estimate from the font size and the amount of text; apps render differently.`,
          { expected: `${fit.holds} line${fit.holds === 1 ? '' : 's'}`, actual: `about ${fit.needs} lines` });
      }
    }

    if (slide.hidden) continue;
    if (!slide.shapes.some(hasContent)) {
      out.add('PPT-EMPTY-SLIDE', at(), `Slide ${n} is empty`, 'It has no text, pictures, tables or charts.');
      continue;
    }
    if (!slide.title) out.add('PPT-NO-TITLE', at(), `Slide ${n} has no title`, 'No title text was found on the slide.');

    const texts = slide.shapes.filter(shape => shape.type === 'text' && shape.text.trim() && shape.box);
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].box!, b = texts[j].box!;
      const shared = overlap(a, b) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
      if (shared >= 0.25) {
        out.add('PPT-OVERLAP', at(texts[j]), `Two text boxes overlap on slide ${n}`,
          `"${clip(shapeName(texts[i]), 40)}" and "${clip(shapeName(texts[j]), 40)}" share ${Math.round(shared * 100)}% of the smaller box.`, { actual: `${Math.round(shared * 100)}% overlap` }, `s${slide.index}:${texts[i].id}+${texts[j].id}`);
      }
    }
  }

  const byTitle = new Map<string, Slide[]>();
  for (const slide of visible) if (slide.title) { const key = slide.title.trim().toLowerCase(); byTitle.set(key, [...(byTitle.get(key) ?? []), slide]); }
  for (const [key, slides] of byTitle) {
    if (slides.length < 2) continue;
    out.add('PPT-REPEAT-TITLE', { kind: 'slide', index: slides[1].index }, `${slides.length} slides share the title "${clip(slides[0].title!, 50)}"`,
      `Slides ${slides.map(slide => slide.index + 1).join(', ')}.`, { count: slides.length }, textKey(key));
  }
}
