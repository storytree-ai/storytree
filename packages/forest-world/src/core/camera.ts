// Capability 4 · The planet

import type { Pt } from './hex.js';

const RAD = Math.PI / 180;

export const PLAN_VIEW_ELEVATION_DEG = 90;

export const LAND_CAMERA_ELEVATION_DEG = 50;

export function groundFlattening(elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): number {
  return Math.sin(elevationDeg * RAD);
}

export function uprightForeshortening(elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): number {
  return Math.cos(elevationDeg * RAD);
}

export function projectGround(p: Pt, elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): Pt {
  return { x: p.x, y: p.y * groundFlattening(elevationDeg) };
}

export function unprojectGround(p: Pt, elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): Pt {
  return { x: p.x, y: p.y / groundFlattening(elevationDeg) };
}

