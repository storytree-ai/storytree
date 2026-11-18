// Capability 1 · Scene layout

import {
  LAND_CAMERA_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
} from './camera.js';

export interface Pt {
  x: number;
  y: number;
}

export interface Axial {
  q: number;
  r: number;
}

export const LAND_AREA_PER_CAPABILITY = 318;

export const HEX_TILES_PER_CAPABILITY = 1;

export const HEX_UNIT_AREA = (3 * Math.sqrt(3)) / 2;

export const HEX_R = Math.sqrt(LAND_AREA_PER_CAPABILITY / HEX_TILES_PER_CAPABILITY / HEX_UNIT_AREA);
export const HEX_W = Math.sqrt(3) * HEX_R;
export const HEX_AREA = HEX_UNIT_AREA * HEX_R * HEX_R;

export const TILE_QUOTA_RULE = `max(1, capabilities) × ${HEX_TILES_PER_CAPABILITY} hexes`;

export const PRE_ADR0528_TILE = Object.freeze({ hexR: 27, quota: 'max(3, capabilities + 2) hexes' });

export const TILE_SCALE = HEX_R / PRE_ADR0528_TILE.hexR;

export function tileUnits(authoredAgainstOldTile: number): number {
  return authoredAgainstOldTile * TILE_SCALE;
}

export const axialKey = (h: Axial): string => `${h.q},${h.r}`;

export const AXIAL_DIRS: Axial[] = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
];

export interface ElevationOpts {
  elevationDeg?: number;
  hexR?: number;
}

export function hexCenter(h: Axial, opts?: ElevationOpts): Pt {
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const R = opts?.hexR ?? HEX_R;
  return {
    x: Math.sqrt(3) * R * (h.q + h.r / 2),
    y: 1.5 * R * h.r * groundFlattening(elevationDeg),
  };
}

export function pixelToHex(p: Pt, opts?: ElevationOpts): Axial {
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const R = opts?.hexR ?? HEX_R;
  const rf = p.y / (1.5 * R * groundFlattening(elevationDeg));
  const qf = p.x / (Math.sqrt(3) * R) - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export function hexDist(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hexCorners(
  cx: number,
  cy: number,
  R: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): Pt[] {
  const f = groundFlattening(elevationDeg);
  const pts: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) * f });
  }
  return pts;
}

export function polyPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  return (
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
  );
}
