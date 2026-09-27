import { Quaternion, Vector3 } from 'three';
import { SHIPPED_ELEVATION_DEG } from '../camera-framing.js';
import { landHeightRange } from '../land-relief.js';
import { SHORE_DIP } from '../shore-fall.js';
import { LIGHT_DIRECTION } from '../shade-ladder.js';

/** Lane A supplies these directions and the fixed sea radius, in ground units. */
export interface PlanetSpot { readonly x: number; readonly y: number; readonly z: number }

const UP = new Vector3(0, 1, 0);
// A tangent sea at y=0 would cut through negative relief. Retain the engine's existing skirt.
export const PLATE_CLEARANCE = Math.max(landHeightRange(), SHORE_DIP) + 0.1;
const flatCamera = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -SHIPPED_ELEVATION_DEG * Math.PI / 180);
const sunInView = new Vector3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z)
  .normalize().applyQuaternion(flatCamera.invert());

/** A rigid plate: local +y points out of the sphere, with no bend or change to its geometry. */
export function plateTransform(spot: PlanetSpot, radius: number) {
  const normal = new Vector3(spot.x, spot.y, spot.z).normalize();
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(normal.lengthSq()) || normal.lengthSq() === 0) {
    throw new Error('A planet plate needs a positive sea radius and a finite, nonzero spot.');
  }
  return {
    position: normal.clone().multiplyScalar(radius + PLATE_CLEARANCE).toArray(),
    quaternion: new Quaternion().setFromUnitVectors(UP, normal),
  };
}

/** L1: the flat forest's lamp fixed over the viewer's shoulder. Ground and kit share this sun.
 * Baked shadow atlases and skirt colours remain the approved flat island's, as ADR-0646 allows. */
export function lightForCamera(camera: Quaternion, target = new Vector3()): Vector3 {
  return target.copy(sunInView).applyQuaternion(camera);
}
