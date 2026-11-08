/**
 * Capability 2 · Storytree projects. Where a teaching card's target is on the desktop page (Learning as you build places the card
 * beside it): a story or capability at its island, with the island's box, a decision at its note on the globe, a plan or a question at the rail's Arcs tab,
 * the factory beside the app bar's project dropdown; undefined when it is not on show. And what the user is reading near it, which
 * the card keeps clear of: the open story panel, a story's or capability's nameplate, and, for every card, the bar's project
 * switcher and the globe's Stories/Library switch, the controls a user reaches for first. And every island drawn, which the card
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
 * and the project switcher and the Stories/Library switch, which no card covers.
 */
export function readingNear(target: CardTarget, document: Document): Box[] {
  const near = [...document.querySelectorAll<HTMLElement>(".story-panel:not([hidden]), .planet-nameplate, .app-factory, .forest-views")].filter((element) =>
    !element.classList.contains("planet-nameplate")
    || (target.story !== undefined && element.dataset.storyId === target.story)
    || (target.capability !== undefined && element.dataset.capabilityId === target.capability));
  return near.flatMap((element) => {
    const { left, top, right, bottom, width } = element.getBoundingClientRect();
    return width === 0 ? [] : [{ left, top, right, bottom }];
  });
}
