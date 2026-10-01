/** What a live update hands the globe (ADR-0836 D1): only what changed, and nothing when nothing on show did. */
import type { ForestScene, SessionWisp } from "@storytree/forest";

/** The globe's drawing as it stands: the scene and each story's permanent place. */
export interface OnShow {
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
}

/** The scene to draw for `scene` at `places`, given what is on show; undefined when it would draw the same. */
export function nextScene(_shown: OnShow, scene: ForestScene, _places: ReadonlyMap<string, number>): ForestScene | undefined {
  return scene;
}

/** Whether wisps `a` and `b` draw the same tints. */
export function sameWisps(_a: readonly SessionWisp[], _b: readonly SessionWisp[]): boolean {
  return false;
}
