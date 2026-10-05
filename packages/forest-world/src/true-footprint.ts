// true-footprint.ts — THE PER-ISLAND AFFINE SCALE: every ground cell moved about ITS OWN island's
// centre (the mean of its ring vertices), by that island's own `(x, z)` pair. The arithmetic is
// affine about a fixed centre, so an island's centre is invariant under it. `land-per-capability.ts`
// is the caller: an island's SIZE from a declared land-per-capability ratio, or from its story's
// lines, is an isotropic factor that differs per island. Since ADR-0920 the engine hands over ground
// cells alone, so the rules this file kept for 0.2's roads, blooms, caves and wisps went with them.
//
// Pure: no React, no three.

import type { Descriptor3D, InstanceDescriptor, Transform3D } from './descriptors.js';

/** A ground-plane centre — the mean of an island's ring vertices. */
export interface IslandCentre {
  x: number;
  z: number;
}

/** Each island's ground centre — the mean of its `cell-ground` ring vertices — keyed by island id.
 *  Islands with no ring vertices are absent rather than at the origin. */
export function islandCentres(descriptors: readonly Descriptor3D[]): Map<string, IslandCentre> {
  const sums = new Map<string, { x: number; z: number; n: number }>();
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground' || d.island === undefined) continue;
    const acc = sums.get(d.island) ?? { x: 0, z: 0, n: 0 };
    for (const p of d.points ?? []) {
      acc.x += p.x;
      acc.z += p.z;
      acc.n += 1;
    }
    sums.set(d.island, acc);
  }
  const out = new Map<string, IslandCentre>();
  for (const [id, acc] of sums) if (acc.n > 0) out.set(id, { x: acc.x / acc.n, z: acc.z / acc.n });
  return out;
}

/** The centre nearest a ground point, or null when there are no islands at all. */
export function nearestCentre(centres: ReadonlyMap<string, IslandCentre>, x: number, z: number): IslandCentre | null {
  let best: IslandCentre | null = null;
  let bestDist = Infinity;
  for (const c of centres.values()) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** A per-island scale: the factor applied along x and along z about the island's centre. */
export interface IslandScale {
  x: number;
  z: number;
}

/**
 * THE GENERAL OPERATION: scale every descriptor about its island's centre by that island's own
 * `(x, z)` factors, y untouched. `scaleFor` is asked once per island centre and may answer a
 * different pair per island — which is what a per-island SIZE needs and a global stretch does not.
 * A cell naming no island scales about the nearest one. A stream with no islands is returned as-is.
 */
export function scaleAboutIslands<T extends Descriptor3D>(
  descriptors: readonly T[],
  scaleFor: (island: string, centre: IslandCentre) => IslandScale,
): T[] {
  const centres = islandCentres(descriptors);
  if (centres.size === 0) return [...descriptors];
  const scales = new Map<string, IslandScale>();
  for (const [id, c] of centres) {
    const s = scaleFor(id, c);
    if (!Number.isFinite(s.x) || s.x <= 0 || !Number.isFinite(s.z) || s.z <= 0) {
      throw new Error(`true-footprint: island "${id}" was given a scale of (${s.x}, ${s.z}); both must be positive finite numbers`);
    }
    scales.set(id, s);
  }
  const ownIsland = (d: InstanceDescriptor, at: Transform3D): [IslandCentre, IslandScale] => {
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — `Map.get(undefined)` is
    // `undefined` too; the guard is for the type, not for the value.
    const own = d.island === undefined ? undefined : centres.get(d.island);
    const id = own !== undefined ? (d.island as string) : nearestIsland(centres, at.x, at.z);
    return [centres.get(id) as IslandCentre, scales.get(id) as IslandScale];
  };
  return descriptors.map((d): T => {
    const [c, s] = ownIsland(d, d.transform);
    const about = (p: Transform3D): Transform3D => ({ ...p, x: c.x + (p.x - c.x) * s.x, z: c.z + (p.z - c.z) * s.z });
    const moved: InstanceDescriptor = { ...d, transform: about(d.transform) };
    if (d.points !== undefined) moved.points = d.points.map(about);
    return moved as T;
  });
}

/** The id of the island whose centre is nearest a ground point. The caller holds `centres.size > 0`. */
function nearestIsland(centres: ReadonlyMap<string, IslandCentre>, x: number, z: number): string {
  // Every finite distance beats the initial Infinity, so the first island is the running best and
  // a tie keeps the FIRST — the same rule `nearestCentre` holds — with no placeholder id to return
  // by mistake.
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [id, c] of centres) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best as string;
}
