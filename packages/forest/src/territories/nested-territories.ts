/**
 * Capability 3 · Story node render (the forest story): an opened capability's parts laid out as territories inside its own
 * (ADR-1339 D1, arc_0c4277f81731), a read-only picture of its code holding nothing of the plan (question_211620bd75de).
 *
 * - The capability's land, as the island drew it and cut to the coast, is traced as a coast of its own and laid out as an
 *   island is (link-layout.ts): its own fine cut, at The library's size, so a capability of round 13's least land still
 *   holds its parts; never under a part's least share of it.
 * - Where the island's roads cross the capability's border (a gate in, open road out) its lanes come ashore: each part
 *   a lane reaches grows from the border nearest that crossing, and its roads are routed from there (island-roads.ts).
 * - Laid out only when opened, and once for the same land, parts, roads and kept seeds, whoever asks. The island's own
 *   layout is never touched, so opening one moves nothing on it (ADR-1253 D2, ADR-1272 D1).
 * - Each part's seed is kept once laid out, on the island's own ground: a part added or dropped later is laid out with the
 *   others' kept seeds, so each part kept stays where it was.
 */
import { LIBRARY_LAND, ontoCoast, prepareIslandSteps, seedPoints, settleSteps, startSeeds, drawnIsland, type Link, type LinkDock, type Seeds } from "./link-layout.js";
import { finished, landArea, onLand, territoriesInSteps, territoryAt, type Coast, type Point, type TerritoryMap, type TerritoryShare } from "./territories.js";
import type { IslandRoads } from "./island-roads.js";
import { storageShelf, type ArrangementShelf } from "./kept-layout.js";

/** How many steps across its widest side a capability's land is traced at. */
const TRACE = 120;
/** A part's least share of its capability's land: one in twelve, against round 13's 5 of 246 for a capability's of its island. */
export const PART_SHARE = 1 / 12;

/** An opened capability laid out: its parts' map in its own coordinates, about `centre` on the island, and their seeds on the island's ground. */
export type NestedLayout = { readonly centre: Point; readonly map: TerritoryMap; readonly seeds: Seeds | undefined };

const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const shift = (p: Point, by: Point, sign = 1): Point => ({ x: p.x + sign * by.x, z: p.z + sign * by.z });

/**
 * The land of `map`'s territory `at` as a coast: its loops traced on a grid TRACE steps across, each point on the edge
 * between a grid point on its land and one off it, cut to `coast` (the island's) when given.
 */
export function regionOf(map: TerritoryMap, at: number, coast: Coast | undefined = map.coast): Coast {
  const known = traced.get(map)?.get(at);
  if (known !== undefined && known.coast === coast) return known.region;
  const region = trace(map, at, coast);
  traced.set(map, (traced.get(map) ?? new Map()).set(at, { coast, region }));
  return region;
}

/** Each map's territories' land as traced, so a capability opened again is laid out on the same coast. */
const traced = new WeakMap<TerritoryMap, Map<number, { coast: Coast | undefined; region: Coast }>>();

function trace(map: TerritoryMap, at: number, coast: Coast | undefined): Coast {
  const own = map.cells.filter((cell) => cell.territory === at);
  if (own.length === 0) return [];
  const corners = own.flatMap((cell) => cell.polygon);
  const [x0, x1] = [Math.min(...corners.map((p) => p.x)), Math.max(...corners.map((p) => p.x))];
  const [z0, z1] = [Math.min(...corners.map((p) => p.z)), Math.max(...corners.map((p) => p.z))];
  const step = Math.max(x1 - x0, z1 - z0) / TRACE;
  if (!(step > 0)) return [];
  const nx = Math.ceil((x1 - x0) / step) + 3, nz = Math.ceil((z1 - z0) / step) + 3;
  const point = (i: number, j: number): Point => ({ x: x0 + (i - 1) * step, z: z0 + (j - 1) * step });
  const territory = map.territories[at];
  const inside: boolean[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const p = point(i, j);
    inside.push(i > 0 && j > 0 && i < nx - 1 && j < nz - 1 && territoryAt(map, p.x, p.z) === territory && (coast === undefined || onLand(p, coast)));
  }
  const at2 = (i: number, j: number) => inside[j * nx + i]!;
  // Marching squares: each edge of the grid between a point on the land and one off it holds one point of the trace.
  const middle = (edge: string): Point => {
    const [kind, i, j] = edge.split(",") as [string, string, string];
    const p = point(Number(i), Number(j));
    return kind === "h" ? { x: p.x + step / 2, z: p.z } : { x: p.x, z: p.z + step / 2 };
  };
  const touching = new Map<string, string[]>();
  const join = (a: string, b: string) => { touching.set(a, [...touching.get(a) ?? [], b]); touching.set(b, [...touching.get(b) ?? [], a]); };
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const [a, b, c, d] = [at2(i, j), at2(i + 1, j), at2(i + 1, j + 1), at2(i, j + 1)];
    const bottom = `h,${i},${j}`, right = `v,${i + 1},${j}`, top = `h,${i},${j + 1}`, left = `v,${i},${j}`;
    const crossed = [a !== b ? bottom : "", b !== c ? right : "", c !== d ? top : "", d !== a ? left : ""].filter(Boolean);
    if (crossed.length === 2) join(crossed[0]!, crossed[1]!);
    else if (crossed.length === 4) {
      // Two corners across from each other on the land: each is cut off on its own.
      if (a) { join(bottom, left); join(right, top); } else { join(bottom, right); join(top, left); }
    }
  }
  const loops: Point[][] = [];
  const seen = new Set<string>();
  for (const start of [...touching.keys()].sort()) {
    if (seen.has(start)) continue;
    const loop: string[] = [start];
    seen.add(start);
    for (let at3 = start; ;) {
      const next = touching.get(at3)!.find((edge) => !seen.has(edge));
      if (next === undefined) break;
      seen.add(next); loop.push(next); at3 = next;
    }
    if (loop.length >= 3) loops.push(simplified(loop.map(middle), step * 0.6));
  }
  return loops.filter((loop) => loop.length >= 3);
}

/** A closed loop with every point within `tolerance` of the line its neighbours kept would draw left out (Douglas and Peucker's). */
function simplified(loop: readonly Point[], tolerance: number): Point[] {
  const keep = new Array<boolean>(loop.length).fill(false);
  const spread = (from: number, to: number) => {
    let worst = -1, most = tolerance;
    for (let k = from + 1; k < to; k++) { const d = toSegment(loop[k]!, loop[from]!, loop[to % loop.length]!); if (d > most) { most = d; worst = k; } }
    if (worst < 0) return;
    keep[worst] = true;
    spread(from, worst); spread(worst, to);
  };
  // Split at the point furthest from the first, so neither half is a loop.
  const far0 = loop.reduce((best, p, k) => (far(p, loop[0]!) > far(loop[best]!, loop[0]!) ? k : best), 0);
  keep[0] = keep[far0] = true;
  spread(0, far0); spread(far0, loop.length);
  return loop.filter((_, k) => keep[k]);
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

/** The middle of a coast's box. */
function centreOf(coast: Coast): Point {
  const points = coast.flat();
  const [x0, x1] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
  const [z0, z1] = [Math.min(...points.map((p) => p.z)), Math.max(...points.map((p) => p.z))];
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}

/** What each laid-out capability was laid out for, so the same ask is laid out once. */
const laidOut = new WeakMap<Coast, { key: string; layout: NestedLayout | undefined }>();

/**
 * The parts `shares` laid out on `region` (a capability's land, on the island's ground), linked by `links`, their lanes
 * coming ashore at `docks` (on the island's ground), grown from the `kept` seeds where given; undefined with no land.
 */
export function nestedLayout(region: Coast, shares: readonly TerritoryShare[], links: readonly Link[], docks: readonly LinkDock[], kept?: Seeds): NestedLayout | undefined {
  return finished(nestedLayoutSteps(region, shares, links, docks, kept));
}

/** {@link nestedLayout}, a step at a time (3.87): the cut a few cells to a step, then each try at growing the parts. */
export function* nestedLayoutSteps(region: Coast, shares: readonly TerritoryShare[], links: readonly Link[], docks: readonly LinkDock[], kept?: Seeds): Generator<void, NestedLayout | undefined, void> {
  if (region.length === 0 || !(landArea(region) > 0)) return undefined;
  const key = JSON.stringify([shares, links, docks, kept ?? null]), known = laidOut.get(region);
  if (known?.key === key) return known.layout;
  const centre = centreOf(region);
  const local = region.map((ring) => ring.map((p) => shift(p, centre, -1)));
  const prepared = yield* prepareIslandSteps(shares, local, links, []);
  let layout: NestedLayout;
  if (prepared === undefined) layout = { centre, map: yield* territoriesInSteps(shares, local), seeds: undefined };
  else {
    // A part's least land is its share of its capability's, not round 13's of an island's.
    const owned = prepared.main.length, least = Math.max(1, Math.min(Math.floor(owned / prepared.ids.length), Math.round(PART_SHARE * owned)));
    const counts = raised([...prepared.counts], least);
    // Each part a lane reaches grows from the border nearest the crossing carrying most of its lanes.
    const ashore = docks.map((dock) => ({ local: ontoCoast(scaled(shift(dock.local, centre, -1), 1 / prepared.scale), prepared.coast.map((ring) => ring.map((p) => scaled(p, 1 / prepared.scale)))), links: dock.links }));
    const index = new Map(prepared.ids.map((id, t) => [id, t]));
    const dockOf = new Map<number, number>(), carried = new Map<number, number>();
    ashore.forEach((dock, k) => {
      const per = new Map<number, number>();
      for (const link of dock.links) for (const end of link.split("->")) { const t = index.get(end); if (t !== undefined) per.set(t, (per.get(t) ?? 0) + 1); }
      for (const [t, n] of per) if (n > (carried.get(t) ?? 0)) { dockOf.set(t, k); carried.set(t, n); }
    });
    const island = { ...prepared, counts, least, dockOf, docks: ashore };
    const keptHere = kept === undefined ? undefined : Object.fromEntries(Object.entries(kept).map(([id, p]) => [id, scaled(shift(p, centre, -1), 1 / prepared.scale)]));
    const seeds = startSeeds(island, keptHere);
    const settled = seeds === undefined ? undefined : yield* settleSteps(island, seeds);
    if (settled === undefined) layout = { centre, map: yield* territoriesInSteps(shares, local), seeds: undefined };
    else {
      const points = seedPoints(island, settled.seeds);
      layout = { centre, map: drawnIsland(island, settled.owners), seeds: Object.fromEntries(Object.entries(points).map(([id, p]) => [id, shift(scaled(p, prepared.scale), centre)])) };
    }
  }
  laidOut.set(region, { key, layout });
  return layout;
}

const scaled = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });

/** `counts` with every one raised to `least`, a cell at a time from the largest. */
function raised(counts: number[], least: number): number[] {
  for (let at = 0; at < counts.length; at++) while (counts[at]! < least) {
    const largest = counts.reduce((best, n, i) => (n > counts[best]! ? i : best), 0);
    if (counts[largest]! <= least) return counts;
    counts[largest]! -= 1; counts[at]! += 1;
  }
  return counts;
}

/** Where one of the island's roads crosses the opened capability's border, and the lanes it carries to and from its parts. */
export type PartCrossing = LinkDock & {
  /** The island's gate there, by its place in the island's roads' gates, if the crossing is one. */
  readonly gate?: number;
};

/**
 * Where the island's `roads` cross capability `capability`'s border on `map`, each with the lanes its links carry to and from
 * the capability's parts (`lanes`, by a capability link's `from->to`); `docks` are the island's, whose lanes a sea road
 * carries. A link carrying no lane (one the code does not show) brings none. Each crossing's lane counts are the part
 * roads it rolls up.
 */
export function partCrossings(map: TerritoryMap, roads: Pick<IslandRoads, "gates" | "passes" | "settlements">, capability: string, lanes: Readonly<Record<string, readonly string[]>>, docks: readonly LinkDock[] = []): PartCrossing[] {
  const territory = map.territories.find((t) => t.capability === capability);
  if (territory === undefined) return [];
  const step = Math.sqrt(Math.PI * map.radius ** 2 / Math.max(1, map.cells.length)) * 0.15;
  const isHere = (p: Point) => territoryAt(map, p.x, p.z) === territory;
  // A crossing on the capability's border: its land on one side and not the other.
  const onBorder = (at: Point, along: Point) => {
    const across = { x: -along.z, z: along.x };
    return isHere(shift(at, scaled(across, step))) !== isHere(shift(at, scaled(across, -step)));
  };
  const crossings = [
    ...roads.gates.map((gate, at) => ({ at: gate.at, keys: gate.links, gate: at as number | undefined, border: onBorder(gate.at, gate.along) })),
    ...roads.passes.map((pass) => ({ at: pass.at, keys: pass.links, gate: undefined, border: onBorder(pass.at, pass.along) })),
  ].filter((crossing) => crossing.border);
  const town = roads.settlements.get(capability)?.at;
  // A road's link, and the capability links it stands for: a sea road's are its dock's.
  const standsFor = (key: string): { inward: boolean; outer: string; links: string[] } | undefined => {
    const arrival = /^arrive:(\d+)->(.+)$/.exec(key), leaving = /^(.+)->leave:(\d+)$/.exec(key);
    if (arrival !== null) return arrival[2] !== capability ? undefined : { inward: true, outer: `arrive:${arrival[1]}`, links: (docks[Number(arrival[1])]?.links ?? []).filter((l) => l.endsWith(`->${capability}`)) };
    if (leaving !== null) return leaving[1] !== capability ? undefined : { inward: false, outer: `leave:${leaving[2]}`, links: (docks[Number(leaving[2])]?.links ?? []).filter((l) => l.startsWith(`${capability}->`)) };
    const [from, to] = key.split("->") as [string, string];
    return to === capability ? { inward: true, outer: from, links: [key] } : from === capability ? { inward: false, outer: to, links: [key] } : undefined;
  };
  const byPlace = new Map<string, { at: Point; gate?: number; links: Set<string> }>();
  const keys = [...new Set(crossings.flatMap((crossing) => crossing.keys))].sort();
  for (const key of keys) {
    const road = standsFor(key);
    if (road === undefined) continue;
    const parts = [...new Set(road.links.flatMap((link) => lanes[link] ?? []))].sort();
    if (parts.length === 0) continue;
    const mine = crossings.filter((crossing) => crossing.keys.includes(key));
    const nearest = town === undefined ? mine[0]! : mine.reduce((best, crossing) => (far(crossing.at, town) < far(best.at, town) ? crossing : best));
    const place = `${nearest.at.x},${nearest.at.z}`;
    const held = byPlace.get(place) ?? { at: nearest.at, ...(nearest.gate === undefined ? {} : { gate: nearest.gate }), links: new Set<string>() };
    for (const part of parts) held.links.add(road.inward ? `${road.outer}->${part}` : `${part}->${road.outer}`);
    byPlace.set(place, held);
  }
  return [...byPlace.values()].map(({ at, gate, links }) => ({ local: at, links: [...links].sort(), ...(gate === undefined ? {} : { gate }) }));
}

/** Each opened capability's parts' seeds kept, on the island's ground, by story and capability. */
const keptParts = new Map<string, Seeds | undefined>();
let partShelf: ArrangementShelf | undefined | null = null;
const partKey = (story: string, capability: string) => `parts:${story}:${capability}`;

/** Opened capabilities' seeds are kept on `next` from now on (a test's own; undefined for none), forgetting those read so far. */
export function shelvePartsOn(next: ArrangementShelf | undefined): void {
  partShelf = next; keptParts.clear();
}

/** The seeds kept for `capability`'s parts on `story`'s island, from this run or the page's storage. */
export function keptPartSeeds(story: string, capability: string): Seeds | undefined {
  const key = partKey(story, capability);
  if (!keptParts.has(key)) {
    if (partShelf === null) partShelf = storageShelf();
    keptParts.set(key, partShelf?.read(key)?.seeds);
  }
  return keptParts.get(key);
}

/** Keeps `seeds` for `capability`'s parts on `story`'s island, merged over those kept, so a part dropped and back keeps its place. */
export function keepPartSeeds(story: string, capability: string, seeds: Seeds): void {
  const key = partKey(story, capability), merged = { ...keptPartSeeds(story, capability), ...seeds };
  keptParts.set(key, merged);
  partShelf?.write(key, { key, seeds: merged });
}
