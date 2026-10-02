/** Where the globe's nameplates sit on an island's plate: the story's just south of its coast, its capabilities' on their own land. */
import { Quaternion, Vector3 } from "three";
import type { Coast, Point, TerritoryMap } from "../territories/territories.js";

/** How far past the coast a story's nameplate starts, in ground units. */
export const NAMEPLATE_GAP = 3;

/** The screen's down and right as they lie in a plate's own ground plane (x, z), unnormalised: a point's drop down the screen is `down` · point. */
export interface PlateView { down: Point; right: Point }

/** How the screen lies on a plate turned by `plate` (its whole turn on the globe, world frame) for an eye turned by `eye`. */
export function screenOnPlate(plate: Quaternion, eye: Quaternion): PlateView {
  const toPlate = plate.clone().invert();
  const down = new Vector3(0, -1, 0).applyQuaternion(eye).applyQuaternion(toPlate);
  const right = new Vector3(1, 0, 0).applyQuaternion(eye).applyQuaternion(toPlate);
  return { down: { x: down.x, z: down.z }, right: { x: right.x, z: right.z } };
}

/** How squarely a plate turned by `plate` (world frame) faces an eye turned by `eye`: 1 face on, 0 edge-on at the rim, below 0 turned away. */
export function facing(plate: Quaternion, eye: Quaternion): number {
  return new Vector3(0, 1, 0).applyQuaternion(plate).dot(new Vector3(0, 0, 1).applyQuaternion(eye));
}

/** Whether a plate turned by `plate` (world frame) faces an eye turned by `eye`: once its island turns away, its nameplate hides. */
export function facesEye(plate: Quaternion, eye: Quaternion): boolean {
  return facing(plate, eye) > 0;
}

/** A story nameplate as the screen shows it: its box in pixels, and how squarely its island faces the eye. */
export interface ShownPlate { story: string; box: { left: number; top: number; right: number; bottom: number }; facing: number }

/**
 * The story nameplates to hide so that no two overlap on screen. Islands near the rim crowd together as the
 * globe foreshortens them, so where two plates would overlap, the one whose island faces the eye less gives way;
 * the `selected` story's plate never does.
 */
export function crowdedOut(plates: readonly ShownPlate[], selected?: string): Set<string> {
  const order = [...plates].sort((a, b) => Number(b.story === selected) - Number(a.story === selected) || b.facing - a.facing);
  const kept: ShownPlate[] = [], hidden = new Set<string>();
  for (const plate of order) {
    const { box } = plate;
    if (kept.some(({ box: other }) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)) hidden.add(plate.story);
    else kept.push(plate);
  }
  return hidden;
}

/** How wide a story's nameplate may grow, in pixels, before its title wraps. */
export const STORY_PLATE_WIDTH = Infinity;

/** How the story nameplates on screen settle: how far each steps down the screen, and which are hidden. */
export function settlePlates(plates: readonly ShownPlate[], selected?: string): { drops: Map<string, number>; hidden: Set<string> } {
  return { drops: new Map(), hidden: crowdedOut(plates, selected) };
}

/**
 * Where a story's nameplate hangs from: on the line through the island's middle that runs straight down the
 * screen, just past the coast's lowest point, so the plate reads below its island and under it. It hangs no
 * further than `furthest` from the island's middle, so seen edge-on it stays on the globe, which hides it.
 */
export function storyPlate(coast: Coast, view: PlateView, furthest = Infinity): Point {
  // Along the plate, the way that keeps its place across the screen, turned to run down it.
  let along = { x: -view.right.z, z: view.right.x };
  const length = Math.hypot(along.x, along.z);
  const drop = (p: Point) => p.x * view.down.x + p.z * view.down.z;
  if (length < 1e-9) along = { x: 0, z: 1 };
  else along = { x: along.x / length, z: along.z / length };
  if (drop(along) < 0) along = { x: -along.x, z: -along.z };
  const points = coast.flat();
  const reach = Math.max(0, ...points.map(p => Math.hypot(p.x, p.z)));
  // Edge on, the screen barely moves down the plate: hang it no further than a few of the island's reaches.
  const lowest = Math.max(0, ...points.map(drop));
  const step = Math.min((drop(along) > 1e-9 ? Math.min(lowest / drop(along), 4 * reach) : reach) + NAMEPLATE_GAP, furthest);
  return { x: along.x * step, z: along.z * step };
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
