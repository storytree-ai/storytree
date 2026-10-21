/**
 * Capability 2 · Surface naming. Which named surface is in front of the owner: each story marks the root of each canvas it
 * opens with `data-surface-id`, its declared id, and `data-surface-layer` when the canvas is an overlay or a side panel.
 * Only the marks are read, so a canvas is named where it is built, never guessed at here.
 */

/** A surface as the stories declare it, with the story (its package's part name) that declares it. */
export interface DeclaredSurface {
  readonly id: string;
  readonly name: string;
  readonly story: string;
}

/** A canvas that is not one of the Surfaces menu's switches, as a story's manifest names it (`namedSurfaces`). */
export interface NamedSurface {
  readonly id: string;
  readonly name: string;
}

/** Above the main view: a drawer or window over it, then a side panel beside it. */
export type SurfaceLayer = "overlay" | "panel";

const RANK: Readonly<Record<string, number>> = { panel: 1, overlay: 2 };
/** An open popover or dialog is the browser's top layer, above every overlay. */
const TOP = 3;

/**
 * The id of the top-most named surface on show in `document`: one inside an open popover or dialog first, then an
 * overlay, then a side panel, then the main view; among equals, the one shown last (a canvas inside another is shown
 * after it). Undefined when no named surface is on show: there is no fallback name.
 */
export function surfaceInFront(document: Document): string | undefined {
  let front: { id: string; rank: number } | undefined;
  for (const element of document.querySelectorAll<HTMLElement>("[data-surface-id]")) {
    const id = element.dataset.surfaceId;
    if (id === undefined || id === "" || !onShow(element)) continue;
    const rank = inTopLayer(element) ? TOP : RANK[element.dataset.surfaceLayer ?? ""] ?? 0;
    if (front === undefined || rank >= front.rank) front = { id, rank };
  }
  return front?.id;
}

/** The open popover or dialog `element` is in, if any. */
export function topLayerOf(element: Element): HTMLElement | undefined {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node instanceof HTMLDialogElement ? node.open : node.hasAttribute("popover") && node.matches(":popover-open")) return node as HTMLElement;
  }
  return undefined;
}

function inTopLayer(element: Element): boolean {
  return topLayerOf(element) !== undefined;
}

/** Drawn on the page: neither it nor an ancestor is hidden, closed or out of the layout. */
function onShow(element: HTMLElement): boolean {
  return element.checkVisibility() && element.getClientRects().length > 0;
}
