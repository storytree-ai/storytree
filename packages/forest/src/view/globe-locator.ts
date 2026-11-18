// Capability 3 · Story node render
import type { ForestScene } from "@storytree/forest";
import type { GlobeTarget, PlacedGlobeControls } from "./globe-guide.js";
import { nameplateAt, type DrawnName } from "./nameplates.js";

export type PlacedIsland = { story: string; title: string; capabilities: number; x: number; y: number; visible: boolean;
  box?: { left: number; top: number; right: number; bottom: number } };
export type PlacedNote = { note: string; x: number; y: number; visible: boolean };

export interface GlobeLocator {
  islands(): PlacedIsland[];
  notes(): PlacedNote[];
  face(target: GlobeTarget): boolean;
  still(): boolean;
}

export function globeLocator(page: { controls(): PlacedGlobeControls | undefined; scene(): ForestScene; box(): { left: number; top: number }; aside(): number;
  names?(): readonly DrawnName[] }): GlobeLocator {
  const client = (at: { x: number; y: number; visible: boolean }) => {
    const box = page.box();
    return { x: at.x + box.left, y: at.y + box.top, visible: at.visible };
  };
  return {
    islands() {
      const controls = page.controls();
      if (controls === undefined) return [];
      const { left, top } = page.box();
      const grounds = new Map(controls.islands().map(ground => [ground.story,
        { left: ground.x + left, top: ground.y + top, right: ground.x + ground.width + left, bottom: ground.y + ground.height + top }]));
      const names = page.names?.() ?? [];
      const picks = (story: string, at: { x: number; y: number }) => { const named = nameplateAt(names, at); return named === undefined || (named.story === story && named.capability === undefined); };
      const islands = page.scene().islands, places = controls.positions(islands.map(island => ({ kind: "story", story: island.story })));
      return islands.flatMap((island, index) => {
        const at = places[index];
        const box = grounds.get(island.story);
        if (at === undefined) return [];
        const middle = client(at);
        const own = names.find(name => name.story === island.story && name.capability === undefined)?.box;
        const name = own === undefined ? undefined : { x: (own.left + own.right) / 2, y: (own.top + own.bottom) / 2 };
        const point = picks(island.story, middle) || name === undefined || !picks(island.story, name) ? middle : { ...middle, ...name };
        return [{ story: island.story, title: island.title, capabilities: island.trees.filter(tree => tree.capability !== undefined).length, ...point,
          ...(box === undefined ? {} : { box }) }];
      });
    },
    notes() {
      const controls = page.controls();
      if (controls === undefined) return [];
      return controls.notes().flatMap(note => {
        const at = controls.position({ kind: "note", note });
        return at === undefined ? [] : [{ note, ...client(at) }];
      });
    },
    face: target => page.controls()?.stop({ target, duration: 0 }) ?? false,
    still() {
      const controls = page.controls();
      return controls !== undefined && !controls.moving() && controls.aside() === page.aside();
    },
  };
}
