/**
 * Capability 3 · Story node render (the forest story): each island's territories arranged by the capability
 * tree mock's network-scored search (3.80, ADR-1236 D1, rollout 2 step 2b), ported from
 * docs/design/capability-tree-3d/q-all-islands/tools/layout.ts's search, score and mutate.
 *
 * - Simulated annealing over the territories' seeds, seeded so it repeats: each step swaps two seeds of a kind (two
 *   interfaces, or two internals) or moves one, mostly to a neighbouring cell of its kind, sometimes anywhere of it.
 * - Each arrangement that grows is scored on the shared road network routed over it (island-roads.ts): 100 for each tunnel
 *   it draws, 10 for each inside link through a third territory and 3 for each border it crosses, 0.05 a unit of road
 *   drawn, 0.2 a unit of border between two territories, less 4 for each inside link between neighbours, and 500 for each
 *   interface off the coast. One a link finds no road over is refused. The mock's 8 for each crowded entrance is left
 *   out: 0.3's network does not report them.
 * - A tunnel is a last resort (Mick, 2026-11-07, question_ad09fc6c81bd: "it should be a last resort"): at 100 it outweighs
 *   2,000 units of road, more than any island's way round. It is counted as drawn, not by the links over a third territory:
 *   a road carrying a link that calls the land it crosses is open road there, so The library's start had 96 links over a
 *   third territory and 3 tunnels. The border term keeps territories compact: a territory reaching an arm between two
 *   others draws a border along each side of it, so it grows outward instead.
 * - It starts from the arrangement the page draws (link-layout.ts's start, or the kept seeds) and answers the best it
 *   found, never worse than that start. A step routes the whole network (0.3 to 0.7 s an island), so it runs off the page.
 */
import { drawnIsland, grownFrom, prepareIsland, seedKind, seedPoints, settle, sharedEdge, startSeeds, type PreparedIsland, type Seeds } from "./link-layout.js";
import { roadMeasures, type RoadMeasures } from "./island-roads.js";
import { capabilityPlates } from "../view/nameplates.js";
import { insideOf } from "../view/territory-land.js";
import type { SearchAsk } from "./kept-layout.js";

/** The mock's steps, its starting temperature and how far it cools, and its random seed. */
const STEPS = 300, HEAT = 20, COOL = 0.03, SEED = 43;

/** What a tunnel costs an arrangement, and a unit of border between two territories. */
export const TUNNEL = 100, BORDER = 0.2;

/** The score of an arrangement's network, lower better; undefined when a link finds no road. */
export function networkScore(island: PreparedIsland, owners: readonly number[], m: RoadMeasures): number | undefined {
  if (m.unrouted > 0) return undefined;
  const offCoast = [...island.dockOf.keys()].filter((t) => !owners.some((o, c) => o === t && island.frontier[c])).length;
  return TUNNEL * m.tunnels + 10 * m.overThird + 3 * m.overThirdBorders + 0.05 * m.roadDrawn + BORDER * borderLength(island, owners) - 4 * m.neighbours + 500 * offCoast;
}

/** Each pair of neighbouring cells of an island's fine cut, with the length of the edge they share on the land. */
const edgesOf = new WeakMap<PreparedIsland, readonly (readonly [number, number, number])[]>();

/** The length of the borders between two territories of `owners` on the land, in The library's units: open land and the
 * coast are no border. A territory that reaches an arm between two others draws more of it than one grown outward. */
export function borderLength(island: PreparedIsland, owners: readonly number[]): number {
  let edges = edgesOf.get(island);
  if (edges === undefined) {
    const { cells, coast = [] } = island.fine, found: (readonly [number, number, number])[] = [];
    cells.forEach((cell, at) => {
      for (const n of cell.neighbours) {
        const edge = n > at ? sharedEdge(cell, cells[n]!) : undefined;
        // A cell at the coast reaches past it: only the edge's stretch on the land is border.
        if (edge) found.push([at, n, insideOf(edge[0], edge[1], coast).reduce((s, p) => s + Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z), 0)]);
      }
    });
    edgesOf.set(island, edges = found);
  }
  let length = 0;
  for (const [a, b, l] of edges) if (owners[a] !== owners[b] && owners[a]! >= 0 && owners[b]! >= 0) length += l;
  return length;
}

/** The best seeds the search finds for the island `ask` describes, its score and its start's, or undefined when no
 * arrangement of it grows and routes. */
export function searchTerritories(ask: SearchAsk): { seeds: Seeds; score: number; start: number } | undefined {
  const { shares, coast, links, docks, kept, steps = STEPS } = ask;
  const island = prepareIsland(shares, coast, links, docks);
  if (island === undefined) return undefined;
  const evaluate = (seeds: readonly number[], owners = grownFrom(island, seeds)) => {
    if (owners === undefined) return undefined;
    const map = drawnIsland(island, owners), s = networkScore(island, owners, roadMeasures(map, links, docks, capabilityPlates(map)));
    return s === undefined ? undefined : { seeds, s };
  };
  // The start is what the page draws: the seeds the seed walk grew it from.
  const first = startSeeds(island, kept), grown = first && settle(island, first);
  if (grown === undefined) return undefined;
  let state = SEED;
  const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  const mutate = mutation(island, random);
  let here = evaluate(grown.seeds, grown.owners);
  for (let tries = 0; here === undefined && tries < steps; tries++) here = evaluate(mutate(grown.seeds));
  if (here === undefined) return undefined;
  const start = here.s;
  let best = here;
  for (let i = 0; i < steps; i++) {
    const temp = HEAT * Math.pow(COOL, i / steps), next = evaluate(mutate(here.seeds));
    if (next === undefined) continue;
    if (next.s < here.s || random() < Math.exp((here.s - next.s) / temp)) here = next;
    if (here.s < best.s) best = here;
  }
  return { seeds: seedPoints(island, best.seeds), score: best.s, start };
}

/** The mock's change of an arrangement: swap two seeds of a kind (30%), else move one to a free cell of its kind, a
 * neighbour of it 75% of the time. */
function mutation(island: PreparedIsland, random: () => number): (seeds: readonly number[]) => number[] {
  const kinds = island.ids.map((_, t) => seedKind(island, t)), coastal = (t: number) => island.dockOf.has(t);
  const cells = island.fine.cells;
  return (seeds) => {
    const out = [...seeds], n = seeds.length;
    if (random() < 0.3 && n > 1) {
      const a = Math.floor(random() * n), pool = seeds.map((_, t) => t).filter((t) => t !== a && coastal(t) === coastal(a));
      if (pool.length) { const b = pool[Math.floor(random() * pool.length)]!; out[a] = seeds[b]!; out[b] = seeds[a]!; }
    } else {
      const t = Math.floor(random() * n), kind = kinds[t]!, taken = new Set(seeds);
      const near = (random() < 0.75 ? cells[seeds[t]!]!.neighbours.filter((c) => kind[c]) : island.main.filter((c) => kind[c])).filter((c) => !taken.has(c));
      if (near.length) out[t] = near[Math.floor(random() * near.length)]!;
    }
    return out;
  };
}
