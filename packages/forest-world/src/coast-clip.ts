// Capability 4 · The planet

import {
  COAST_OUTSET,
  COAST_SMOOTH_ITERS,
  boundaryRingLoops,
  chaikinClosed,
  jitteredOutset,
  outsetLoop,
  type BoundarySeg,
  type Pt,
} from './core/index.js';

import { LAND_SCALE } from './land-per-capability.js';
import type { InstanceDescriptor, Transform3D } from './descriptors.js';

export interface CoastPoint {
  x: number;
  z: number;
}

export type CoastMode = 'none' | 'outset' | 'project' | 'subdivide';

export const COAST_MODES: readonly CoastMode[] = ['none', 'outset', 'project', 'subdivide'];

export const SHIPPED_COAST: CoastMode = 'subdivide';

export function vertexKey(p: CoastPoint): string {
  return `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
}

export function edgeKey(a: CoastPoint, b: CoastPoint): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function rimLoops(rings: readonly (readonly CoastPoint[])[]): CoastPoint[][] {
  const uses = new Map<string, number>();
  const segs = new Map<string, BoundarySeg>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const k = edgeKey(a, b);
      uses.set(k, (uses.get(k) ?? 0) + 1);
      segs.set(k, { x1: a.x, y1: a.z, x2: b.x, y2: b.z });
    }
  }
  const shore: BoundarySeg[] = [];
  for (const [k, n] of uses) {
    if (n !== 1) continue;
    shore.push(segs.get(k)!);
  }
  return boundaryRingLoops(shore).map((loop) => loop.map((p) => ({ x: p.x, z: p.y })));
}

export interface CoastCurve {
  outset: CoastPoint[];
  smooth: CoastPoint[];
}

export function coastCurve(rim: readonly CoastPoint[], island: string): CoastCurve {
  const flat: Pt[] = rim.map((p) => ({ x: p.x, y: p.z }));
  const out = outsetLoop(flat, (i) => jitteredOutset(island, i, flat.length) * LAND_SCALE);
  const smoothed = chaikinClosed(out, COAST_SMOOTH_ITERS);
  return {
    outset: out.map((p) => ({ x: p.x, z: p.y })),
    smooth: smoothed.map((p) => ({ x: p.x, z: p.y })),
  };
}

export function nearestOnSegment(p: CoastPoint, a: CoastPoint, b: CoastPoint): CoastPoint {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const lenSq = ex * ex + ez * ez;
  const raw = lenSq === 0 ? 0 : ((p.x - a.x) * ex + (p.z - a.z) * ez) / lenSq;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return { x: a.x + ex * t, z: a.z + ez * t };
}

export interface CoastArcs {
  landings: CoastPoint[];
  arcs: CoastPoint[][];
}

export function coastArcs(curve: CoastCurve): CoastArcs {
  const n = curve.outset.length;
  const stride = 2 ** COAST_SMOOTH_ITERS;
  if (curve.smooth.length !== n * stride) {
    throw new Error(
      `coastArcs: expected ${n * stride} curve points for ${n} outset points at ` +
        `${COAST_SMOOTH_ITERS} Chaikin passes, got ${curve.smooth.length}`,
    );
  }
  const total = curve.smooth.length;
  const at = (k: number): CoastPoint => curve.smooth[((k % total) + total) % total]!;
  const chord = (i: number): number => stride * i - stride / 2;
  const landings = curve.outset.map((p, i) => nearestOnSegment(p, at(chord(i)), at(chord(i) + 1)));
  const arcs = curve.outset.map((_p, i) =>
    Array.from({ length: stride }, (_unused, step) => at(chord(i) + step + 1)),
  );
  return { landings, arcs };
}

export function isSimpleRing(ring: readonly CoastPoint[]): boolean {
  const n = ring.length;
  const side = (o: CoastPoint, a: CoastPoint, b: CoastPoint): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const straddles = (a: CoastPoint, b: CoastPoint, c: CoastPoint, d: CoastPoint): boolean => {
    const s1 = side(c, d, a);
    const s2 = side(c, d, b);
    return (s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0);
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (straddles(a, b, c, d) && straddles(c, d, a, b)) return false;
    }
  }
  return true;
}

export const COAST_SCALE_LADDER: readonly number[] = [
  1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0,
];

function lerp(from: CoastPoint, to: CoastPoint, s: number): CoastPoint {
  return { x: from.x + (to.x - from.x) * s, z: from.z + (to.z - from.z) * s };
}

export interface CoastDisplacement {
  moved: Map<string, CoastPoint>;
  inserted: Map<string, { from: string; points: CoastPoint[] }>;
  scales: Map<string, number>;
}

export type RingDisplacement = Pick<CoastDisplacement, 'moved' | 'inserted'>;

export const NO_DISPLACEMENT: CoastDisplacement = {
  moved: new Map(),
  inserted: new Map(),
  scales: new Map(),
};

export function coastDisplacement(
  rings: readonly (readonly CoastPoint[])[],
  island: string,
  mode: CoastMode,
): CoastDisplacement {
  if (mode === 'none') return NO_DISPLACEMENT;
  const moved = new Map<string, CoastPoint>();
  const inserted = new Map<string, { from: string; points: CoastPoint[] }>();
  const scales = new Map<string, number>();
  for (const rim of rimLoops(rings)) {
    if (rim.length < 3) continue;
    const curve = coastCurve(rim, island);
    const { landings, arcs } = coastArcs(curve);
    const target = mode === 'outset' ? curve.outset : landings;
    const rung = new Map<string, number>();
    for (const v of rim) rung.set(vertexKey(v), 0);
    const scaleOf = (v: CoastPoint): number => COAST_SCALE_LADDER[rung.get(vertexKey(v))!]!;

    const snapshot = (): RingDisplacement => {
      const at = new Map<string, CoastPoint>();
      const arcsAt = new Map<string, { from: string; points: CoastPoint[] }>();
      rim.forEach((v, i) => at.set(vertexKey(v), lerp(v, target[i]!, scaleOf(v))));
      if (mode === 'subdivide') {
        rim.forEach((a, i) => {
          const b = rim[(i + 1) % rim.length]!;
          const sa = scaleOf(a);
          const sb = scaleOf(b);
          const arc = arcs[i]!;
          const points = arc.map((p, k) => {
            const t = (k + 1) / (arc.length + 1);
            return lerp(lerp(a, b, t), p, sa + (sb - sa) * t);
          });
          arcsAt.set(edgeKey(a, b), { from: vertexKey(a), points });
        });
      }
      return { moved: at, inserted: arcsAt };
    };

    let current = snapshot();
    const touched = rings.filter((r) => r.some((p) => rung.has(vertexKey(p))));
    for (const _rung of COAST_SCALE_LADDER) {
      const folded = touched.filter((r) => !isSimpleRing(applyDisplacement(r, current)));
      if (folded.length === 0) break;
      const foldedKeys = new Set(folded.flatMap((r) => r.map(vertexKey)));
      for (const v of rim) {
        const k = vertexKey(v);
        if (foldedKeys.has(k)) rung.set(k, rung.get(k)! + 1);
      }
      current = snapshot();
    }
    for (const v of rim) scales.set(vertexKey(v), scaleOf(v));
    for (const [k, v] of current.moved) moved.set(k, v);
    for (const [k, v] of current.inserted) inserted.set(k, v);
  }
  return { moved, inserted, scales };
}

export interface CoastCapping {
  rim: number;
  bound: number;
  least: number;
}

export function coastCapping(
  descriptors: readonly InstanceDescriptor[],
  mode: CoastMode,
): CoastCapping {
  let rim = 0;
  let bound = 0;
  let least = 1;
  for (const [island, cells] of groundByIsland(descriptors)) {
    const rings = cells.map((c) => ringOf(c.points!));
    for (const s of coastDisplacement(rings, island, mode).scales.values()) {
      rim += 1;
      if (s < 1) bound += 1;
      least = Math.min(least, s);
    }
  }
  return { rim, bound, least };
}

export function applyDisplacement(
  ring: readonly CoastPoint[],
  d: RingDisplacement,
): CoastPoint[] {
  const out: CoastPoint[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ka = vertexKey(a);
    out.push(d.moved.get(ka) ?? a);
    const insert = d.inserted.get(edgeKey(a, b));
    if (insert === undefined) continue;
    const points = insert.from === ka ? insert.points : [...insert.points].reverse();
    for (const p of points) out.push(p);
  }
  return out;
}

function ringOf(points: readonly Transform3D[]): CoastPoint[] {
  return points.map((p) => ({ x: p.x, z: p.z }));
}

function coastalIsland(d: InstanceDescriptor): string | null {
  if (d.kind !== 'cell-ground') return null;
  if (d.points === undefined) return null;
  return d.island ?? null;
}

function groundByIsland(
  descriptors: readonly InstanceDescriptor[],
): Map<string, InstanceDescriptor[]> {
  const out = new Map<string, InstanceDescriptor[]>();
  for (const d of descriptors) {
    const island = coastalIsland(d);
    if (island === null) continue;
    const list = out.get(island);
    if (list) list.push(d);
    else out.set(island, [d]);
  }
  return out;
}

export function clipToCoast(
  descriptors: readonly InstanceDescriptor[],
  mode: CoastMode,
): InstanceDescriptor[] {
  if (mode === 'none') return [...descriptors];
  const displacements = new Map<string, CoastDisplacement>();
  for (const [island, cells] of groundByIsland(descriptors)) {
    displacements.set(island, coastDisplacement(cells.map((c) => ringOf(c.points!)), island, mode));
  }
  return descriptors.map((d) => {
    const island = coastalIsland(d);
    if (island === null) return d;
    const points: Transform3D[] = applyDisplacement(
      ringOf(d.points!),
      displacements.get(island)!,
    ).map((p) => ({ x: p.x, y: 0, z: p.z }));
    return { ...d, points };
  });
}

export { COAST_OUTSET, COAST_SMOOTH_ITERS };

export const GROUND_COAST_OUTSET = COAST_OUTSET * LAND_SCALE;
