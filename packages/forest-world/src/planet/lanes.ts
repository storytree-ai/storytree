/** Capability 6 · The planet. Selection lanes over the globe's roads (world contracts 6.8–6.9), ported from 0.2's laneLayout and lane draw-on. */
import type { Vector3 } from 'three';
import { trailFillWidth } from '../core/routing.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import type { PlanetPathways, PlanetPathwaySegment } from './pathways.js';

/** 0.2's lane inks: what the selection builds on, and what builds on it. */
export const LANE_COLOUR = { up: '#0d8fb0', down: '#6a5fee' } as const;

export interface LitLink { from: string; to: string; dir: 'up' | 'down' }
export interface LaneRoute extends LitLink {
  /** From the dock of the island built on (`to`'s) to the dock of the island building on it (`from`'s): dependency order. */
  points: Vector3[];
  length: number;
  /** Across the lane at each point: its road's width, or just under half where an up and a down lane share the road. */
  widths: number[];
  /** The narrowest of `widths`. */
  width: number;
  colour: string;
}

/** Each of two colours sharing a road takes just under half of it, so a hairline of road parts them. */
const SHARED_WIDTH = 0.48;
/** A lane's glow spreads this many times its width, beyond the road's edge. */
export const LANE_GLOW = 2.6;
/** A dock's mark: about twice a one-link road across. */
const PIP_RADIUS = 0.96 * trailFillWidth(1) * RIBBON_GROUND_SCALE;

/** Choose the side in the segment's stored orientation, before walking it in either direction.
 * Meeting the centreline smoothly at each junction leaves every connecting strip unbroken. */
function sharedStrip(segment: PlanetPathwaySegment, dir: LitLink['dir']): Vector3[] {
  const walk = [0];
  for (let i = 1; i < segment.points.length; i++) walk.push(walk[i - 1]! + segment.points[i]!.distanceTo(segment.points[i - 1]!));
  const length = walk.at(-1)!, taper = Math.min(length / 2, segment.width * 2);
  return segment.points.map((point, i, points) => {
    if (i === 0 || i === points.length - 1 || taper === 0) return point;
    const t = Math.min(1, walk[i]! / taper, (length - walk[i]!) / taper);
    const tangent = points[Math.min(points.length - 1, i + 1)]!.clone().sub(points[Math.max(0, i - 1)]!);
    const side = point.clone().normalize().cross(tangent).normalize();
    const offset = segment.width * 0.25 * (dir === 'up' ? 1 : -1) * t * t * (3 - 2 * t);
    // Preserve the height over the globe while moving sideways across the road.
    return point.clone().addScaledVector(side, offset).normalize().multiplyScalar(point.length());
  });
}

/** Each lit link's road between islands as one strip, dock to dock in dependency order, or for a row link with no road,
 * its plain coast-to-coast lane at a one-link road's width; a link with neither (no trail, or one within an island)
 * lights nothing. */
export function laneRoutes(plan: PlanetPathways, lit: readonly LitLink[]): LaneRoute[] {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  const plain = (link: LitLink) => plan.rowLanes?.find(lane => lane.from === link.from && lane.to === link.to)?.points;
  const selected = lit.flatMap(link => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    const chain = edge?.segments ?? [];
    return chain.length === 0 && plain(link) === undefined ? [] : [{ link, chain }];
  });
  const colours = new Map<string, number>();
  for (const { link, chain } of selected) for (const ref of chain) {
    colours.set(ref.id, (colours.get(ref.id) ?? 0) | (link.dir === 'up' ? 1 : 2));
  }
  return selected.map(({ link, chain }): LaneRoute => {
    if (chain.length === 0) {
      const points = plain(link)!, width = trailFillWidth(1) * RIBBON_GROUND_SCALE;
      const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
      return { ...link, points, length, widths: points.map(() => width), width, colour: LANE_COLOUR[link.dir] };
    }
    const points: Vector3[] = [], widths: number[] = [];
    // The chain runs from the building capability to the one built on; the lane runs back along it.
    for (const ref of [...chain].reverse()) {
      const segment = segments.get(ref.id)!, shared = colours.get(ref.id) === 3;
      const along = shared ? sharedStrip(segment, link.dir) : segment.points;
      for (const point of ref.reversed ? along : [...along].reverse()) {
        if (points.length === 0 || points.at(-1)!.distanceTo(point) > 1e-9) {
          points.push(point);
          widths.push(segment.width * (shared ? SHARED_WIDTH : 1));
        }
      }
    }
    const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
    return { ...link, points, length, widths, width: Math.min(...widths), colour: LANE_COLOUR[link.dir] };
  });
}

export interface LaneEntrance {
  dir: LitLink['dir'];
  colour: string;
  /** On the coast at its dock's height; beside the other colour's mark where both use the dock. */
  point: Vector3;
  radius: number;
  /** The lanes it marks, and whether each leaves (`start`) or reaches (`end`) this dock. */
  lanes: { from: string; to: string; at: 'start' | 'end' }[];
}

/** One mark per colour at each dock a lane uses: an up and a down mark sharing a dock sit side by side across it. */
export function laneEntrances(lanes: readonly LaneRoute[]): LaneEntrance[] {
  const docks: { point: Vector3; heading: Vector3; marks: Map<LitLink['dir'], LaneEntrance> }[] = [];
  for (const lane of lanes) for (const at of ['start', 'end'] as const) {
    const points = at === 'start' ? lane.points : [...lane.points].reverse();
    const point = points[0]!, heading = points[Math.min(1, points.length - 1)]!.clone().sub(point);
    let dock = docks.find(d => d.point.distanceTo(point) < 1e-6);
    if (!dock) docks.push(dock = { point, heading: heading.clone().multiplyScalar(0), marks: new Map() });
    // Seen from the dock, a lane leaving and one arriving both head out to sea.
    dock.heading.add(heading.lengthSq() > 0 ? heading.normalize() : heading);
    const mark = dock.marks.get(lane.dir) ?? { dir: lane.dir, colour: lane.colour, point, radius: 0, lanes: [] };
    // A pip that reads as the lane's end at the globe's opening scale.
    mark.radius = PIP_RADIUS;
    mark.lanes.push({ from: lane.from, to: lane.to, at });
    dock.marks.set(lane.dir, mark);
  }
  return docks.flatMap(({ point, heading, marks }) => {
    if (marks.size === 1) return [...marks.values()];
    const side = point.clone().normalize().cross(heading).normalize();
    return [...marks.values()].map(mark => ({ ...mark,
      // The same sides as a shared trunk's strips, a hair apart, kept at the dock's height over the globe.
      point: point.clone().addScaledVector(side, mark.radius * 1.15 * (mark.dir === 'up' ? 1 : -1)).normalize().multiplyScalar(point.length()) }));
  });
}

/** A mark appears when its lane's front leaves the dock (`start`) or reaches it (`end`), not before. */
export function entranceShown(at: 'start' | 'end', progress: number): boolean {
  return at === 'start' ? progress > 0 : progress >= 1;
}

/** Longer lanes take longer, between 0.8 and 1.8 seconds: slow enough to follow, never dragging. */
export function laneDrawSeconds(length: number): number {
  return Math.min(1.8, Math.max(0.8, 0.6 + length / 300));
}

/** Rendered time keeps slow frames from swallowing a lane's whole growth in one jump. */
export function advanceLaneClock(elapsed: number, delta: number): number {
  return elapsed + Math.max(0, Math.min(0.08, delta));
}

/** Seconds after selection each lane starts, in the order given: up lanes, then down lanes, each shortest first,
 * 0.1 s apart, the whole spread kept within 1.2 s however many lanes light. */
export function laneDelays(lanes: readonly { dir: LitLink['dir']; length: number }[]): number[] {
  const order = lanes.map((lane, i) => ({ lane, i }))
    .sort((a, b) => (a.lane.dir === b.lane.dir ? 0 : a.lane.dir === 'up' ? -1 : 1) || a.lane.length - b.lane.length || a.i - b.i);
  const step = Math.min(0.1, 1.2 / Math.max(1, lanes.length - 1));
  const delays = lanes.map(() => 0);
  order.forEach(({ i }, rank) => { delays[i] = rank * step; });
  return delays;
}

/** The physical fraction drawn `elapsed` rendered seconds after selection, easing out to a stop; all at once under reduced motion. */
export function laneProgress(elapsed: number, seconds: number, reducedMotion: boolean, delay = 0): number {
  if (reducedMotion) return 1;
  const t = Math.min(1, Math.max(0, (elapsed - delay) / seconds));
  return 1 - (1 - t) ** 2;
}

/** How bright the lane's head shows: whole while the lane draws, fading over 0.4 s once it is whole; never under reduced motion. */
export function laneHead(elapsed: number, seconds: number, reducedMotion: boolean, delay = 0): number {
  if (reducedMotion || elapsed <= delay) return 0;
  return Math.min(1, Math.max(0, 1 - (elapsed - delay - seconds) / 0.4));
}

/** A road's own draw-on (6.16, 6.17, 7.4): constant speed between 0.2's bounds, so a short road still reads as motion
 * and a long one never drags. */
export function roadDrawSeconds(length: number): number {
  return Math.min(1.2, Math.max(0.28, 0.15 + length / 600));
}

/** The physical fraction of a road drawn after `elapsed` rendered seconds, at constant speed; all at once under reduced motion. */
export function roadProgress(elapsed: number, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return Math.min(1, Math.max(0, elapsed / seconds));
}
