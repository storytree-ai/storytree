/** Capability 3 · Story node render. */
import type { ForestScene } from "./forest-scene.js";

/** A link lit by a story selection: `from` builds on `to`, each a capability or an island as a whole; "up" when the selected story is the one building. */
export type SelectionLane = { from: string; to: string; dir: "up" | "down" };

/**
 * The lanes a selected story lights (contract 3.26, 0.2's ADR-0242 one-hop highlight): every capability link with
 * exactly one end on its island, derived or recorded alike. Direct links only; the transitive reveal was retired in
 * 0.2 for lag. A story edge with no capability at an end has no road, so it lights nothing (ADR-0991 D5).
 */
export function selectionLanes(scene: ForestScene, selected: string | undefined): SelectionLane[] {
  if (selected === undefined) return [];
  const island = scene.islands.find(({ story }) => story === selected);
  const own = new Set(island === undefined ? [] : [island.story, ...island.trees.flatMap(({ capability }) => capability ?? [])]);
  return (scene.links ?? []).flatMap(({ from, to }): SelectionLane[] =>
    own.has(from) === own.has(to) ? [] : [{ from, to, dir: own.has(from) ? "up" : "down" }]);
}
