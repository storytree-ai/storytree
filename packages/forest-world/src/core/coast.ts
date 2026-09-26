// Smoothed organic coastline (Chaikin corner-cutting). Turn a territory's raw,
// jagged hex-edge boundary into a soft, blobby shoreline so each island reads as
// ONE landmass with a sandy rim instead of loose hexes ringed by a hexagonal moat:
// chain the per-tile-edge segments into ordered closed loop(s), outset a per-vertex
// beach margin (a story-seeded low-frequency wave so each island gets its own bays
// and headlands), Chaikin-round the corners, emit cusp-free `d` strings. Pure
// deterministic geometry (hash/rand01 only).

import { hash, rand01 } from './rng.js';
import { tileUnits, type Pt } from './hex.js';

export interface BoundarySeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Px the smoothed coast sits beyond the hex tiles — a thin sandy beach.
 *
 *  ⚠ EXPORTED SINCE 2026-09-01 because the SHIPPED 3D ground now wears this same coast
 *  (`packages/forest-world-r3f/src/coast-clip.ts`). The two renderers draw one map, so they read
 *  one beach width; a second constant holding 7 is how the 2D panel and the 3D canvas come to
 *  disagree about where an island ends. */
export const COAST_OUTSET = 7;

/**
 * THE BEACH ON THE SHIPPED TILE (ADR-0528). `COAST_OUTSET` is the beach width AUTHORED on the tuned
 * radius-27 tile, and it stays that number because the 3D side reads it in that basis
 * (`forest-world-r3f`'s `GROUND_COAST_OUTSET = COAST_OUTSET × LAND_SCALE`, the shipped island's own
 * beach — which must not move). The 2D drawing re-bases it onto the derived tile HERE, and the
 * packers that draw the shipped map pass this to {@link smoothCoast}; a scene laid out on another
 * tile (the r3f harness fixture) passes the outset for its own.
 */
export const COAST_OUTSET_ON_TILE = tileUnits(COAST_OUTSET);
/** Chaikin passes: 2 rounds the hex silhouette into an organic blob. Exported for the same
 *  reason as {@link COAST_OUTSET}. */
export const COAST_SMOOTH_ITERS = 2;
const COAST_NOISE_AMP = 0.5; // per-vertex outset wobble (fraction of COAST_OUTSET) — non-uniform coasts
const COAST_NOISE_WAVES = 3; // low-frequency lobes around the shore (gentle bays, not jaggedness)

/**
 * Chain a territory's per-tile-edge boundary segments into ordered closed point
 * loop(s) — the raw, jagged hex-union silhouette. Endpoints are exact hex
 * corners, so we key on rounded coords and walk edge→edge until each loop
 * closes; territories are contiguous, so it's almost always exactly one loop.
 * The trailing point (== the first) is dropped, so callers get a clean ordered
 * ring ready to smooth into an organic coastline.
 */
export function boundaryRingLoops(segs: BoundarySeg[]): Pt[][] {
  if (segs.length === 0) return [];
  const k = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(1)}`;
  const adj = new Map<string, BoundarySeg[]>();
  const push = (key: string, s: BoundarySeg): void => {
    const list = adj.get(key);
    if (list) list.push(s);
    else adj.set(key, [s]);
  };
  for (const s of segs) {
    push(k(s.x1, s.y1), s);
    push(k(s.x2, s.y2), s);
  }
  const used = new Set<BoundarySeg>();
  const loops: Pt[][] = [];
  for (const start of segs) {
    if (used.has(start)) continue;
    used.add(start);
    const startKey = k(start.x1, start.y1);
    const loop: Pt[] = [
      { x: start.x1, y: start.y1 },
      { x: start.x2, y: start.y2 },
    ];
    let endKey = k(start.x2, start.y2);
    for (let guard = 0; guard < segs.length && endKey !== startKey; guard++) {
      const next = (adj.get(endKey) ?? []).find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      const continues = k(next.x1, next.y1) === endKey;
      const nx = continues ? next.x2 : next.x1;
      const ny = continues ? next.y2 : next.y1;
      loop.push({ x: nx, y: ny });
      endKey = k(nx, ny);
    }
    const first = loop[0];
    const last = loop[loop.length - 1];
    if (first && last && Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5) {
      loop.pop();
    }
    loops.push(loop);
  }
  return loops;
}

/** Signed area (shoelace); its sign carries the winding of an ordered loop. */
export function loopSignedArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    if (p && q) a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * The per-vertex beach width: COAST_OUTSET modulated by a deterministic, story-
 * seeded wave so each island gets its OWN gentle bays and headlands instead of a
 * uniform blob. A low-frequency sine (COAST_NOISE_WAVES lobes, phase-shifted per
 * story) carries the big shape; a tiny hashed wobble breaks any remaining
 * regularity. Amplitude is capped well inside the inter-island gap, so coasts
 * can never wander into a neighbour — and (perturbing only the outset MAGNITUDE
 * along the normal) the offset can never self-intersect.
 */
export function jitteredOutset(storyId: string, i: number, n: number, outset: number = COAST_OUTSET): number {
  const theta = (i / Math.max(n, 1)) * Math.PI * 2;
  const phase = rand01(hash(`${storyId}:coast:phase`)) * Math.PI * 2;
  const wave = Math.sin(theta * COAST_NOISE_WAVES + phase); // [-1,1], coherent
  const wobble = (rand01(hash(`${storyId}:coast:${i}`)) - 0.5) * 0.6;
  return outset * (1 + COAST_NOISE_AMP * (0.7 * wave + wobble));
}

/**
 * Push every vertex of a closed loop outward along the average of its two
 * adjacent edge normals by `distOf(i)` px — a thin "beach" margin so the
 * smoothed coast encloses the outermost tiles instead of slicing their corners.
 * Winding-aware (the signed area orients the normal outward), so concave bays
 * stay outward too. The per-vertex distance lets the coast wave (jitteredOutset).
 */
export function outsetLoop(loop: Pt[], distOf: (i: number) => number): Pt[] {
  const n = loop.length;
  if (n < 3) return loop;
  const sign = loopSignedArea(loop) > 0 ? 1 : -1;
  const edgeNormal = (a: Pt, b: Pt): Pt => {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    return { x: (sign * ey) / len, y: (-sign * ex) / len };
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const nxt = loop[(i + 1) % n];
    if (!prev || !cur || !nxt) continue;
    const n1 = edgeNormal(prev, cur);
    const n2 = edgeNormal(cur, nxt);
    let mx = n1.x + n2.x;
    let my = n1.y + n2.y;
    const len = Math.hypot(mx, my) || 1;
    mx /= len;
    my /= len;
    const dist = distOf(i);
    out.push({ x: cur.x + mx * dist, y: cur.y + my * dist });
  }
  return out;
}

/**
 * Chaikin corner-cutting on a closed loop: every edge contributes its 1/4 and
 * 3/4 points, so each sharp hex corner is replaced by two gentler ones. Two
 * passes turn the hexagonal silhouette into a smooth, organic, blobby coastline
 * (Stålberg/Townscaper-style rounding). Deterministic — pure geometry.
 */
export function chaikinClosed(loop: Pt[], iterations: number): Pt[] {
  let cur = loop;
  for (let it = 0; it < iterations && cur.length >= 3; it++) {
    const n = cur.length;
    const next: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      if (!a || !b) continue;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

/**
 * A closed SVG path through a loop's edge MIDPOINTS, each vertex its quadratic
 * control point — a cusp-free curve that closes watertight with Z. After Chaikin
 * this reads as a soft, hand-drawn coastline. The same `d` serves the island's
 * sand fill and its water moat (fill vs stroke of one curve).
 */
export function smoothLoopPath(loop: Pt[]): string {
  const n = loop.length;
  if (n < 3) return '';
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const last = loop[n - 1];
  const first = loop[0];
  if (!last || !first) return '';
  const m0 = mid(last, first);
  let d = `M ${m0.x.toFixed(1)} ${m0.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const c = loop[i];
    const nxt = loop[(i + 1) % n];
    if (!c || !nxt) continue;
    const m = mid(c, nxt);
    d += ` Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * Turn a territory's raw hex-edge boundary loops into smooth organic coastlines:
 * outset a beach margin, Chaikin-round the corners, emit cusp-free `d` strings.
 * Returns the smoothed point loop(s) (for river docking / panel use) alongside
 * the paths.
 */
/** A story island's smoothed coastline: the outset, Chaikin-smoothed boundary loops and the SVG
 *  path `d` for each. Named because `anti-slop/no-known-value-widening` reads an anonymous object
 *  return annotation as discarded type evidence — and deleting the annotation instead would let
 *  an empty-island `loops: []` infer as `never[][]`. */
export interface SmoothedCoast {
  loops: Pt[][];
  paths: string[];
}

export function smoothCoast(segs: BoundarySeg[], storyId: string, outset: number = COAST_OUTSET): SmoothedCoast {
  const loops = boundaryRingLoops(segs).map((l) =>
    chaikinClosed(
      outsetLoop(l, (i) => jitteredOutset(storyId, i, l.length, outset)),
      COAST_SMOOTH_ITERS,
    ),
  );
  return { loops, paths: loops.map(smoothLoopPath) };
}
