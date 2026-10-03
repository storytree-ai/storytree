import type { ForestScene } from "./forest-scene.js";

/** A capability link lit by a story selection: `from` builds on `to`; "up" when the selected story is the one building. */
export type SelectionLane = { from: string; to: string; dir: "up" | "down" };

/**
 * The lanes a selected story lights (contract 3.26, 0.2's ADR-0242 one-hop highlight): every capability link
 * with exactly one end on its island. Direct links only; the transitive reveal was retired in 0.2 for lag.
 */
export function selectionLanes(scene: ForestScene, selected: string | undefined): SelectionLane[] {
  if (selected === undefined) return [];
  const own = new Set(scene.islands.find(island => island.story === selected)?.trees.flatMap(({ capability }) => capability ?? []) ?? []);
  return (scene.links ?? []).flatMap(({ from, to }): SelectionLane[] =>
    own.has(from) === own.has(to) ? [] : [{ from, to, dir: own.has(from) ? "up" : "down" }]);
}
