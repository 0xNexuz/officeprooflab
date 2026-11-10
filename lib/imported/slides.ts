// Draws the findings over a deck that Univer's own import read from the file: an outline around each flagged box, a
// frame for a finding about a whole slide, and the reference deck's boxes. The slides themselves are left as imported.
import type { Deck, Finding, SlideShape } from '../engine/types.ts';

const EMU_PER_POINT = 12700;
export const SLIDE_COLOURS = { fail: '#D21F26', warn: '#FF8A3D', visual: '#E9408F', ai: '#5B3FD6', info: '#5C5C60' };
const colourOf = (finding: Finding) => finding.label === 'visual' ? SLIDE_COLOURS.visual : finding.label === 'ai' ? SLIDE_COLOURS.ai : SLIDE_COLOURS[finding.severity];

type Transform = { left: number; top: number; width: number; height: number; rotation?: number };
type ImportedElement = { id: string; name?: string; type: string; transform?: Transform; [key: string]: unknown };
type ImportedSlide = { id: string; elements?: Record<string, ImportedElement>; elementOrder?: string[]; [key: string]: unknown };
/** The parts of Univer's slide data this module reads; everything else passes through untouched. */
export type ImportedDeck = { id?: string; defaultPageSize?: { width: number; height: number }; slideOrder?: string[]; slides?: Record<string, ImportedSlide>; [key: string]: unknown };

const matches = (finding: Finding, shape: SlideShape) => finding.where.kind === 'slide' && Boolean(finding.where.shape) &&
  (finding.where.shape === shape.name || finding.where.shape === `${shape.placeholder} placeholder` || finding.where.shape === `shape ${shape.id}`);

export function overlayDeck(data: ImportedDeck, deck: Deck, findings: Finding[], reference: Deck | null, id: string): ImportedDeck {
  const page = data.defaultPageSize ?? { width: deck.size.w / EMU_PER_POINT, height: deck.size.h / EMU_PER_POINT };
  const sx = page.width / deck.size.w, sy = page.height / deck.size.h;
  const slides: Record<string, ImportedSlide> = { ...(data.slides ?? {}) };
  const outline = (key: string, box: Transform, colour: string, weight: number, fill?: { colour: string; opacity: number }): ImportedElement => ({
    id: key, name: key, type: 'shape',
    transform: { left: box.left, top: box.top, width: Math.max(4, box.width), height: Math.max(4, box.height), rotation: 0 },
    shapeData: { shapeType: 'rect', fill: fill ? { fillType: 2, color: fill.colour, opacity: fill.opacity } : { fillType: 1 }, stroke: { lineStrokeType: 2, color: colour, width: weight } },
  });
  (data.slideOrder ?? []).forEach((slideId, index) => {
    const source = slides[slideId], slide = deck.slides[index];
    if (!source || !slide) return;
    const added: ImportedElement[] = [];
    const mine = findings.filter(finding => finding.where.kind === 'slide' && finding.where.index === slide.index);
    const whole = mine.filter(finding => finding.where.kind === 'slide' && !finding.where.shape);
    if (whole.length) added.push(outline(`officeproof-frame-${index}`, { left: 5, top: 5, width: page.width - 10, height: page.height - 10 }, colourOf(whole[0]), 2.5));
    slide.shapes.forEach((shape, n) => {
      const flagged = mine.filter(finding => matches(finding, shape));
      if (!flagged.length) return;
      // The engine's own box is what the check measured. A box it could not resolve is taken from the imported element of the same name.
      const named = Object.values(source.elements ?? {}).filter(element => element.name === shape.name && element.transform);
      const box = shape.box ? { left: shape.box.x * sx, top: shape.box.y * sy, width: shape.box.w * sx, height: shape.box.h * sy } : named.length === 1 ? named[0].transform! : null;
      if (box) added.push(outline(`officeproof-flag-${index}-${n}`, { left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }, colourOf(flagged[0]), 2.5));
    });
    const ref = reference?.slides[slide.index];
    if (ref && reference) {
      const rx = page.width / reference.size.w, ry = page.height / reference.size.h;
      ref.shapes.forEach((shape, n) => {
        if (!shape.box || (shape.type === 'text' && !shape.text.trim())) return;
        added.push(outline(`officeproof-ref-${index}-${n}`, { left: shape.box.x * rx, top: shape.box.y * ry, width: shape.box.w * rx, height: shape.box.h * ry }, SLIDE_COLOURS.ai, 1.5, { colour: SLIDE_COLOURS.ai, opacity: 0.07 }));
      });
    }
    if (!added.length) return;
    const elements = { ...(source.elements ?? {}) };
    for (const element of added) elements[element.id] = element;
    slides[slideId] = { ...source, elements, elementOrder: [...(source.elementOrder ?? Object.keys(source.elements ?? {})), ...added.map(element => element.id)] };
  });
  return { ...data, id, slides };
}
