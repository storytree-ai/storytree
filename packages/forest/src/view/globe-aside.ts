/**
 * Capability 3 · Story node render. 3.40: while the right-hand panel (a story, or the Library's note card) covers
 * the window's right, the globe sits in the free width left of it, zooming out only when it would not fit there.
 */

/** Framing is the short half-side in globe radii; offset is CSS pixels right. */
export type AsidePose = { framing: number; sideOffset: number };
type Viewport = { width: number; height: number };

/** Room kept between the globe's rim and the free width's edges when it is zoomed out to fit. */
const FIT_MARGIN = 12;
/** Less free width than this, or than a quarter of the window, is no room to move into: the globe stays put. */
const USEFUL_FREE = 160;

/** Where the globe sits, from `rest` (its place with no panel), with `aside` CSS pixels of the window's right covered. */
export function besidePanel(viewport: Viewport, aside: number, rest: AsidePose): AsidePose {
  const free = viewport.width - aside;
  if (aside <= 0 || free < Math.max(USEFUL_FREE, viewport.width / 4)) return rest;
  const fit = Math.min(viewport.width, viewport.height) / (free - 2 * FIT_MARGIN);
  return { sideOffset: rest.sideOffset - aside / 2, framing: Math.max(rest.framing, fit) };
}

/** How many CSS pixels of `page`'s right the panel covers, its gutter included: none while it draws no box. */
export function panelAside(page: { right: number }, boxes: readonly { left: number }[]): number {
  if (boxes.length === 0) return 0;
  return Math.max(0, page.right - Math.min(...boxes.map(box => box.left)));
}

/**
 * Follows the panel: `place` says where the globe goes when the covered width or the window changes (a glide when
 * the panel opened, closed or changed width; at once on a resize), or undefined when nothing moves. A zoom it applied
 * to fit is undone when the panel closes, unless the wheel has moved the zoom since.
 */
export function createGlobeAside(opening: () => AsidePose) {
  let covered = 0, seen: Viewport | undefined;
  let fitted: { from: number; to: number } | undefined;
  const settle = (viewport: Viewport, rest: AsidePose): AsidePose => {
    const to = besidePanel(viewport, covered, rest);
    fitted = to.framing > rest.framing ? { from: rest.framing, to: to.framing } : undefined;
    return to;
  };
  return {
    place(viewport: Viewport, aside: number, now: AsidePose): { to: AsidePose; glide: boolean } | undefined {
      const resized = seen !== undefined && (seen.width !== viewport.width || seen.height !== viewport.height);
      // With no panel before or now the globe is its host's to place (the website steers its own offset).
      if (aside === covered && (!resized || aside === 0)) { seen = viewport; return undefined; }
      const glide = aside !== covered;
      seen = viewport; covered = aside;
      const ours = fitted !== undefined && Math.abs(now.framing - fitted.to) < 1e-6;
      const to = settle(viewport, { framing: ours ? fitted!.from : now.framing, sideOffset: opening().sideOffset });
      return to.framing === now.framing && to.sideOffset === now.sideOffset ? undefined : { to, glide };
    },
    /** 3.37 with the panel in mind: the opening view, beside the panel while it is open. */
    home(viewport: Viewport): AsidePose {
      seen = viewport;
      return settle(viewport, opening());
    },
  };
}
