/**
 * Capability 2 · Storytree projects. Where a teaching card's target is on the desktop page (Learning as you build places the card
 * beside it): a story or capability at its island, with the island's box, a decision at its note on the globe, a plan or a question at the rail's Arcs tab,
 * the factory beside the app bar's project dropdown; undefined when it is not on show. And what the user is reading near it, which
 * the card keeps clear of: the open story panel, a story's or capability's nameplate, and, for every card, the bar's project
 * switcher and the globe's Stories/Library switch, the controls a user reaches for first, and the rail. And every island drawn, which the card
 * covers as little of as it can.
 */

/** A teaching card's target, as the teaching cards name it. */
export type CardTarget = { kind: string; story?: string; capability?: string; note?: string };

/** The globe's locator (the forest's `window.storytreeGlobe`), the little of it this reads. */
export interface IslandsAndNotes {
  islands(): readonly { story: string; x: number; y: number; visible: boolean; box?: Box | undefined }[];
  notes(): readonly { note: string; x: number; y: number; visible: boolean }[];
}

/** A target's point and, for one on an island, the island's box, which the card keeps clear of. */
export type Place = { x: number; y: number; visible: boolean; box?: Box };

export function locateTarget(target: CardTarget, page: { document: Document; globe(): IslandsAndNotes | undefined }): Place | undefined {
  const at = (found: { x: number; y: number; visible: boolean; box?: Box | undefined } | undefined): Place | undefined =>
    found === undefined ? undefined : { x: found.x, y: found.y, visible: found.visible, ...(found.box === undefined ? {} : { box: found.box }) };
  if (target.kind === "story" || target.kind === "capability") return at(page.globe()?.islands().find((island) => island.story === target.story));
  if (target.kind === "note") return at(page.globe()?.notes().find((note) => note.note === target.note));
  const beside = (selector: string, x: (box: DOMRect) => number): Place | undefined => {
    const box = page.document.querySelector(selector)?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? undefined : { x: x(box), y: box.top + box.height / 2, visible: true };
  };
  if (target.kind === "switch") return beside(".app-factory", (box) => box.right);
  // At the right of the rail's Arcs tab.
  if (target.kind === "arc" || target.kind === "question") return beside('[data-rail-tab="arcs"]', (box) => box.right);
  return undefined;
}

/** A rectangle on the page, in client pixels. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** The box of every island on show that the globe gives one for. */
export function drawnIslands(globe: IslandsAndNotes | undefined): Box[] {
  return (globe?.islands() ?? []).flatMap((island) => island.visible && island.box !== undefined ? [island.box] : []);
}

/**
 * What is being read near `target` on the page, drawn now: the open story panel, the nameplates of its story and capability,
 * the project switcher and the Stories/Library switch, the CI times strip in the map's bottom-left while it shows, and the left
 * rail while it is open (for a card about the plan, only its tabs and what its panel draws), which no card covers.
 */
export function readingNear(target: CardTarget, document: Document): Box[] {
  const near = [...document.querySelectorAll<HTMLElement>(".story-panel:not([hidden]), .planet-nameplate, .app-factory, .forest-views, .ci-times:not([hidden])")].filter((element) =>
    !element.classList.contains("planet-nameplate")
    || (target.story !== undefined && element.dataset.storyId === target.story)
    || (target.capability !== undefined && element.dataset.capabilityId === target.capability));
  const read = near.flatMap((element) => {
    const { left, top, right, bottom, width } = element.getBoundingClientRect();
    return width === 0 ? [] : [{ left, top, right, bottom }];
  });
  const rail = document.querySelector<HTMLElement>(".side-rail");
  const box = rail?.getBoundingClientRect();
  if (rail === null || box === undefined || box.width === 0) return read;
  // A card about the map keeps off the rail beside it; one about the plan keeps off the rail's tabs and what the panel on show
  // draws (its filter, its rows, its empty line), down to the last thing drawn, and may sit in the rest beneath them.
  if (target.kind !== "arc" && target.kind !== "question") return [...read, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }];
  const drawn = [...rail.querySelectorAll<HTMLElement>(".side-rail-tabs, .side-rail-panel:not([hidden]) *")]
    .filter((element) => element.classList.contains("side-rail-tabs") || element.childElementCount === 0)
    .map((element) => element.getBoundingClientRect()).filter((one) => one.width > 0);
  const last = Math.min(box.bottom, Math.max(box.top, ...drawn.map((one) => one.bottom)));
  return [...read, { left: box.left, top: box.top, right: box.right, bottom: last }];
}
