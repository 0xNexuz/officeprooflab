'use client';
// Univer Slides for the run report: each slide rebuilt from its boxes, with flagged boxes outlined and, on request,
// the reference deck's boxes drawn over it. This shows where things sit; it is not a rendering of the original design.
import { ICommandService, LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core';
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { PageElementType, PageType, UniverSlidesPlugin } from '@univerjs/slides';
import { ActivateSlidePageOperation, UniverSlidesUIPlugin } from '@univerjs/slides-ui';
import DesignEnUS from '@univerjs/design/locale/en-US';
import UIEnUS from '@univerjs/ui/locale/en-US';
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import SlidesUIEnUS from '@univerjs/slides-ui/locale/en-US';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/slides-ui/lib/index.css';
import type { Deck, Finding, SlideShape } from './engine/types.ts';

const EMU_PER_PX = 9525;
const COLOURS = { fail: 'rgb(210,31,38)', warn: 'rgb(255,138,61)', visual: 'rgb(233,64,143)', ai: 'rgb(91,63,214)', info: 'rgb(92,92,96)' };
const colourOf = (finding: Finding) => finding.label === 'visual' ? COLOURS.visual : finding.label === 'ai' ? COLOURS.ai : COLOURS[finding.severity];
const UNIT = 'officeproof-deck';
/**
 * Univer Slides 1.3.1 draws the text of a text element 50 points in from the element's left and top edges and wraps it
 * 50 points short of the right edge, whatever margins the text is given (measured in the browser; see the build ledger).
 * Text elements are moved out by the same amount so the words sit where the file puts them.
 */
const TEXT_INSET = 200 / 3;

type Element = Record<string, unknown>;

/**
 * A text box as a Univer document, one paragraph per line, so a multi-line box keeps every line.
 */
function richText(id: string, text: string, size: number, bold: boolean, colour: string, width: number) {
  const stream = text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, ' ').replace(/\n/g, '\r');
  const full = `${stream}\r\n`;
  const paragraphs: { startIndex: number; paragraphId: string }[] = [];
  for (let i = 0; i < full.length; i++) if (full[i] === '\r') paragraphs.push({ startIndex: i, paragraphId: `${id}-p${paragraphs.length}` });
  return { rich: { id, body: { dataStream: full, paragraphs, textRuns: [{ st: 0, ed: stream.length, ts: { fs: size, cl: { rgb: colour }, ...(bold ? { bl: 1 } : {}) } }], sectionBreaks: [{ sectionId: `${id}-s`, startIndex: full.length - 1 }] },
    documentStyle: { pageSize: { width, height: Number.POSITIVE_INFINITY }, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 } } };
}

/** The deck as Univer slide data, scaled by `scale` so a whole slide fits the space it is shown in. */
export function slideData(deck: Deck, findings: Finding[], reference: Deck | null, scale = 1) {
  const px = (emu: number) => Math.round(emu / EMU_PER_PX * scale);
  const pages: Record<string, unknown> = {};
  const order: string[] = [];
  const rect = (id: string, zIndex: number, box: NonNullable<SlideShape['box']>, fill: string, stroke: string, weight: number, grow = 0): Element => ({
    id, zIndex, left: px(box.x) - grow, top: px(box.y) - grow, width: Math.max(4, px(box.w) + grow * 2), height: Math.max(4, px(box.h) + grow * 2), title: id, description: '', type: PageElementType.SHAPE,
    shape: { shapeType: 'rect', text: '', shapeProperties: { shapeBackgroundFill: { rgb: fill }, outline: { outlineFill: { rgb: stroke }, weight } } } });
  deck.slides.forEach(slide => {
    const id = `slide-${slide.index}`;
    order.push(id);
    const elements: Record<string, Element> = {};
    const mine = findings.filter(finding => finding.where.kind === 'slide' && finding.where.index === slide.index);
    let z = 10;
    // A finding about the whole slide frames the slide.
    const whole = mine.filter(finding => finding.where.kind === 'slide' && !finding.where.shape);
    if (whole.length) elements[`${id}-frame`] = rect(`${id}-frame`, 1, { x: 8 * EMU_PER_PX, y: 8 * EMU_PER_PX, w: deck.size.w - 16 * EMU_PER_PX, h: deck.size.h - 16 * EMU_PER_PX }, 'rgb(255,255,255)', colourOf(whole[0]), 3);
    slide.shapes.forEach((shape, index) => {
      if (!shape.box) return;
      const key = `${id}-s${index}`;
      const flagged = mine.filter(finding => finding.where.kind === 'slide' && finding.where.shape && (finding.where.shape === shape.name || finding.where.shape === `${shape.placeholder} placeholder` || finding.where.shape === `shape ${shape.id}`));
      if (flagged.length) elements[`${key}-flag`] = rect(`${key}-flag`, z++, shape.box, 'rgb(255,247,240)', colourOf(flagged[0]), 3, 5);
      if (shape.type === 'text') {
        if (!shape.text.trim()) { elements[key] = rect(key, z++, shape.box, 'rgb(246,246,244)', 'rgb(190,188,182)', 1); return; }
        const bold = shape.placeholder === 'title' || shape.placeholder === 'ctrTitle' || slide.title === shape.text.replace(/\s+/g, ' ');
        const width = Math.max(8, px(shape.box.w)) + TEXT_INSET * 2;
        elements[key] = { id: key, zIndex: z++, left: px(shape.box.x) - TEXT_INSET, top: px(shape.box.y) - TEXT_INSET, width, height: Math.max(8, px(shape.box.h)) + TEXT_INSET * 2, title: shape.name, description: '', type: PageElementType.TEXT,
          richText: richText(key, shape.text, Math.max(4, (shape.maxFont ?? 18) * scale), bold, 'rgb(12,12,12)', width) };
      } else {
        elements[key] = rect(key, z++, shape.box, shape.missingMedia ? 'rgb(251,227,225)' : 'rgb(236,234,229)', 'rgb(92,92,96)', 1);
        const label = shape.type === 'picture' ? (shape.missingMedia ? 'Picture (missing)' : 'Picture') : shape.type === 'chart' ? 'Chart' : shape.type === 'table' ? 'Table' : '';
        if (label && shape.box.w > 60 * EMU_PER_PX) elements[`${key}-label`] = { id: `${key}-label`, zIndex: z++, left: px(shape.box.x) + 10 - TEXT_INSET, top: px(shape.box.y) + 8 - TEXT_INSET, width: 180 + TEXT_INSET * 2, height: 30 + TEXT_INSET * 2, title: label, description: '', type: PageElementType.TEXT,
          richText: richText(`${key}-label`, label, Math.max(7, 12 * scale), false, 'rgb(61,61,64)', 180 + TEXT_INSET * 2) };
      }
    });
    const ref = reference?.slides[slide.index];
    if (ref && reference) {
      const sx = deck.size.w / reference.size.w, sy = deck.size.h / reference.size.h;
      ref.shapes.forEach((shape, index) => {
        if (!shape.box || (shape.type === 'text' && !shape.text.trim())) return;
        elements[`${id}-ref${index}`] = rect(`${id}-ref${index}`, 500 + index, { x: shape.box.x * sx, y: shape.box.y * sy, w: shape.box.w * sx, h: shape.box.h * sy }, 'rgba(91,63,214,0.07)', COLOURS.ai, 2);
      });
    }
    pages[id] = { id, pageType: PageType.SLIDE, zIndex: 1, title: slide.title ?? `Slide ${slide.index + 1}`, description: '', pageBackgroundFill: { rgb: 'rgb(255,255,255)' }, pageElements: elements };
  });
  return { id: UNIT, title: 'Checked deck', pageSize: { width: px(deck.size.w), height: px(deck.size.h) }, body: { pages, pageOrder: order } };
}

export type SlideView = { show: (index: number) => void; dispose: () => void };

export function mountSlides(container: HTMLElement, deck: Deck, findings: Finding[], reference: Deck | null): SlideView {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(DesignEnUS, UIEnUS, DocsUIEnUS, SlidesUIEnUS) } });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, { container, header: false, toolbar: false, footer: false, contextMenu: false });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverDrawingPlugin);
  univer.registerPlugin(UniverSlidesPlugin);
  univer.registerPlugin(UniverSlidesUIPlugin);
  // Univer shows a slide at its real size, so the deck is scaled to fit beside the slide list.
  const room = Math.max(260, container.clientWidth - 300);
  const scale = Math.min(1, room / (deck.size.w / EMU_PER_PX), (container.clientHeight - 60) / (deck.size.h / EMU_PER_PX));
  univer.createUnit(UniverInstanceType.UNIVER_SLIDE, slideData(deck, findings, reference, scale) as never);
  // Univer centres the slide when it first draws; the viewer may still be settling then, so centre it again.
  const centre = () => {
    try {
      const scene = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(UNIT)?.scene;
      const view = scene?.getViewport('__mainView__');
      const engine = scene?.getEngine();
      if (!scene || !view || !engine) return;
      const { x, y } = view.transViewportScroll2ScrollValue((scene.width - engine.width) / 2, (scene.height - engine.height) / 2);
      view.scrollToBarPos({ x, y });
    } catch { /* centring is a convenience */ }
  };
  const timers = [setTimeout(centre, 350), setTimeout(centre, 1200)];
  return {
    show(index) {
      try { void univer.__getInjector().get(ICommandService).executeCommand(ActivateSlidePageOperation.id, { unitId: UNIT, id: `slide-${index}` }); } catch { /* switching slides is a convenience */ }
      timers.push(setTimeout(centre, 200));
    },
    dispose: () => { timers.forEach(clearTimeout); univer.dispose(); },
  };
}
