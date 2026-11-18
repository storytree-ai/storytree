// Capability 3 · Story node render
import { Quaternion, Vector3 } from "three";
import type { Coast, Point, TerritoryMap } from "../territories/territories.js";

export type DrawnName = { readonly story: string; readonly capability?: string; readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } };

export function nameplateAt(names: readonly DrawnName[], cursor: { x: number; y: number }): { story: string; capability?: string } | undefined {
  const under = names.filter(({ box }) => cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom);
  const named = under.find(name => name.capability !== undefined) ?? under[0];
  return named === undefined ? undefined : named.capability === undefined ? { story: named.story } : { story: named.story, capability: named.capability };
}

export function drawnNames(host: ParentNode): DrawnName[] {
  return [...host.querySelectorAll<HTMLElement>(".planet-nameplate")].flatMap(label => {
    const story = label.dataset.storyId ?? label.dataset.islandId;
    if (story === undefined || label.classList.contains("crowded") || !label.checkVisibility()) return [];
    const capability = label.dataset.capabilityId, box = label.getBoundingClientRect();
    return [capability === undefined ? { story, box } : { story, capability, box }];
  });
}

export function mapControls(host: ParentNode): Box[] {
  return [...host.querySelectorAll<HTMLElement>(".whole-map, .sheet-compass")].map(control => control.getBoundingClientRect());
}

export const NAMEPLATE_GAP = 3;

export function facing(plate: Quaternion, eye: Quaternion): number {
  return new Vector3(0, 1, 0).applyQuaternion(plate).dot(new Vector3(0, 0, 1).applyQuaternion(eye));
}

export function facesEye(plate: Quaternion, eye: Quaternion): boolean {
  return facing(plate, eye) > 0;
}

export interface Box { left: number; top: number; right: number; bottom: number }

export interface ShownPlate { story: string; box: Box; facing: number; dimmed?: boolean }

export const STORY_PLATE_WIDTH = 112;

export const NAME_OVERLAP_SLACK = 4;

const overlaps = (box: Box, other: Box) => box.left + NAME_OVERLAP_SLACK < other.right && other.left + NAME_OVERLAP_SLACK < box.right
  && box.top + NAME_OVERLAP_SLACK < other.bottom && other.top + NAME_OVERLAP_SLACK < box.bottom;


export function mapFrame(canvas: Box, window: { width: number; height: number }, aside = 0): Box {
  return { left: Math.max(canvas.left, 0), top: Math.max(canvas.top, 0), right: Math.min(canvas.right - aside, window.width), bottom: Math.min(canvas.bottom, window.height) };
}

const clipped = (box: Box, frame: Box) => box.left + NAME_OVERLAP_SLACK < frame.left || box.right - NAME_OVERLAP_SLACK > frame.right
  || box.top + NAME_OVERLAP_SLACK < frame.top || box.bottom - NAME_OVERLAP_SLACK > frame.bottom;

export function fadedPlates(plates: readonly ShownPlate[], selected?: string, frame?: Box, controls: readonly Box[] = []): Set<string> {
  const order = [...plates].sort((a, b) => Number(b.story === selected) - Number(a.story === selected)
    || Number(a.dimmed ?? false) - Number(b.dimmed ?? false) || b.facing - a.facing);
  const shown: Box[] = [], faded = new Set<string>();
  for (const plate of order) {
    if (frame !== undefined && clipped(plate.box, frame) || controls.some(control => overlaps(plate.box, control))) faded.add(plate.story);
    else if (shown.some(other => overlaps(plate.box, other))) faded.add(plate.story);
    else shown.push(plate.box);
  }
  return faded;
}

export interface Move { x: number; y: number }

const moved = (box: Box, { x, y }: Move): Box => ({ left: box.left + x, right: box.right + x, top: box.top + y, bottom: box.bottom + y });

const inside = (box: Box, frame: Box | undefined): Move => {
  if (frame === undefined || !clipped(box, frame) || box.right <= frame.left || box.left >= frame.right || box.bottom <= frame.top || box.top >= frame.bottom) return { x: 0, y: 0 };
  const reach = NAME_OVERLAP_SLACK - 1;
  const along = (low: number, high: number, start: number, end: number) =>
    low + NAME_OVERLAP_SLACK < start ? start - reach - low : high - NAME_OVERLAP_SLACK > end ? Math.max(end + reach - high, start - reach - low) : 0;
  return { x: along(box.left, box.right, frame.left, frame.right), y: along(box.top, box.bottom, frame.top, frame.bottom) };
};

export function spreadCapabilities(names: readonly { capability: string; box: Box; size: number }[], stories: readonly Box[] = [], frame?: Box): Map<string, Move> {
  const placed: Box[] = [...stories], moves = new Map<string, Move>();
  const clear = (box: Box) => !placed.some(other => overlaps(box, other));
  const shown = (box: Box) => frame === undefined || !clipped(box, frame);
  const inWay = (at: Box) => placed.filter(other => overlaps(at, other));
  const reach = NAME_OVERLAP_SLACK - 1;
  const beside = (box: Box, other: Box): Move[] => [
    { x: 0, y: other.top + reach - box.bottom }, { x: 0, y: other.bottom - reach - box.top },
    { x: other.left + reach - box.right, y: 0 }, { x: other.right - reach - box.left, y: 0 },
  ];
  const below = (box: Box): Move => {
    let y = 0;
    for (let way = inWay(box); way.length > 0; way = inWay(moved(box, { x: 0, y }))) y = Math.max(...way.map(other => other.bottom)) - reach - box.top;
    return { x: 0, y };
  };
  for (const { capability, box: point } of [...names].sort((a, b) => b.size - a.size)) {
    const into = inside(point, frame), box = moved(point, into);
    let move: Move | undefined = clear(box) ? { x: 0, y: 0 } : undefined;
    if (move === undefined) {
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

export function nameMoves(names: readonly { capability: string; box: Box; given: Move; size: number }[], stories: readonly Box[] = [], frame?: Box): Map<string, Move> {
  const moves = spreadCapabilities(names.map(({ capability, box, given, size }) => ({ capability, box: moved(box, { x: -given.x, y: -given.y }), size })), stories, frame);
  const changed = new Map<string, Move>();
  for (const { capability, given } of names) {
    const move = moves.get(capability)!;
    if (Math.abs(move.x - given.x) >= 0.5 || Math.abs(move.y - given.y) >= 0.5) changed.set(capability, move);
  }
  return changed;
}

export function crowdedNames(stories: readonly ShownPlate[], selected: string | undefined, names: Parameters<typeof nameMoves>[0], frame?: Box, controls: readonly Box[] = []): { faded: Set<string>; moves: Map<string, Move> } {
  const faded = fadedPlates(stories, selected, frame, controls);
  return { faded, moves: nameMoves(names, [...controls, ...stories.filter(plate => !faded.has(plate.story)).map(plate => plate.box)], frame) };
}

export function southOnPlate(plate: Quaternion): Point {
  const south = new Vector3(0, -1, 0).applyQuaternion(plate.clone().invert());
  const length = Math.hypot(south.x, south.z);
  return length < 1e-9 ? { x: 0, z: 1 } : { x: south.x / length, z: south.z / length };
}

export function storyPlate(coast: Coast, south: Point): Point {
  const southmost = Math.max(0, ...coast.flat().map(p => p.x * south.x + p.z * south.z));
  return { x: south.x * (southmost + NAMEPLATE_GAP), z: south.z * (southmost + NAMEPLATE_GAP) };
}

export function globeName(title: string): string {
  return title.replace(/^\d+ · /, "");
}

export function capabilityPlates(map: TerritoryMap): { capability: string; title: string; x: number; z: number; size: number }[] {
  return map.territories.flatMap(({ capability, title }, territory) => {
    const sites = map.cells.filter(cell => cell.territory === territory).map(cell => cell.site);
    if (capability === undefined || sites.length === 0) return [];
    const middle = { x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length };
    const at = sites.reduce((best, p) => Math.hypot(p.x - middle.x, p.z - middle.z) < Math.hypot(best.x - middle.x, best.z - middle.z) ? p : best);
    return [{ capability, title: globeName(title ?? capability), x: at.x, z: at.z, size: sites.length }];
  });
}
