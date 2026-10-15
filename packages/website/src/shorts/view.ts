/** Capability 6 · Pixel-art shorts. What the storytree side looks at in the real view: the island the developer inspects,
 * the island it leans on most (what feeds it), and how the globe turns to face each in its beat. The saved snapshot the
 * website already draws is the source, so the names on screen are real ones. */
import type { TourSnapshot } from "../forest-data.js";
import saved from "../forest-snapshot.json" with { type: "json" };
import type { Beat } from "./script.js";

export const snapshot = saved as unknown as TourSnapshot;
type Island = { story: string; title: string };

const islands = snapshot.scene.islands as unknown as (Island & { trees: { capability: string }[] })[];
const home = new Map(islands.flatMap(island => island.trees.map(tree => [tree.capability, island.story] as const)));

const spots = new Map(snapshot.spots);
/** The camera looks down on the globe, so an island far south only shows on its lower rim: the short looks at others. */
const seen = (story: string) => spots.get(story)!.y > -0.3;

/** How many of each island's capabilities' links lead to each other island, among islands the camera sees well. */
const feeds = new Map<string, Map<string, number>>();
for (const { from, to } of snapshot.scene.links as unknown as { from: string; to: string }[]) {
  const [a, b] = [home.get(from), home.get(to)];
  if (!a || !b || a === b || !seen(a) || !seen(b)) continue;
  const row = feeds.get(a) ?? new Map<string, number>();
  feeds.set(a, row.set(b, (row.get(b) ?? 0) + 1));
}
const strongest = (row: Map<string, number>) => [...row].reduce((best, next) => next[1] > best[1] ? next : best);
const island = (story: string): Island => ({ story, title: islands.find(each => each.story === story)!.title });

/** The island the developer inspects: the one leaning on another island hardest; and that other island, which feeds it. */
const [inspected, row] = [...feeds].reduce((best, next) => strongest(next[1])[1] > strongest(best[1])[1] ? next : best);
export const ISLAND = island(inspected);
export const UPSTREAM = island(strongest(row)[0]);

/** The globe's turn about its axis, in radians, that brings `story` to face the eye. */
const facing = (story: string) => { const { x, z } = spots.get(story)!; return Math.atan2(-x, z); };
const ease = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const DRIFT = 0.03, TURN = 1.2;

/** The globe's angle at `seconds`: it drifts slowly, and at each beat that looks somewhere new it turns, the short way
 * round over TURN seconds, to face that island. */
export function turnAt(beats: readonly Beat[], seconds: number): number {
  let angle = facing(UPSTREAM.story) - 0.9, looked: Beat["looks"];
  for (const beat of beats) {
    if (beat.from > seconds) break;
    if (!beat.looks || beat.looks === looked) continue;
    looked = beat.looks;
    const target = facing(looked === "upstream" ? UPSTREAM.story : ISLAND.story) - DRIFT * (beat.from + TURN);
    angle += Math.atan2(Math.sin(target - angle), Math.cos(target - angle)) * ease((seconds - beat.from) / TURN);
  }
  return angle + DRIFT * seconds;
}

/** The island lit at `seconds` and how lit, 0 to 1: whatever the beats have looked at since it was turned to, fading in
 * once the globe has turned. */
export function litAt(beats: readonly Beat[], seconds: number): { story: string; glow: number } | undefined {
  let lit: { story: string; since: number } | undefined;
  for (const beat of beats) {
    if (beat.from > seconds) break;
    const story = beat.looks === "upstream" ? UPSTREAM.story : beat.looks === "island" ? ISLAND.story : undefined;
    if (story !== lit?.story) lit = story === undefined ? undefined : { story, since: beat.from };
  }
  return lit && { story: lit.story, glow: ease((seconds - lit.since - TURN) / 0.5) };
}
