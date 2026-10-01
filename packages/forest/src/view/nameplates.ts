/** Where the globe's nameplates sit on an island's plate: the story's just south of its coast, its capabilities' on their own land. */
import { Quaternion, Vector3 } from "three";
import type { Coast, Point, TerritoryMap } from "../territories/territories.js";

/** How far past the coast a story's nameplate starts, in ground units. */
export const NAMEPLATE_GAP = 3;

const UP = new Vector3(0, 1, 0);

/** The globe's south in a plate's own ground plane: straight down the screen while north is up. */
function southOnPlate(spot: { x: number; y: number; z: number }): Point {
  const normal = new Vector3(spot.x, spot.y, spot.z).normalize();
  const south = normal.clone().multiplyScalar(normal.y).sub(UP);
  // At a pole every way is south: take the plate's own +z.
  if (south.lengthSq() < 1e-12) return { x: 0, z: 1 };
  // The plate's frame, as plateTransform turns it: its +y out of the globe.
  const local = south.applyQuaternion(new Quaternion().setFromUnitVectors(UP, normal).invert());
  const length = Math.hypot(local.x, local.z);
  return { x: local.x / length, z: local.z / length };
}

/** Where a story's nameplate hangs from, its top edge just south of the island's coast. */
export function storyPlate(coast: Coast, spot: { x: number; y: number; z: number }): Point {
  const south = southOnPlate(spot);
  const reach = Math.max(0, ...coast.flat().map(p => p.x * south.x + p.z * south.z));
  return { x: south.x * (reach + NAMEPLATE_GAP), z: south.z * (reach + NAMEPLATE_GAP) };
}

/**
 * One nameplate per capability's territory, at the seed of its cell nearest the territory's middle:
 * a seed lies inside its own cell, so the plate is on the territory's land. Unclaimed code has none.
 */
export function capabilityPlates(map: TerritoryMap): { capability: string; title: string; x: number; z: number }[] {
  return map.territories.flatMap(({ capability, title }, territory) => {
    const sites = map.cells.filter(cell => cell.territory === territory).map(cell => cell.site);
    if (capability === undefined || sites.length === 0) return [];
    const middle = { x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length };
    const at = sites.reduce((best, p) => Math.hypot(p.x - middle.x, p.z - middle.z) < Math.hypot(best.x - middle.x, best.z - middle.z) ? p : best);
    return [{ capability, title: title ?? capability, x: at.x, z: at.z }];
  });
}
