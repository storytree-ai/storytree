// Capability 1 · Scene layout

import { LAND_AREA_PER_CAPABILITY, PRE_ADR0528_TILE } from './core/index.js';

import { scaleAboutIslands, type IslandCentre, type IslandScale } from './true-footprint.js';
import type { Descriptor3D, Transform3D } from './descriptors.js';

export const HEX_TILE_AREA = ((3 * Math.sqrt(3)) / 2) * PRE_ADR0528_TILE.hexR * PRE_ADR0528_TILE.hexR;

export const TUNED_FIXTURE = { tiles: 13, capabilities: 11 } as const;

export const TUNED_LAND_AREA_PER_CAPABILITY = (HEX_TILE_AREA * TUNED_FIXTURE.tiles) / TUNED_FIXTURE.capabilities;

export const LAND_AREA_PER_CAPABILITY_RUNGS = [318, 200, 108] as const;

export { LAND_AREA_PER_CAPABILITY };

export const LAND_SCALE = Math.sqrt(LAND_AREA_PER_CAPABILITY / TUNED_LAND_AREA_PER_CAPABILITY);

export const LAND_FLOOR_CAPABILITIES = 1;

export function ringArea(points: readonly Transform3D[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    twice += p.x * q.z - q.x * p.z;
  }
  return Math.abs(twice) / 2;
}

export interface IslandLand {
  island: string;
  capabilities: number;
  area: number;
}

export function islandLand(descriptors: readonly Descriptor3D[]): Map<string, IslandLand> {
  const out = new Map<string, IslandLand>();
  const parcels = new Map<string, Set<string>>();
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground' || d.island === undefined) continue;
    const land = out.get(d.island) ?? { island: d.island, capabilities: 0, area: 0 };
    land.area += ringArea(d.points ?? []);
    if (d.parcel !== undefined) {
      const seen = parcels.get(d.island) ?? new Set<string>();
      seen.add(d.parcel);
      parcels.set(d.island, seen);
      land.capabilities = seen.size;
    }
    out.set(d.island, land);
  }
  return out;
}

export function landRatioFactor(land: IslandLand, areaPerCapability: number, floorCapabilities: number = LAND_FLOOR_CAPABILITIES, area?: number): number {
  if (!Number.isFinite(areaPerCapability) || areaPerCapability <= 0) {
    throw new Error(`land-per-capability: the ratio must be a positive finite number of units² per capability, got ${areaPerCapability}`);
  }
  if (!Number.isFinite(floorCapabilities) || floorCapabilities < 0) {
    throw new Error(`land-per-capability: the floor must be a non-negative finite number of capabilities, got ${floorCapabilities}`);
  }
  if (area !== undefined && (!Number.isFinite(area) || area <= 0)) {
    throw new Error(`land-per-capability: an island's set area must be a positive finite number of units², got ${area}`);
  }
  const counted = Math.max(floorCapabilities, land.capabilities);
  const wanted = area ?? counted * areaPerCapability;
  if (wanted === 0 || land.area === 0) return 1;
  const factor = Math.sqrt(wanted / land.area);
  if (factor > MAX_LAND_FACTOR || factor < 1 / MAX_LAND_FACTOR) {
    throw new Error(
      `land-per-capability: island "${land.island}" would scale by ${factor} (${land.capabilities} capabilities × ${areaPerCapability} over ${land.area} units²) — past ${MAX_LAND_FACTOR}× either way, which is an arithmetic fault and not a size`,
    );
  }
  return factor;
}

export const MAX_LAND_FACTOR = 100;

export function sizeIslandsByCapability<T extends Descriptor3D>(
  descriptors: readonly T[],
  areaPerCapability: number,
  floorCapabilities: number = LAND_FLOOR_CAPABILITIES,
  areas: ReadonlyMap<string, number> = new Map(),
): T[] {
  const land = islandLand(descriptors);
  return scaleAboutIslands(descriptors, (island: string, _centre: IslandCentre): IslandScale => {
    const f = landRatioFactor(land.get(island) as IslandLand, areaPerCapability, floorCapabilities, areas.get(island));
    return { x: f, z: f };
  });
}

export interface IslandSizeInversion {
  smaller: IslandLand;
  larger: IslandLand;
}

export function islandSizeInversions(lands: Iterable<IslandLand>, tolerance = 1e-6): IslandSizeInversion[] {
  const all = [...lands];
  const out: IslandSizeInversion[] = [];
  for (const a of all) {
    for (const b of all) {
      if (a.capabilities < b.capabilities && a.area > b.area + tolerance) out.push({ smaller: a, larger: b });
    }
  }
  return out;
}
