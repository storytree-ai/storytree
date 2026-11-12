/**
 * Capability 3 · Story node render. The page's locator (3.41, ADR-1001 D1): where each drawn island and note is on screen, so the
 * lag instrument can click one by name with a real mouse. It only reads places and turns the globe; every click still goes through
 * the globe's own pointer handlers.
 */
import type { ForestScene } from "@storytree/forest";
import type { GlobeTarget, PlacedGlobeControls } from "./globe-guide.js";
import { nameplateAt, type DrawnName } from "./nameplates.js";

/** An island's story and title, its capability count, where a click picks it (its middle, or its own name when another name
 * lies over that, 3.104) and, when its ground is drawn, its box, in the page's
 * client pixels (a teaching card keeps clear of it). */
export type PlacedIsland = { story: string; title: string; capabilities: number; x: number; y: number; visible: boolean;
  box?: { left: number; top: number; right: number; bottom: number } };
/** A Library note drawn on the globe, and where it is in client pixels. */
export type PlacedNote = { note: string; x: number; y: number; visible: boolean };

export interface GlobeLocator {
  islands(): PlacedIsland[];
  notes(): PlacedNote[];
  /** Turn the globe at once, with no glide, to face `target`; false when it is not drawn. */
  face(target: GlobeTarget): boolean;
  /** Whether the globe has handed over its controls, no glide is under way and the globe sits beside the panel as the page
   * measures it now: a panel that has just opened or closed starts its slide only after the next paint (3.45). */
  still(): boolean;
}

/** The locator over the globe's controls (undefined until it hands them over), the scene on show, the canvas's place on the page,
 * the width the right-hand panel takes from the globe now and the names the map shows, in client pixels. */
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
      // A click on a name picks what it names (3.104): a point under no name picks the land, and one on the story's own name it alone.
      const picks = (story: string, at: { x: number; y: number }) => { const named = nameplateAt(names, at); return named === undefined || (named.story === story && named.capability === undefined); };
      return page.scene().islands.flatMap(island => {
        const at = controls.position({ kind: "story", story: island.story });
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
