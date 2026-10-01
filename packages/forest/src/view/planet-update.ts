/** What a live update hands the globe (ADR-0836 D1): only what changed, and nothing when nothing on show did. */
import type { ClaimTint, ForestScene, Island, SessionWisp } from "@storytree/forest";

/** The globe's drawing as it stands: the scene and each story's permanent place. */
export interface OnShow {
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
}

/**
 * The scene to draw for `scene` at `places`, given what is on show; undefined when it would draw the same.
 * An island whose key is unchanged keeps the object on show, so its plate is not derived again.
 */
export function nextScene(shown: OnShow, scene: ForestScene, places: ReadonlyMap<string, number>): ForestScene | undefined {
  const previous = new Map(shown.scene.islands.map(island => [island.story, island]));
  const islands = scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island);
  const same = islands.length === shown.scene.islands.length && islands.every((island, index) => island === shown.scene.islands[index])
    && JSON.stringify(scene.links ?? []) === JSON.stringify(shown.scene.links ?? [])
    && places.size === shown.places.size && [...places].every(([story, place]) => shown.places.get(story) === place);
  return same ? undefined : { ...scene, islands };
}

/** Whether wisps `a` and `b` draw the same tints. */
export function sameWisps(a: readonly SessionWisp[], b: readonly SessionWisp[]): boolean {
  return a.length === b.length && a.every((wisp, index) => {
    const other = b[index]!;
    return wisp.session === other.session && wisp.story === other.story && wisp.colour === other.colour && wisp.phase === other.phase
      && wisp.faded === other.faded && wisp.capabilities.length === other.capabilities.length && wisp.capabilities.every((c, i) => c === other.capabilities[i]);
  });
}

/** What of `claimed` tints island land `land`: equal while only other islands' claims change. */
export function claimsOn(claimed: ReadonlyMap<string, ClaimTint>, land: NonNullable<Island["land"]>): string {
  return JSON.stringify(land.territories.map(({ capability }) => capability === undefined ? undefined : claimed.get(capability)));
}
