/** Capability 3 · Story node render. */
import type { ForestScene } from "./forest-scene.js";

/** A link lit by a story selection: `from` builds on `to`; "up" when the selected story is the one building. Its ends
 * are capabilities, or for a row dependency no capability link joins, the two stories themselves. */
export type SelectionLane = { from: string; to: string; dir: "up" | "down" };

/** Each capability's story, and each story as its own owner, so a lane's end of either kind names its island. */
function owners(scene: ForestScene): Map<string, string> {
  return new Map(scene.islands.flatMap(({ story, trees }) => [[story, story] as const,
    ...trees.flatMap(({ capability }) => capability === undefined ? [] : [[capability, story] as const])]));
}

/**
 * The lanes a selected story lights (contract 3.26, 0.2's ADR-0242 one-hop highlight): every capability link
 * with exactly one end on its island, then a story-to-story lane for each dependency its row is ranked by, either
 * way, that no capability link already joins in that direction, so the lanes explain where its island sits.
 * Direct links only; the transitive reveal was retired in 0.2 for lag.
 */
export function selectionLanes(scene: ForestScene, selected: string | undefined): SelectionLane[] {
  if (selected === undefined) return [];
  const owner = owners(scene);
  const own = new Set(scene.islands.find(island => island.story === selected)?.trees.flatMap(({ capability }) => capability ?? []) ?? []);
  const lanes = (scene.links ?? []).flatMap(({ from, to }): SelectionLane[] =>
    own.has(from) === own.has(to) ? [] : [{ from, to, dir: own.has(from) ? "up" : "down" }]);
  const joined = new Set(lanes.map(({ from, to }) => `${owner.get(from)}->${owner.get(to)}`));
  return [...lanes, ...(scene.rowLinks ?? []).flatMap(({ from, to }): SelectionLane[] =>
    (from === selected) === (to === selected) || joined.has(`${from}->${to}`) || !owner.has(from) || !owner.has(to) ? []
      : [{ from, to, dir: from === selected ? "up" : "down" }])];
}

/** The selected story's neighbours by relation (contract 3.27): "up" when it builds on them, "down" when they
 * build on it; a story on both sides reads "down", as 0.2's shore rings did. */
export function selectionNeighbours(scene: ForestScene, selected: string | undefined): Map<string, SelectionLane["dir"]> {
  const owner = owners(scene);
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

/** The neighbour whose dock a lane's front is at (contract 3.27), so its ring pulses in then: a lane runs from the island
 * built on to the one building on it, so an up lane sets out from its neighbour and a down lane arrives at its own. */
export function reachedNeighbour(scene: ForestScene, lane: SelectionLane, at: "start" | "end"): string | undefined {
  if ((lane.dir === "up") !== (at === "start")) return undefined;
  return owners(scene).get(lane.dir === "up" ? lane.to : lane.from);
}
