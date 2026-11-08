/** Capability 3 · Story node render. Where the globe's nameplates sit on an island's plate: the story's just south of its coast, its capabilities' on their own land. */
import { Quaternion, Vector3 } from "three";
import type { Coast, Point, TerritoryMap } from "../territories/territories.js";

/** How far past the coast a story's nameplate starts, in ground units. */
export const NAMEPLATE_GAP = 3;

/** How squarely a plate turned by `plate` (world frame) faces an eye turned by `eye`: 1 face on, 0 edge-on at the rim, below 0 turned away. */
export function facing(plate: Quaternion, eye: Quaternion): number {
  return new Vector3(0, 1, 0).applyQuaternion(plate).dot(new Vector3(0, 0, 1).applyQuaternion(eye));
}

/** Whether a plate turned by `plate` (world frame) faces an eye turned by `eye`: once its island turns away, its nameplate hides. */
export function facesEye(plate: Quaternion, eye: Quaternion): boolean {
  return facing(plate, eye) > 0;
}

/** A name's box on screen, in pixels. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** A story nameplate as the screen shows it: its box in pixels, how squarely its island faces the eye, and whether it is dimmed behind the stories in focus. */
export interface ShownPlate { story: string; box: Box; facing: number; dimmed?: boolean }

/** How wide a story's nameplate may grow, in pixels, before its title wraps: neighbours in a row of small islands then clear each other. */
export const STORY_PLATE_WIDTH = 112;

/** How far two names' boxes may run into each other, in pixels, before they overlap: a plate's rounded ends and padding, which cover no letter. */
export const NAME_OVERLAP_SLACK = 4;

const overlaps = (box: Box, other: Box) => box.left + NAME_OVERLAP_SLACK < other.right && other.left + NAME_OVERLAP_SLACK < box.right
  && box.top + NAME_OVERLAP_SLACK < other.bottom && other.top + NAME_OVERLAP_SLACK < box.bottom;


/**
 * Which story names fade where names overlap on screen (ADR-0917): no name moves off its island to clear another. The selected
 * story's shows first, then the names not dimmed, each the more squarely its island faces the eye the sooner; a name that would
 * overlap one already shown fades.
 */
export function fadedPlates(plates: readonly ShownPlate[], selected?: string): Set<string> {
  const order = [...plates].sort((a, b) => Number(b.story === selected) - Number(a.story === selected)
    || Number(a.dimmed ?? false) - Number(b.dimmed ?? false) || b.facing - a.facing);
  // Taken in order, each name shows if it clears the names already shown; the rest fade. A faded name fades no other.
  const shown: Box[] = [], faded = new Set<string>();
  for (const plate of order) {
    if (shown.some(other => overlaps(plate.box, other))) faded.add(plate.story);
    else shown.push(plate.box);
  }
  return faded;
}

/** How far a name is moved from its point, in pixels. */
export interface Move { x: number; y: number }

const moved = (box: Box, { x, y }: Move): Box => ({ left: box.left + x, right: box.right + x, top: box.top + y, bottom: box.bottom + y });

/**
 * Where the islands' capability names go where they overlap on screen: never hidden, each is moved apart. Taken from the larger
 * territory's (more cells) down, each name stays on its point if it clears the names already placed; otherwise it takes the
 * shortest move, by the side of a name in its way or a step past the next one in its way, that clears them all, and failing
 * those it steps down past the names in its way until none is. Only names in each other's way move, so a name clear of the
 * others stays on its own territory.
 */
export function spreadCapabilities(names: readonly { capability: string; box: Box; size: number }[]): Map<string, Move> {
  const placed: Box[] = [], moves = new Map<string, Move>();
  const clear = (box: Box) => !placed.some(other => overlaps(box, other));
  const inWay = (at: Box) => placed.filter(other => overlaps(at, other));
  // The moves that put `box` just past one side of `other`: within the slack, by a pixel less, so the screen's fractions of a
  // pixel never tip it back over.
  const reach = NAME_OVERLAP_SLACK - 1;
  const beside = (box: Box, other: Box): Move[] => [
    { x: 0, y: other.top + reach - box.bottom }, { x: 0, y: other.bottom - reach - box.top },
    { x: other.left + reach - box.right, y: 0 }, { x: other.right - reach - box.left, y: 0 },
  ];
  // Down past the names in its way, and again past any that is then in its way, until none is.
  const below = (box: Box): Move => {
    let y = 0;
    for (let way = inWay(box); way.length > 0; way = inWay(moved(box, { x: 0, y }))) y = Math.max(...way.map(other => other.bottom)) - reach - box.top;
    return { x: 0, y };
  };
  for (const { capability, box } of [...names].sort((a, b) => b.size - a.size)) {
    let move: Move | undefined = clear(box) ? { x: 0, y: 0 } : undefined;
    if (move === undefined) {
      // Only the names in its way, then only those in the way of where a first move put it, offer a side.
      const once = inWay(box).flatMap(other => beside(box, other));
      const twice = once.flatMap(first => {
        const at = moved(box, first);
        return inWay(at).flatMap(other => beside(at, other).map(then => ({ x: first.x + then.x, y: first.y + then.y })));
      });
      move = [...once, ...twice].filter(m => clear(moved(box, m))).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]
        ?? below(box);
    }
    placed.push(moved(box, move));
    moves.set(capability, move);
  }
  return moves;
}

/** The globe's south as it lies on a plate turned by `plate` on the unturned globe: the way to its south pole along the surface, in the plate's own ground (x, z). */
export function southOnPlate(plate: Quaternion): Point {
  const south = new Vector3(0, -1, 0).applyQuaternion(plate.clone().invert());
  const length = Math.hypot(south.x, south.z);
  // At a pole every way is south: take the plate's own +z.
  return length < 1e-9 ? { x: 0, z: 1 } : { x: south.x / length, z: south.z / length };
}

/**
 * Where a story's nameplate hangs from: one point on its island's own plate, just past the coast's southmost point on the line
 * south from the island's middle, so it reads below its island in the globe's north-up view and turns with the island, like
 * print on a map. It is never re-placed as the globe turns (ADR-0917).
 */
export function storyPlate(coast: Coast, south: Point): Point {
  const southmost = Math.max(0, ...coast.flat().map(p => p.x * south.x + p.z * south.z));
  return { x: south.x * (southmost + NAMEPLATE_GAP), z: south.z * (southmost + NAMEPLATE_GAP) };
}

/** A capability's name as the globe shows it: its stored title without the number the plan gives it ("1 · Hooks" reads "Hooks"; 3.32). */
export function globeName(title: string): string {
  return title.replace(/^\d+ · /, "");
}

/**
 * One nameplate per capability's territory, named without its number, at the seed of its cell nearest the
 * territory's middle: a seed lies inside its own cell, so the plate is on the territory's land. Unclaimed code has none.
 * Its size is the territory's count of cells, which ranks it where names overlap.
 */
export function capabilityPlates(map: TerritoryMap): { capability: string; title: string; x: number; z: number; size: number }[] {
  return map.territories.flatMap(({ capability, title }, territory) => {
    const sites = map.cells.filter(cell => cell.territory === territory).map(cell => cell.site);
    if (capability === undefined || sites.length === 0) return [];
    const middle = { x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length };
    const at = sites.reduce((best, p) => Math.hypot(p.x - middle.x, p.z - middle.z) < Math.hypot(best.x - middle.x, best.z - middle.z) ? p : best);
    return [{ capability, title: globeName(title ?? capability), x: at.x, z: at.z, size: sites.length }];
  });
}
