/**
 * Capability 3 · Story node render (the forest story): each island's relief (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2 step 3b),
 * ported from the capability tree mock's round 11 relief (docs/design/capability-tree-3d/q-all-islands/tools/overlay.ts,
 * `RELIEF`): every territory a plateau one height above the open land, a wall where a plateau stands over the open land
 * or the coast, a bevel rim inside each border broken at every gate, and a ramp only where a road climbs from the open
 * land onto a plateau. Sizes are The library's, given back at the island's own, as the roads' are.
 */
import { LIBRARY_LAND } from "./link-layout.js";
import type { IslandRoads, RoadGate } from "./island-roads.js";
import { landArea, onLand, type Point, type TerritoryMap } from "./territories.js";
import { insideOf, segmentInConvex, toSegment } from "../view/territory-land.js";

/** Round 11's relief, in The library's ground units: the plateau's height, its ramps, its rims and its standing posts. */
export const RELIEF = {
  height: 1.3,
  ramp: { width: 3.4, depth: 3.2 },
  rim: { width: 0.9 },
  post: { side: 1.2, entrance: 1.4, height: 1.0, entranceHeight: 1.2 },
} as const;
/** Toward the light, on the ground: from the page's upper left at rest, as the mock lights it. */
export const LIGHT: Point = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

/** A ramp: at a gate onto the open land, `along` the border, climbing from `out` (toward the open land) to the plateau. */
export type Ramp = { readonly at: Point; readonly along: Point; readonly out: Point; readonly territory: number; readonly gate: RoadGate };
/** A wall: an edge where a territory's plateau stands over the open land or the coast, `out` its face's direction. */
export type Wall = { readonly from: Point; readonly to: Point; readonly out: Point; readonly territory: number; readonly onto: "open" | "coast" };
/** A rim: a stretch of border on a territory's side, `into` the territory. */
export type Rim = { readonly from: Point; readonly to: Point; readonly into: Point; readonly territory: number };
export type IslandRelief = {
  /** The island's scale against The library's; the plateau's height above the open land, and the ramps', rims' and posts' sizes, at it. */
  readonly scale: number; readonly height: number; readonly rampWidth: number; readonly rampDepth: number; readonly rimWidth: number;
  readonly post: { readonly side: number; readonly entrance: number; readonly height: number; readonly entranceHeight: number };
  readonly ramps: readonly Ramp[]; readonly walls: readonly Wall[]; readonly rims: readonly Rim[];
  /** The territory under a point (-1 on open land), undefined off the coast. */
  territoryAt(p: Point): number | undefined;
  /** How far a point stands above the open land: a plateau's height, part way up a ramp, or none. */
  raise(p: Point): number;
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
const unit = (a: Point): Point => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, z: a.z / l }; };
const perp = (a: Point): Point => ({ x: -a.z, z: a.x });
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/** The relief of `map` (an island as laid out by its links), its ramps at the open gates of `roads`. */
export function islandRelief(map: TerritoryMap, roads: IslandRoads): IslandRelief {
  const coast = map.coast;
  const S = coast === undefined ? 1 : Math.sqrt(landArea(coast) / LIBRARY_LAND) || 1;
  const H = RELIEF.height * S, rampWidth = RELIEF.ramp.width * S, rampDepth = RELIEF.ramp.depth * S;
  const territoryAt = (p: Point): number | undefined => {
    if (coast !== undefined ? !onLand(p, coast) : Math.hypot(p.x, p.z) > map.radius) return undefined;
    let best = -1, d = Infinity;
    for (const cell of map.cells) { const dd = (cell.site.x - p.x) ** 2 + (cell.site.z - p.z) ** 2; if (dd < d) { d = dd; best = cell.territory; } }
    return best;
  };
  const step = 0.8 * S;
  const ramps: Ramp[] = roads.gates.flatMap((gate) => {
    const n = perp(gate.along), [a, b] = [territoryAt(at(gate.at, n, step)), territoryAt(at(gate.at, n, -step))];
    if (a === -1 && b !== undefined && b >= 0) return [{ at: gate.at, along: gate.along, out: n, territory: b, gate }];
    if (b === -1 && a !== undefined && a >= 0) return [{ at: gate.at, along: gate.along, out: { x: -n.x, z: -n.z }, territory: a, gate }];
    return [];
  });
  const onRamp = (p: Point): number | undefined => {
    for (const r of ramps) {
      const d = sub(p, r.at), u = dot(d, r.along), w = dot(d, r.out);
      if (Math.abs(u) <= rampWidth / 2 && w >= -0.05 * S && w <= rampDepth) return 1 - Math.max(0, w) / rampDepth;
    }
    return undefined;
  };
  const raise = (p: Point) => { const t = territoryAt(p); return t === undefined ? 0 : t >= 0 ? H : (onRamp(p) ?? 0) * H; };

  // The borders on the land, each with the territory on either side.
  const borders = map.borders.flatMap((b) => {
    const pair = [map.cells[b.between[0]]!.territory, map.cells[b.between[1]]!.territory] as const;
    return (coast === undefined ? [{ from: b.from, to: b.to }] : insideOf(b.from, b.to, coast)).map((s) => ({ ...s, pair }));
  });
  const sideOf = (from: Point, to: Point, toward: number) => {
    const n = unit(perp(sub(to, from)));
    return territoryAt(at(middle(from, to), n, 0.3 * S)) === toward ? n : { x: -n.x, z: -n.z };
  };
  const rampHoles = ramps.map((r) => ({ at: r.at, half: rampWidth / 2 }));
  const walls: Wall[] = [];
  for (const b of borders) {
    // A border between a territory and the open land: one side -1, the other a territory.
    const t = Math.max(...b.pair);
    if (Math.min(...b.pair) !== -1 || t < 0) continue;
    const out = sideOf(b.from, b.to, -1);
    for (const s of cut(b.from, b.to, rampHoles, 0.6 * S)) walls.push({ ...s, out, territory: t, onto: "open" });
  }
  // The coast where a territory's plateau meets it: each coast edge, cut by the cells it runs along.
  for (const ring of coast ?? []) ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!, out = unit(perp(sub(b, a))), mid = middle(a, b);
    const face = coast !== undefined && onLand(at(mid, out, 0.05 * S), coast) ? { x: -out.x, z: -out.z } : out;
    for (const cell of map.cells) {
      if (cell.territory < 0) continue;
      for (const s of segmentInConvex(a, b, cell.polygon)) walls.push({ ...s, out: face, territory: cell.territory, onto: "coast" });
    }
  });
  const post = { side: RELIEF.post.side * S, entrance: RELIEF.post.entrance * S, height: RELIEF.post.height * S, entranceHeight: RELIEF.post.entranceHeight * S };
  const gateHoles = roads.gates.map((g) => ({ at: g.at, half: g.opening / 2 + (g.entrance ? post.entrance : post.side) + 0.2 * S }));
  const rims: Rim[] = borders.flatMap((b) => b.pair.filter((t) => t >= 0).flatMap((t) => {
    const into = sideOf(b.from, b.to, t);
    return cut(b.from, b.to, gateHoles, 0.6 * S).map((s) => ({ ...s, into, territory: t }));
  }));
  return { scale: S, height: H, rampWidth, rampDepth, rimWidth: RELIEF.rim.width * S, post, ramps, walls, rims, territoryAt, raise };
}

/** The stretches of the segment from `a` to `b` left once `holes` (each a centre within `near` of it and a half-width along it) are cut. */
function cut(a: Point, b: Point, holes: readonly { at: Point; half: number }[], near: number): { from: Point; to: Point }[] {
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  if (l < 1e-9) return [];
  const u = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  const spans = holes.filter((h) => toSegment(h.at, a, b) < near).map((h) => { const t = dot(sub(h.at, a), u) / l; return [t - h.half / l, t + h.half / l] as const; }).sort((x, y) => x[0] - y[0]);
  const point = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const kept: { from: Point; to: Point }[] = [];
  let from = 0;
  for (const [h0, h1] of [...spans, [1, 1] as const]) {
    const to = Math.max(from, Math.min(1, h0));
    if (to - from > 1e-3) kept.push({ from: point(from), to: point(to) });
    from = Math.max(from, h1);
  }
  return kept;
}
