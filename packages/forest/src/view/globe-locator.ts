/**
 * Capability 3 · Story node render. The page's locator (3.40, ADR-1001 D1): where each drawn island and note is on screen, so the
 * lag instrument can click one by name with a real mouse. It only reads places and turns the globe; every click still goes through
 * the globe's own pointer handlers.
 */
import type { ForestScene } from "@storytree/forest";
import type { GlobeControls, GlobeTarget } from "./globe-guide.js";

/** An island's story and title, its capability count and where its middle is, in the page's client pixels. */
export type PlacedIsland = { story: string; title: string; capabilities: number; x: number; y: number; visible: boolean };
/** A Library note drawn on the globe, and where it is in client pixels. */
export type PlacedNote = { note: string; x: number; y: number; visible: boolean };

export interface GlobeLocator {
  islands(): PlacedIsland[];
  notes(): PlacedNote[];
  /** Turn the globe at once, with no glide, to face `target`; false when it is not drawn. */
  face(target: GlobeTarget): boolean;
  /** Whether the globe has handed over its controls and no glide is under way. */
  still(): boolean;
}

/** The locator over the globe's controls (undefined until it hands them over), the scene on show and the canvas's place on the page. */
export function globeLocator(page: { controls(): GlobeControls | undefined; scene(): ForestScene; box(): { left: number; top: number } }): GlobeLocator {
  const client = (at: { x: number; y: number; visible: boolean }) => {
    const box = page.box();
    return { x: at.x + box.left, y: at.y + box.top, visible: at.visible };
  };
  return {
    islands() {
      const controls = page.controls();
      if (controls === undefined) return [];
      return page.scene().islands.flatMap(island => {
        const at = controls.position({ kind: "story", story: island.story });
        return at === undefined ? [] : [{ story: island.story, title: island.title, capabilities: island.trees.filter(tree => tree.capability !== undefined).length, ...client(at) }];
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
      return controls !== undefined && !controls.moving();
    },
  };
}
