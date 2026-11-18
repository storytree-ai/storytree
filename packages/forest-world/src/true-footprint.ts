// Capability 1 · Scene layout

import type { Descriptor3D, InstanceDescriptor, Transform3D } from './descriptors.js';

export interface IslandCentre {
  x: number;
  z: number;
}

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

export interface IslandScale {
  x: number;
  z: number;
}

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

function nearestIsland(centres: ReadonlyMap<string, IslandCentre>, x: number, z: number): string {
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
