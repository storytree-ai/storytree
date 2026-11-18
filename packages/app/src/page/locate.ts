// Capability 2 · Storytree projects

export type CardTarget = { kind: string; story?: string; capability?: string; note?: string };

export interface IslandsAndNotes {
  islands(): readonly { story: string; x: number; y: number; visible: boolean; box?: Box | undefined }[];
  notes(): readonly { note: string; x: number; y: number; visible: boolean }[];
}

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
  if (target.kind === "arc" || target.kind === "question") return beside('[data-rail-tab="arcs"]', (box) => box.right);
  return undefined;
}

export type Box = { left: number; top: number; right: number; bottom: number };

export function drawnIslands(globe: IslandsAndNotes | undefined): Box[] {
  return (globe?.islands() ?? []).flatMap((island) => island.visible && island.box !== undefined ? [island.box] : []);
}

export function readingNear(target: CardTarget, document: Document): Box[] {
  const near = [...document.querySelectorAll<HTMLElement>(".story-panel:not([hidden]), .planet-nameplate, .app-factory, .app-gear, .forest-views, .ci-times:not([hidden])")].filter((element) =>
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
  if (target.kind !== "arc" && target.kind !== "question") return [...read, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }];
  const drawn = [...rail.querySelectorAll<HTMLElement>(".side-rail-tabs, .side-rail-panel:not([hidden]) *")]
    .filter((element) => element.classList.contains("side-rail-tabs") || element.childElementCount === 0)
    .map((element) => element.getBoundingClientRect()).filter((one) => one.width > 0);
  const last = Math.min(box.bottom, Math.max(box.top, ...drawn.map((one) => one.bottom)));
  return [...read, { left: box.left, top: box.top, right: box.right, bottom: last }];
}
