/**
 * Capability 2 · Storytree projects. Where a teaching card's target is on the desktop page (Learning as you build places the card
 * beside it): a story or capability at its island, a decision at its note on the globe, a plan or a question at the arcs drawer,
 * the factory beside the app bar's project dropdown; undefined when it is not on show.
 */

/** A teaching card's target, as the teaching cards name it. */
export type CardTarget = { kind: string; story?: string; note?: string };

/** The globe's locator (the forest's `window.storytreeGlobe`), the little of it this reads. */
export interface IslandsAndNotes {
  islands(): readonly { story: string; x: number; y: number; visible: boolean }[];
  notes(): readonly { note: string; x: number; y: number; visible: boolean }[];
}

export type Place = { x: number; y: number; visible: boolean };

export function locateTarget(target: CardTarget, page: { document: Document; globe(): IslandsAndNotes | undefined }): Place | undefined {
  const at = (found: { x: number; y: number; visible: boolean } | undefined): Place | undefined =>
    found === undefined ? undefined : { x: found.x, y: found.y, visible: found.visible };
  if (target.kind === "story" || target.kind === "capability") return at(page.globe()?.islands().find((island) => island.story === target.story));
  if (target.kind === "note") return at(page.globe()?.notes().find((note) => note.note === target.note));
  const beside = (selector: string, x: (box: DOMRect) => number): Place | undefined => {
    const box = page.document.querySelector(selector)?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? undefined : { x: x(box), y: box.top + box.height / 2, visible: true };
  };
  if (target.kind === "switch") return beside(".app-factory", (box) => box.right);
  // Just past the Arcs bar's label, on the bar.
  if (target.kind === "arc" || target.kind === "question") return beside(".arc-surface-mount [data-open-arcs]", (box) => box.left + 60);
  return undefined;
}
