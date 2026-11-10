'use client';
// Univer Slides (Univer Pro) for a deck read by Univer's own import: each slide appears with the design it has in the
// file, and the findings are drawn over it. Used only when a browser licence is configured; without one the viewer
// keeps the structure view in `univer-slides.ts`. Loaded lazily.
import { ICommandService, LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { SetActiveSlideCommand, SetSlideZoomRatioOperation, UniverSlidesPlugin } from '@univerjs-pro/slides';
import { resolveSlideLogicalPageSize, UniverSlidesUIPlugin } from '@univerjs-pro/slides-ui';
import DesignEnUS from '@univerjs/design/locale/en-US';
import UIEnUS from '@univerjs/ui/locale/en-US';
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import SlidesEnUS from '@univerjs-pro/slides/locale/en-US';
import SlidesUIEnUS from '@univerjs-pro/slides-ui/locale/en-US';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs-pro/slides-ui/lib/index.css';
import type { Deck, Finding } from './engine/types.ts';
import { overlayDeck, type ImportedDeck } from './imported/slides.ts';
import type { SlideView } from './univer-slides.ts';

const UNIT = 'officeproof-deck';
/** Commands that change a slide, a shape or its text. The viewer is read-only, so each is stopped before it runs. */
const EDITS = /^(slide|doc|shape|drawing)\.(command|mutation)\b/;
/** Moving to another slide is the one change the viewer makes itself. */
const MOVES = /\.set-active-slide$/;

export function mountImportedSlides(container: HTMLElement, imported: ImportedDeck, deck: Deck, findings: Finding[], reference: Deck | null, license: string): SlideView {
  const data = overlayDeck(imported, deck, findings, reference, UNIT);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(DesignEnUS, UIEnUS, DocsUIEnUS, SlidesEnUS, SlidesUIEnUS) } });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, { container, header: false, toolbar: false, footer: false, contextMenu: false });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverDrawingPlugin);
  // Univer asks for the licence plugin before the slide plugins.
  univer.registerPlugin(UniverLicensePlugin, { license });
  univer.registerPlugin(UniverSlidesPlugin);
  univer.registerPlugin(UniverSlidesUIPlugin);
  univer.createUnit(UniverInstanceType.UNIVER_SLIDE, data as never);
  const commands = univer.__getInjector().get(ICommandService);
  const api = FUniver.newAPI(univer);
  const guard = api.addEvent(api.Event.BeforeCommandExecute, event => {
    if (EDITS.test(event.id) && !MOVES.test(event.id)) event.cancel = true;
  });
  // The slide list's right-click menu only offers edits, so it is not opened.
  const noMenu = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  container.addEventListener('contextmenu', noMenu, true);
  // Univer sizes the slide before the viewer has settled, so the whole slide is fitted to the space once it has.
  const fit = () => {
    try {
      const canvas = [...container.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!canvas?.clientWidth) return;
      const page = resolveSlideLogicalPageSize(data.defaultPageSize as never);
      const zoomRatio = Math.floor(Math.min((canvas.clientWidth - 56) / page.width, (canvas.clientHeight - 56) / page.height, 1.5) * 100) / 100;
      if (Number.isFinite(zoomRatio) && zoomRatio > 0) void commands.executeCommand(SetSlideZoomRatioOperation.id, { unitId: UNIT, zoomRatio });
    } catch { /* fitting is a convenience */ }
  };
  const timers = [setTimeout(fit, 400), setTimeout(fit, 1300)];
  const order = data.slideOrder ?? [];
  return {
    show(index) {
      const slideId = order[index];
      if (!slideId) return;
      try { void commands.executeCommand(SetActiveSlideCommand.id, { unitId: UNIT, subUnitId: slideId }); } catch { /* switching slides is a convenience */ }
    },
    dispose: () => { timers.forEach(clearTimeout); container.removeEventListener('contextmenu', noMenu, true); guard.dispose(); univer.dispose(); },
  };
}
