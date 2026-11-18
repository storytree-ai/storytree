// Capability 3 · Story node render
import type { ForestScene } from "./forest-scene.js";

export type SelectionLane = { from: string; to: string; dir: "up" | "down" };

export function selectionLanes(scene: ForestScene, selected: string | undefined): SelectionLane[] {
  if (selected === undefined) return [];
  const island = scene.islands.find(({ story }) => story === selected);
  const own = new Set(island === undefined ? [] : [island.story, ...island.trees.flatMap(({ capability }) => capability ?? [])]);
  return (scene.links ?? []).flatMap(({ from, to }): SelectionLane[] =>
    own.has(from) === own.has(to) ? [] : [{ from, to, dir: own.has(from) ? "up" : "down" }]);
}
