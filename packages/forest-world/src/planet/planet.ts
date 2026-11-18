// Capability 4 · The planet
import { Quaternion, Vector3 } from 'three';
import { landHeightRange } from '../land-relief.js';
import { SHORE_DIP } from '../shore-fall.js';

export interface PlanetSpot { readonly x: number; readonly y: number; readonly z: number }

const UP = new Vector3(0, 1, 0);
export const PLATE_CLEARANCE = Math.max(landHeightRange(), SHORE_DIP) + 0.1;

export function plateTransform(spot: PlanetSpot, radius: number, lift = 0) {
  const normal = new Vector3(spot.x, spot.y, spot.z).normalize();
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(normal.lengthSq()) || normal.lengthSq() === 0) {
    throw new Error('A planet plate needs a positive globe radius and a finite, nonzero spot.');
  }
  return {
    position: normal.clone().multiplyScalar(radius + PLATE_CLEARANCE + lift).toArray(),
    quaternion: new Quaternion().setFromUnitVectors(UP, normal),
  };
}
