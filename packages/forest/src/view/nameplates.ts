/** Capability 3 · Story node render. Where the globe's nameplates sit on an island's plate: the story's just south of its coast, its capabilities' on their own land. */
import { Quaternion, Vector3 } from "three";
import type { Coast, Point, TerritoryMap } from "../territories/territories.js";

/** A name on the map as drawn: the story it is on, the part it names if it is a part's, and its box in the window. */
export type DrawnName = { readonly story: string; readonly capability?: string; readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } };

/** 3.104: what the name under `cursor` names, a part's name before its story's, which it may lie over; none, off every name. */
export function nameplateAt(names: readonly DrawnName[], cursor: { x: number; y: number }): { story: string; capability?: string } | undefined {
  const under = names.filter(({ box }) => cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom);
  const named = under.find(name => name.capability !== undefined) ?? under[0];
  return named === undefined ? undefined : named.capability === undefined ? { story: named.story } : { story: named.story, capability: named.capability };
}

/** The names shown in `host`, the map's overlays: none hidden (an overlay turned away is not displayed) or faded as crowded (3.4). */
export function drawnNames(host: ParentNode): DrawnName[] {
  return [...host.querySelectorAll<HTMLElement>(".planet-nameplate")].flatMap(label => {
    const story = label.dataset.storyId ?? label.dataset.islandId;
    if (story === undefined || label.classList.contains("crowded") || !label.checkVisibility()) return [];
    const capability = label.dataset.capabilityId, box = label.getBoundingClientRect();
    return [capability === undefined ? { story, box } : { story, capability, box }];
  });
}

/** The boxes of the map's controls drawn over it in `host`, the map's overlays: the Whole map button while it shows, and the compass (3.106). */
export function mapControls(host: ParentNode): Box[] {
  return [...host.querySelectorAll<HTMLElement>(".whole-map, .sheet-compass")].map(control => control.getBoundingClientRect());
}

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


/** The part of the window the map shows in: its canvas's box, cut to the window's and ending at the story panel's left edge, `aside` pixels in from the canvas's right (3.4). */
export function mapFrame(canvas: Box, window: { width: number; height: number }, aside = 0): Box {
  return { left: Math.max(canvas.left, 0), top: Math.max(canvas.top, 0), right: Math.min(canvas.right - aside, window.width), bottom: Math.min(canvas.bottom, window.height) };
}

/** Whether a name's box runs past the map's frame by more than its rounded ends and padding: some letter is cut. */
const clipped = (box: Box, frame: Box) => box.left + NAME_OVERLAP_SLACK < frame.left || box.right - NAME_OVERLAP_SLACK > frame.right
  || box.top + NAME_OVERLAP_SLACK < frame.top || box.bottom - NAME_OVERLAP_SLACK > frame.bottom;

/**
 * Which story names fade where names overlap on screen (ADR-0917): no name moves off its island to clear another. The selected
 * story's shows first, then the names not dimmed, each the more squarely its island faces the eye the sooner; a name that would
 * overlap one already shown fades. A name the map's `frame` cuts (the rail's edge, the window's) fades too, the selected one
 * also, and crowds no other (3.4); so does one under the map's `controls` (the Whole map button, the compass: 3.106).
 */
export function fadedPlates(plates: readonly ShownPlate[], selected?: string, frame?: Box, controls: readonly Box[] = []): Set<string> {
  const order = [...plates].sort((a, b) => Number(b.story === selected) - Number(a.story === selected)
    || Number(a.dimmed ?? false) - Number(b.dimmed ?? false) || b.facing - a.facing);
  // Taken in order, each name shows if it clears the names already shown; the rest fade. A faded name fades no other.
  const shown: Box[] = [], faded = new Set<string>();
  for (const plate of order) {
    if (frame !== undefined && clipped(plate.box, frame) || controls.some(control => overlaps(plate.box, control))) faded.add(plate.story);
    else if (shown.some(other => overlaps(plate.box, other))) faded.add(plate.story);
    else shown.push(plate.box);
  }
  return faded;
}

/** How far a name is moved from its point, in pixels. */
export interface Move { x: number; y: number }

const moved = (box: Box, { x, y }: Move): Box => ({ left: box.left + x, right: box.right + x, top: box.top + y, bottom: box.bottom + y });

/** The move that takes a name the `frame` cuts just inside it, by a pixel less than the slack `clipped` allows; none for a name
 * the frame does not cut, or one wholly off the map, which shows no letter to cut. */
const inside = (box: Box, frame: Box | undefined): Move => {
  if (frame === undefined || !clipped(box, frame) || box.right <= frame.left || box.left >= frame.right || box.bottom <= frame.top || box.top >= frame.bottom) return { x: 0, y: 0 };
  const reach = NAME_OVERLAP_SLACK - 1;
  const along = (low: number, high: number, start: number, end: number) =>
    low + NAME_OVERLAP_SLACK < start ? start - reach - low : high - NAME_OVERLAP_SLACK > end ? Math.max(end + reach - high, start - reach - low) : 0;
  return { x: along(box.left, box.right, frame.left, frame.right), y: along(box.top, box.bottom, frame.top, frame.bottom) };
};

/**
 * Where the islands' capability names go where they overlap on screen: never hidden, each is moved apart. Taken from the larger
 * territory's (more cells) down, each name stays on its point if it clears the names already placed; otherwise it takes the
 * shortest move, by the side of a name in its way or a step past the next one in its way, that clears them all, and failing
 * those it steps down past the names in its way until none is. Only names in each other's way move, so a name clear of the
 * others stays on its own territory. The story names shown (`stories`) are in every name's way and never move. A name the map's
 * `frame` cuts is first moved just inside it, and its moves clear of the others keep it inside where one can; a name wholly off
 * the map stays where it is.
 */
export function spreadCapabilities(names: readonly { capability: string; box: Box; size: number }[], stories: readonly Box[] = [], frame?: Box): Map<string, Move> {
  const placed: Box[] = [...stories], moves = new Map<string, Move>();
  const clear = (box: Box) => !placed.some(other => overlaps(box, other));
  const shown = (box: Box) => frame === undefined || !clipped(box, frame);
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
  for (const { capability, box: point } of [...names].sort((a, b) => b.size - a.size)) {
    const into = inside(point, frame), box = moved(point, into);
    let move: Move | undefined = clear(box) ? { x: 0, y: 0 } : undefined;
    if (move === undefined) {
      // Only the names in its way, then only those in the way of where a first move put it, offer a side.
      const once = inWay(box).flatMap(other => beside(box, other));
      const twice = once.flatMap(first => {
        const at = moved(box, first);
        return inWay(at).flatMap(other => beside(at, other).map(then => ({ x: first.x + then.x, y: first.y + then.y })));
      });
      const clearing = [...once, ...twice].filter(m => clear(moved(box, m))).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      move = clearing.find(m => shown(moved(box, m))) ?? clearing[0] ?? below(box);
    }
    placed.push(moved(box, move));
    moves.set(capability, { x: into.x + move.x, y: into.y + move.y });
  }
  return moves;
}

/**
 * The moves to give capability names shown on screen at `box`, each having been given `given` (3.33): each is judged from its own
 * point, its box with that move taken back off, and only a name whose move changes by half a pixel or more is listed, so names
 * already apart stay still from one frame to the next. The story names shown at `stories` stay where they are, and the names
 * are moved off them and inside the map's `frame`.
 */
export function nameMoves(names: readonly { capability: string; box: Box; given: Move; size: number }[], stories: readonly Box[] = [], frame?: Box): Map<string, Move> {
  const moves = spreadCapabilities(names.map(({ capability, box, given, size }) => ({ capability, box: moved(box, { x: -given.x, y: -given.y }), size })), stories, frame);
  const changed = new Map<string, Move>();
  for (const { capability, given } of names) {
    const move = moves.get(capability)!;
    if (Math.abs(move.x - given.x) >= 0.5 || Math.abs(move.y - given.y) >= 0.5) changed.set(capability, move);
  }
  return changed;
}

/** Which story names fade (`fadedPlates`, within the map's `frame` and off its `controls`), and the moves that take the capability
 * names shown off each other, off the map's controls (3.106) and off the story names that still show, never off one faded, and
 * inside the frame where it cuts one (3.33). */
export function crowdedNames(stories: readonly ShownPlate[], selected: string | undefined, names: Parameters<typeof nameMoves>[0], frame?: Box, controls: readonly Box[] = []): { faded: Set<string>; moves: Map<string, Move> } {
  const faded = fadedPlates(stories, selected, frame, controls);
  return { faded, moves: nameMoves(names, [...controls, ...stories.filter(plate => !faded.has(plate.story)).map(plate => plate.box)], frame) };
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
