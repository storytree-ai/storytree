/**
 * Capability 3 · Story node render: a lit link's way inland (ADR-0991 D4). From its dock on the coast the way follows
 * only lines already drawn, the borders between the island's territories and the coast between two borders, by the
 * shortest such way, and enters its capability's territory along that territory's own border. It never crosses land:
 * ADR-0951 stopped lanes at the coast because the free inland routes of the time "split up randomly into the island".
 */
import { islandCoast } from "@storytree/forest-world/geometry";
import type { Island } from "@storytree/forest-world/scene";
import { islandTerritories, type Point, type TerritoryMap } from "../territories/territories.js";
import { insideOf } from "./territory-land.js";

const key = (p: Point) => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`;
const far = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z);
/** A stretch of coast costs this many times its length, so a way goes inland along the borders wherever they lead,
 * and follows the coast only between two borders that do not meet inland. */
const COAST_COST = 3;

/** A stretch of drawn line: its far end, its cost, and the two territories it parts (none along the coast). */
type Stretch = { to: number; cost: number; parts?: readonly [number, number] };
/** An island's drawn lines as a graph: each corner once, the coast loops with where round them each corner lies. */
type Lines = { points: Point[]; out: Stretch[][]; loops: { loop: readonly Point[]; stops: { at: number; along: number }[] }[] };

const drawn = new WeakMap<TerritoryMap, Lines>();

/** The borders as drawn, cut to the coast, and the coast cut at every border's end. */
function linesOf(map: TerritoryMap): Lines {
  const known = drawn.get(map);
  if (known !== undefined) return known;
  const coast = map.coast ?? [Array.from({ length: 64 }, (_, i): Point => ({ x: map.radius * Math.cos(i * Math.PI / 32), z: map.radius * Math.sin(i * Math.PI / 32) }))];
  const lines: Lines = { points: [], out: [], loops: [] };
  const index = new Map<string, number>();
  const corner = (p: Point) => {
    const k = key(p);
    let at = index.get(k);
    if (at === undefined) { index.set(k, at = lines.points.length); lines.points.push(p); lines.out.push([]); }
    return at;
  };
  const ends: number[] = [];
  for (const border of map.borders) {
    const parts = border.between.map((cell) => map.cells[cell]!.territory) as [number, number];
    for (const piece of map.coast === undefined ? [border] : insideOf(border.from, border.to, coast)) {
      const [a, b] = [corner(piece.from), corner(piece.to)];
      if (a === b) continue;
      const cost = far(piece.from, piece.to);
      lines.out[a]!.push({ to: b, cost, parts }); lines.out[b]!.push({ to: a, cost, parts });
      ends.push(a, b);
    }
  }
  for (const loop of coast) {
    const stops: { at: number; along: number }[] = [];
    let walked = 0;
    loop.forEach((a, i) => { stops.push({ at: corner(a), along: walked }); walked += far(a, loop[(i + 1) % loop.length]!); });
    for (const end of new Set(ends)) {
      const place = toLoop(lines.points[end]!, loop);
      if (place.distance < 1e-6) stops.push({ at: end, along: place.along });
    }
    stops.sort((a, b) => a.along - b.along);
    stops.forEach(({ at }, i) => {
      const next = stops[(i + 1) % stops.length]!.at;
      if (next === at) return;
      const cost = far(lines.points[at]!, lines.points[next]!) * COAST_COST;
      lines.out[at]!.push({ to: next, cost }); lines.out[next]!.push({ to: at, cost });
    });
    lines.loops.push({ loop, stops });
  }
  drawn.set(map, lines);
  return lines;
}

/**
 * The way from `dock` to `capability`'s territory on `map`, in the island's own coordinates, starting on the dock:
 * the dock alone where the territory is already its own, and undefined where the island has no such territory or no
 * drawn line reaches it from the dock.
 */
export function borderRoute(map: TerritoryMap, capability: string, dock: Point): Point[] | undefined {
  const target = map.territories.findIndex((territory) => territory.capability === capability);
  if (target < 0 || map.cells.length === 0) return undefined;
  const nearest = map.cells.reduce((best, cell) => (far(cell.site, dock) < far(best.site, dock) ? cell : best));
  if (nearest.territory === target) return [dock];
  const lines = linesOf(map);
  // The dock joins the coast between the two corners either side of it.
  const { loop, stops } = lines.loops.reduce((best, one) => (toLoop(dock, one.loop).distance < toLoop(dock, best.loop).distance ? one : best));
  const along = toLoop(dock, loop).along;
  const after = stops.findIndex((stop) => stop.along > along);
  const sides = [stops[after < 0 ? 0 : after]!, stops[((after < 0 ? stops.length : after) - 1 + stops.length) % stops.length]!];

  // The cheapest way whose last stretch runs along a border of the capability's territory: state `2n + 1` is corner n
  // reached that way, which ends the search; state `2n` is corner n reached any other way.
  const cost = new Map<number, number>(), back = new Map<number, number>(), heap = new Heap();
  const reach = (state: number, c: number, from: number) => {
    if (c < (cost.get(state) ?? Infinity)) { cost.set(state, c); back.set(state, from); heap.push(state, c); }
  };
  for (const { at } of sides) reach(2 * at, far(dock, lines.points[at]!) * COAST_COST, -1);
  for (let state = heap.pop(); state !== undefined; state = heap.pop()) {
    if (heap.popped > cost.get(state)!) continue;
    if (state & 1) {
      const way: Point[] = [];
      for (let step = state; step !== -1; step = back.get(step)!) way.unshift(lines.points[step >> 1]!);
      return far(way[0]!, dock) < 1e-9 ? [dock, ...way.slice(1)] : [dock, ...way];
    }
    for (const stretch of lines.out[state >> 1]!) {
      reach(2 * stretch.to, heap.popped + stretch.cost, state);
      if (stretch.parts?.includes(target)) reach(2 * stretch.to + 1, heap.popped + stretch.cost, state);
    }
  }
  return undefined;
}

/** The globe's ways inland (its `laneWays`): from a dock on a story's island to a capability's territory, on the
 * territories as the island draws them, each island cut once and each way found once. */
export function laneWays(islands: readonly Island[]): (story: string, capability: string, dock: Point) => Point[] | undefined {
  const maps = new Map<string, TerritoryMap | undefined>(), found = new Map<string, Point[] | undefined>();
  return (story, capability, dock) => {
    if (!maps.has(story)) {
      const island = islands.find((one) => one.story === story);
      maps.set(story, island?.land === undefined ? undefined : islandTerritories(island.land.territories, islandCoast(island)));
    }
    const map = maps.get(story), asked = `${story}|${capability}|${key(dock)}`;
    if (map === undefined) return undefined;
    if (!found.has(asked)) found.set(asked, borderRoute(map, capability, dock));
    return found.get(asked);
  };
}

/** Where `p` lies nearest on the closed loop: how far from it, and how far round the loop from its first corner. */
function toLoop(p: Point, loop: readonly Point[]): { distance: number; along: number } {
  let best = { distance: Infinity, along: 0 }, walked = 0;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length]!, length = far(a, b);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length ** 2));
    const distance = Math.hypot(p.x - a.x - t * (b.x - a.x), p.z - a.z - t * (b.z - a.z));
    if (distance < best.distance) best = { distance, along: walked + t * length };
    walked += length;
  });
  return best;
}

/** A binary min-heap of states by cost; `popped` is the cost the state last popped was pushed with. */
class Heap {
  private items: { state: number; cost: number }[] = [];
  popped = 0;
  push(state: number, cost: number): void {
    const items = this.items;
    items.push({ state, cost });
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.cost <= items[i]!.cost) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }
  pop(): number | undefined {
    const items = this.items, top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let least = i;
        if (l < items.length && items[l]!.cost < items[least]!.cost) least = l;
        if (r < items.length && items[r]!.cost < items[least]!.cost) least = r;
        if (least === i) break;
        [items[least], items[i]] = [items[i]!, items[least]!];
        i = least;
      }
    }
    this.popped = top.cost;
    return top.state;
  }
}
