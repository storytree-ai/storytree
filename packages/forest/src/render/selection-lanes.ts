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

/** The selected story's neighbours by relation (contract 3.27): "up" when it builds on them, "down" when they
 * build on it; a story on both sides reads "down", as 0.2's shore rings did. */
export function selectionNeighbours(scene: ForestScene, selected: string | undefined): Map<string, SelectionLane["dir"]> {
  const owner = new Map(scene.islands.flatMap(({ story, trees }) => trees.flatMap(({ capability }) => capability === undefined ? [] : [[capability, story] as const])));
  const neighbours = new Map<string, SelectionLane["dir"]>();
  for (const { from, to, dir } of selectionLanes(scene, selected)) {
    const story = owner.get(dir === "up" ? to : from);
    if (story !== undefined && neighbours.get(story) !== "down") neighbours.set(story, dir);
  }
  return neighbours;
}

/** A neighbour ring's pulse `elapsed` seconds after selection: wide and faint, easing to its settled band over 0.72 s. */
export function ringPulse(elapsed: number, reducedMotion: boolean): { width: number; opacity: number } {
  const t = reducedMotion ? 1 : Math.min(1, Math.max(0, elapsed / 0.72));
  const eased = 1 - (1 - t) ** 3;
  return { width: 5 - 3.5 * eased, opacity: 0.45 + 0.55 * eased };
}
