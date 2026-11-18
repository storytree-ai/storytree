// Capability 3 · Story node render
import { drawnIsland, grownFrom, prepareIsland, seedKind, seedPoints, settle, sharedEdge, startSeeds, type PreparedIsland, type Seeds } from "./link-layout.js";
import { roadMeasures, type RoadMeasures } from "./island-roads.js";
import { capabilityPlates } from "../view/nameplates.js";
import { insideOf } from "./territories.js";
import type { SearchAsk } from "./kept-layout.js";

const STEPS = 300, HEAT = 20, COOL = 0.03, SEED = 43;

export const TUNNEL = 100, BORDER = 0.2;
const PLACE = 5;

export function networkScore(island: PreparedIsland, owners: readonly number[], m: RoadMeasures): number | undefined {
  if (m.unrouted > 0) return undefined;
  const offCoast = [...island.dockOf.keys()].filter((t) => !owners.some((o, c) => o === t && island.frontier[c])).length;
  return TUNNEL * m.tunnels + 10 * m.overThird + 3 * m.overThirdBorders + 0.05 * m.roadDrawn + BORDER * borderLength(island, owners) - 4 * m.neighbours + 500 * offCoast;
}

const edgesOf = new WeakMap<PreparedIsland, readonly (readonly [number, number, number])[]>();

export function borderLength(island: PreparedIsland, owners: readonly number[]): number {
  let edges = edgesOf.get(island);
  if (edges === undefined) {
    const { cells, coast = [] } = island.fine, found: (readonly [number, number, number])[] = [];
    cells.forEach((cell, at) => {
      for (const n of cell.touching) {
        const edge = n > at ? sharedEdge(cell, cells[n]!) : undefined;
        if (edge) found.push([at, n, insideOf(edge[0], edge[1], coast).reduce((s, p) => s + Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z), 0)]);
      }
    });
    edgesOf.set(island, edges = found);
  }
  let length = 0;
  for (const [a, b, l] of edges) if (owners[a] !== owners[b] && owners[a]! >= 0 && owners[b]! >= 0) length += l;
  return length;
}

export function searchTerritories(ask: SearchAsk): { seeds: Seeds; score: number; start: number } | undefined {
  const { shares, coast, links, docks, kept, fixed = [], steps = STEPS } = ask;
  const island = prepareIsland(shares, coast, links, docks);
  if (island === undefined) return undefined;
  const held = new Set(fixed), placed = landBefore(ask, island, held);
  const moved = (owners: readonly number[]) => placed === undefined ? 0 : PLACE * displacement(island, owners, placed);
  const evaluate = (seeds: readonly number[], owners = grownFrom(island, seeds)) => {
    if (owners === undefined) return undefined;
    const map = drawnIsland(island, owners), s = networkScore(island, owners, roadMeasures(map, links, docks, capabilityPlates(map)));
    return s === undefined ? undefined : { seeds, s: s + moved(owners) };
  };
  const first = startSeeds(island, kept), settled = first && settle(island, first);
  if (settled === undefined) return undefined;
  const grown = placed === undefined ? settled : leastMoved(island, settled, held, placed);
  let state = SEED;
  const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  const mutate = mutation(island, random, island.ids.map((id) => !held.has(id)));
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

function mutation(island: PreparedIsland, random: () => number, free: readonly boolean[]): (seeds: readonly number[]) => number[] {
  const kinds = island.ids.map((_, t) => seedKind(island, t)), coastal = (t: number) => island.dockOf.has(t);
  const cells = island.fine.cells, movable = island.ids.map((_, t) => t).filter((t) => free[t]), n = movable.length;
  return (seeds) => {
    const out = [...seeds];
    if (n === 0) return out;
    if (random() < 0.3 && n > 1) {
      const a = movable[Math.floor(random() * n)]!, pool = movable.filter((t) => t !== a && coastal(t) === coastal(a));
      if (pool.length) { const b = pool[Math.floor(random() * pool.length)]!; out[a] = seeds[b]!; out[b] = seeds[a]!; }
    } else {
      const t = movable[Math.floor(random() * n)]!, kind = kinds[t]!, taken = new Set(seeds);
      const near = (random() < 0.75 ? cells[seeds[t]!]!.neighbours.filter((c) => kind[c]) : island.main.filter((c) => kind[c])).filter((c) => !taken.has(c));
      if (near.length) out[t] = near[Math.floor(random() * near.length)]!;
    }
    return out;
  };
}

function landBefore(ask: SearchAsk, island: PreparedIsland, held: ReadonlySet<string>): (string | undefined)[] | undefined {
  if (held.size === 0 || island.ids.every((id) => held.has(id))) return undefined;
  const before = prepareIsland(ask.shares.filter((s) => held.has(s.capability ?? "")), ask.coast, ask.links, ask.docks);
  const seeds = before && startSeeds(before, ask.kept), grown = before && seeds && settle(before, seeds);
  if (grown === undefined) return undefined;
  const cells = before!.fine.cells;
  return island.fine.cells.map(({ site }) => {
    let at = 0, d = Infinity;
    cells.forEach((cell, c) => { const dd = Math.hypot(cell.site.x - site.x, cell.site.z - site.z); if (dd < d) { d = dd; at = c; } });
    const o = grown.owners[at]!;
    return o >= 0 ? before!.ids[o] : undefined;
  });
}

function displacement(island: PreparedIsland, owners: readonly number[], land: readonly (string | undefined)[]): number {
  let taken = 0;
  owners.forEach((o, c) => { if (land[c] !== undefined && (o < 0 || island.ids[o] !== land[c])) taken++; });
  return taken;
}

function leastMoved(island: PreparedIsland, start: { owners: number[]; seeds: readonly number[] }, held: ReadonlySet<string>, placed: readonly (string | undefined)[]): { owners: number[]; seeds: readonly number[] } {
  let best = { ...start, moved: displacement(island, start.owners, placed) };
  island.ids.forEach((id, t) => {
    if (held.has(id)) return;
    const kind = seedKind(island, t), taken = new Set(best.seeds);
    for (const c of island.main) {
      if (!kind[c] || taken.has(c)) continue;
      const seeds = [...best.seeds];
      seeds[t] = c;
      const owners = grownFrom(island, seeds), moved = owners === undefined ? Infinity : displacement(island, owners, placed);
      if (moved < best.moved) best = { owners: owners!, seeds, moved };
    }
  });
  return best;
}
