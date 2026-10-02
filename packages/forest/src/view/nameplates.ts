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

/** A story nameplate as the screen shows it: its box in pixels where it hangs, before any displacement, and how squarely its island faces the eye. */
export interface ShownPlate { story: string; box: { left: number; top: number; right: number; bottom: number }; facing: number }

/** How wide a story's nameplate may grow, in pixels, before its title wraps: neighbours in a row of small islands then clear each other a slot apart. */
export const STORY_PLATE_WIDTH = 112;

/** The space left between a plate and the one it steps below, in pixels. */
export const PLATE_STEP_GAP = 3;

/** The furthest a plate steps from its resting position to clear other names, in pixels; past it, it is hidden. */
export const MAX_DROP = 140;

/**
 * How the story nameplates on screen settle so that no two overlap. Taken one at a time, each plate stays where
 * it hangs if it clears the plates already settled, or else steps down the screen just below the ones it would
 * overlap, by the least drop that clears them all. Three orders are tried: the more squarely faced first (so the
 * more edge-on steps), west to east, and every other plate west to east before the rest (so a row of small
 * islands zigzags in two lines rather than a staircase); the one that hides fewer, and then steps less in all, is kept.
 * The selected story's plate always goes first. The Sessions strip lifts a plate's resting position just above its top edge; if stepping down to
 * clear another name would cross that edge, it steps above the other instead. The selected plate stays at
 * its (possibly lifted) resting position. Only collision clearance beyond MAX_DROP hides a plate.
 * Boxes are measured before any displacement, so a displacement never feeds back on itself.
 */
export function settlePlates(plates: readonly ShownPlate[], selected?: string, strip?: ShownPlate["box"]): { drops: Map<string, number>; hidden: Set<string> } {
  const first = (a: ShownPlate, b: ShownPlate) => Number(b.story === selected) - Number(a.story === selected);
  const west = (a: ShownPlate, b: ShownPlate) => a.box.left - b.box.left || b.facing - a.facing;
  const along = new Map([...plates].sort(west).map((plate, i) => [plate, i]));
  const tries = [
    (a: ShownPlate, b: ShownPlate) => b.facing - a.facing,
    west,
    (a: ShownPlate, b: ShownPlate) => along.get(a)! % 2 - along.get(b)! % 2 || west(a, b),
  ].map(order => settleInOrder([...plates].sort((a, b) => first(a, b) || order(a, b)), selected, strip));
  const stepped = ({ drops }: { drops: Map<string, number> }) => [...drops.values()].reduce((sum, drop) => sum + Math.abs(drop), 0);
  return tries.reduce((best, next) => next.hidden.size < best.hidden.size || (next.hidden.size === best.hidden.size && stepped(next) < stepped(best)) ? next : best);
}

function settleInOrder(order: readonly ShownPlate[], selected?: string, strip?: ShownPlate["box"]): { drops: Map<string, number>; hidden: Set<string> } {
  const settled: ShownPlate["box"][] = [], drops = new Map<string, number>(), hidden = new Set<string>();
  const overlaps = (box: ShownPlate["box"], other: ShownPlate["box"]) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
  for (const { story, box } of order) {
    const ceiling = strip !== undefined && box.left < strip.right && strip.left < box.right
      ? strip.top - PLATE_STEP_GAP - box.bottom : Infinity;
    const rest = Math.min(0, ceiling);
    const clears = (drop: number) => drop <= ceiling && Math.abs(drop - rest) <= MAX_DROP
      && (drop === rest || story !== selected)
      && !settled.some(other => overlaps({ ...box, top: box.top + drop, bottom: box.bottom + drop }, other));
    const down = [rest, ...settled.map(other => other.bottom + PLATE_STEP_GAP - box.top)]
      .filter(drop => drop >= rest).sort((a, b) => a - b);
    const above = ceiling === Infinity ? [] : settled.map(other => other.top - PLATE_STEP_GAP - box.bottom)
      .filter(drop => drop < rest).sort((a, b) => b - a);
    const drop = down.find(clears) ?? above.find(clears);
    if (drop === undefined) { hidden.add(story); continue; }
    if (drop !== 0) drops.set(story, drop);
    settled.push({ ...box, top: box.top + drop, bottom: box.bottom + drop });
  }
  return { drops, hidden };
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
