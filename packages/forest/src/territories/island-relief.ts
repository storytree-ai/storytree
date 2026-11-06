/**
 * Capability 3 · Story node render (the forest story): each island's relief (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2 step 3b),
 * ported from the capability tree mock's round 11 relief (docs/design/capability-tree-3d/q-all-islands/tools/overlay.ts,
 * `RELIEF`): every territory a plateau one height above the open land, a wall where a plateau stands over the open land
 * or the coast, a bevel rim inside each border broken where a road crosses it on the land (a gate or open road), and a
 * ramp only where a road climbs from the open land onto a plateau; a road in a tunnel (ADR-1253 D3) climbs nothing, and a
 * low rise stands over it from mouth to mouth, its portals set in the rise's face (question_921aee319481). Sizes are The
 * library's, given back at the island's own, as the roads' are.
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
  post: { side: 1.4, height: 1.2 },
  /** A tunnel's rise: its height over the plateau, how far it reaches either side of the tunnel (narrowed to stay on its
   * land, down to `least`), how far from each mouth it climbs to its full height, and how far apart the gentle humps along
   * it stand (Mick, 2026-11-07: "some topology ... that makes it look like an actual tunnel"). */
  rise: { height: 1.25, halfWidth: 2.3, least: 0.7, inset: 1.0, hump: 4.5 },
} as const;
/** Toward the light, on the ground: from the page's upper left at rest, as the mock lights it. */
export const LIGHT: Point = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

/** A ramp: where a road crosses onto the open land, `along` the border, climbing from `out` (toward the open land) to the
 * plateau, and the gate it climbs to, if the crossing is one. */
export type Ramp = { readonly at: Point; readonly along: Point; readonly out: Point; readonly territory: number; readonly gate?: RoadGate };
/** A wall: an edge where a territory's plateau stands over the open land or the coast, `out` its face's direction. */
export type Wall = { readonly from: Point; readonly to: Point; readonly out: Point; readonly territory: number; readonly onto: "open" | "coast" };
/** A rim: a stretch of border on a territory's side, `into` the territory. */
export type Rim = { readonly from: Point; readonly to: Point; readonly into: Point; readonly territory: number };
export type IslandRelief = {
  /** The island's scale against The library's; the plateau's height above the open land, and the ramps', rims' and posts' sizes, at it. */
  readonly scale: number; readonly height: number; readonly rampWidth: number; readonly rampDepth: number; readonly rimWidth: number;
  readonly post: { readonly side: number; readonly height: number };
  /** A tunnel's rise at the island's scale. */
  readonly rise: { readonly height: number; readonly halfWidth: number; readonly least: number; readonly inset: number; readonly hump: number };
  /** Each tunnel's way under the land, the rise stands over. */
  readonly tunnels: readonly { readonly pts: readonly Point[] }[];
  readonly ramps: readonly Ramp[]; readonly walls: readonly Wall[]; readonly rims: readonly Rim[];
  /** The territory under a point (-1 on open land), undefined off the coast. */
  territoryAt(p: Point): number | undefined;
  /** How far a point stands above the open land: a plateau's height and any tunnel's rise over it, part way up a ramp, or none. */
  raise(p: Point): number;
  /** How far the tunnels' rise stands at a point, wherever the land is. */
  riseAt(p: Point): number;
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
const unit = (a: Point): Point => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, z: a.z / l }; };
const perp = (a: Point): Point => ({ x: -a.z, z: a.x });
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/** The relief of `map` (an island as laid out by its links), its ramps where the roads of `roads` cross onto the open land. */
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
  const crossings: { at: Point; along: Point; opening: number; gate?: RoadGate }[] = [...roads.gates.map((gate) => ({ ...gate, gate })), ...roads.passes];
  const ramps: Ramp[] = crossings.flatMap(({ at: p, along, gate }) => {
    const n = perp(along), [a, b] = [territoryAt(at(p, n, step)), territoryAt(at(p, n, -step))], by = gate === undefined ? {} : { gate };
    if (a === -1 && b !== undefined && b >= 0) return [{ at: p, along, out: n, territory: b, ...by }];
    if (b === -1 && a !== undefined && a >= 0) return [{ at: p, along, out: { x: -n.x, z: -n.z }, territory: a, ...by }];
    return [];
  });
  const onRamp = (p: Point): number | undefined => {
    for (const r of ramps) {
      const d = sub(p, r.at), u = dot(d, r.along), w = dot(d, r.out);
      if (Math.abs(u) <= rampWidth / 2 && w >= -0.05 * S && w <= rampDepth) return 1 - Math.max(0, w) / rampDepth;
    }
    return undefined;
  };
  const rise = { height: RELIEF.rise.height * S, halfWidth: RELIEF.rise.halfWidth * S, least: RELIEF.rise.least * S, inset: RELIEF.rise.inset * S, hump: RELIEF.rise.hump * S };
  const overTunnel = tunnelRise(roads, rise, territoryAt);
  const raise = (p: Point) => { const t = territoryAt(p); return t === undefined ? 0 : t >= 0 ? H + overTunnel(p) : (onRamp(p) ?? 0) * H; };

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
  const post = { side: RELIEF.post.side * S, height: RELIEF.post.height * S };
  const gateHoles = crossings.map((c) => ({ at: c.at, half: c.opening / 2 + (c.gate === undefined ? 0 : post.side) + 0.2 * S }));
  const rims: Rim[] = borders.flatMap((b) => b.pair.filter((t) => t >= 0).flatMap((t) => {
    const into = sideOf(b.from, b.to, t);
    return cut(b.from, b.to, gateHoles, 0.6 * S).map((s) => ({ ...s, into, territory: t }));
  }));
  return { scale: S, height: H, rise, rampWidth, rampDepth, rimWidth: RELIEF.rim.width * S, post, tunnels: roads.tunnels, ramps, walls, rims, territoryAt, raise, riseAt: overTunnel };
}

/**
 * How far the land at a point rises over the tunnels of `roads`: in straight facets to the rise's height over each tunnel's way, in
 * gentle humps along it, falling to none either side of it as far out as the land it goes under reaches (by
 * `territoryAt`), from `halfWidth` down to `least`, none on any other land, and at a mouth climbing from none at the mouth to
 * its height `inset` in; a tunnel too short for that stands under a round knoll, on any plateau.
 */
function tunnelRise(roads: IslandRoads, rise: IslandRelief["rise"], territoryAt: (p: Point) => number | undefined): (p: Point) => number {
  // How far out from a way's point the land it goes under reaches either side, up to `halfWidth`: stepped out, then narrowed down by halves.
  const room = (q: Point, n: Point, onPlateau: (p: Point) => boolean) => {
    let out = rise.halfWidth;
    for (const side of [1, -1]) for (let k = 1; k <= 8; k++) {
      let d = rise.halfWidth * k / 8;
      if (onPlateau(at(q, n, side * d))) continue;
      let lo = rise.halfWidth * (k - 1) / 8;
      for (let i = 0; i < 6; i++) { const mid = (lo + d) / 2; if (onPlateau(at(q, n, side * mid))) lo = mid; else d = mid; }
      out = Math.min(out, lo);
      break;
    }
    return Math.max(rise.least, Math.min(rise.halfWidth, out * 0.9));
  };
  // Each way point's room, evened out with its neighbours', so the rise's foot runs smooth along a jagged border.
  const even = (widths: readonly number[]) => widths.map((_, i) => { const near = widths.slice(Math.max(0, i - 3), i + 4); return Math.min(widths[i]! * 1.15, near.reduce((s, w) => s + w, 0) / near.length); });
  const ways = roads.tunnels.filter((t) => t.pts.length > 1).map(({ pts }) => {
    const lengths = pts.slice(1).map((b, i) => Math.hypot(b.x - pts[i]!.x, b.z - pts[i]!.z)), total = lengths.reduce((s, l) => s + l, 0);
    const under = new Set(pts.map(territoryAt)), onIt = (p: Point) => under.has(territoryAt(p));
    const widths = even(pts.map((q, i) => room(q, unit(perp(sub(pts[Math.min(i + 1, pts.length - 1)]!, pts[Math.max(i - 1, 0)]!))), onIt)));
    const mouth = (q: Point) => roads.portals.some((m) => Math.hypot(m.at.x - q.x, m.at.z - q.z) < 1e-6);

    // A short tunnel's knoll: round, on the middle of its way, reaching a little past its mouths so they sit in its flank.
    const middle = pointAlong(pts, lengths, total / 2), knoll = total < 2 * rise.halfWidth ? total / 2 + rise.inset * 0.6 : 0, lengthwise = unit(sub(pts.at(-1)!, pts[0]!));
    const xs = pts.map((q) => q.x), zs = pts.map((q) => q.z), r = Math.max(rise.halfWidth, knoll);
    return { pts, lengths, widths, total, onIt, middle, knoll, lengthwise, inset: Math.min(rise.inset, total / 2.5), ends: [mouth(pts[0]!), mouth(pts.at(-1)!)] as const, box: [Math.min(...xs) - r, Math.max(...xs) + r, Math.min(...zs) - r, Math.max(...zs) + r] as const };
  });
  return (p) => {
    let best = 0;
    for (const w of ways) {
      if (p.x < w.box[0] || p.x > w.box[1] || p.z < w.box[2] || p.z > w.box[3]) continue;
      // A short tunnel's knoll stands on any plateau round it, so one under a corner of a territory still has its hill.
      if (w.knoll > 0) {
        // An oval along the road, reaching past both mouths, and as wide as the rise over a longer one.
        const d = sub(p, w.middle), k = Math.min(1, Math.hypot(dot(d, w.lengthwise) / w.knoll, dot(d, perp(w.lengthwise)) / (rise.halfWidth * 0.8))), t = territoryAt(p);
        if (t !== undefined && t >= 0) best = Math.max(best, rise.height * Math.min(1, (1 - k) * KNOLL_STEEP));
      }
      if (!w.onIt(p)) continue;
      // The nearest point on the way: how far off it, how far along, and how wide the rise is there.
      let off = Infinity, along = 0, wide = rise.halfWidth, walked = 0;
      for (let i = 0; i < w.lengths.length; i++) {
        const a = w.pts[i]!, b = w.pts[i + 1]!, l = w.lengths[i]!, t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (l * l))) : 0;
        const d = Math.hypot(p.x - a.x - t * (b.x - a.x), p.z - a.z - t * (b.z - a.z));
        if (d < off) { off = d; along = walked + t * l; wide = w.widths[i]! + (w.widths[i + 1]! - w.widths[i]!) * t; }
        walked += l;
      }
      const end = Math.max(w.ends[0] ? (w.inset - along) / w.inset : 0, w.ends[1] ? (along - (w.total - w.inset)) / w.inset : 0, 0);
      // Narrowing toward each mouth, so it comes down into it rather than ending in a stub.
      const taper = Math.min(2 * w.inset, w.total / 2), toMouth = Math.max(0, Math.min(1, w.ends[0] ? along / taper : 1, w.ends[1] ? (w.total - along) / taper : 1));
      // Faceted, as the plateaus' walls and ramps are: two flanks falling straight from a crest over the way, and a hipped end
      // falling straight to each mouth.
      const q = Math.min(1, Math.max(off / (wide * (0.7 + 0.3 * toMouth)), end));
      // A little lower where it is narrower, and in gentle humps along it, highest halfway between its mouths.
      const tall = rise.height * (0.75 + 0.25 * wide / rise.halfWidth) * (0.92 + 0.08 * Math.cos(2 * Math.PI * (along - w.total / 2) / rise.hump));
      best = Math.max(best, tall * (1 - q));
    }
    return best;
  };
}

/** How steeply a short tunnel's knoll falls from its flat top: its sides take this share of its reach. */
const KNOLL_STEEP = 2.2;

/** The point `d` along a line whose steps are `lengths` long. */
function pointAlong(pts: readonly Point[], lengths: readonly number[], d: number): Point {
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (d <= l && l > 0) return at(pts[i]!, unit(sub(pts[i + 1]!, pts[i]!)), d);
    d -= l;
  }
  return pts.at(-1)!;
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
