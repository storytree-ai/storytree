/** Capability 4 · The planet. Selection lanes over the globe's roads (contracts 4.8–4.9), ported from 0.2's laneLayout and lane draw-on. */
import { Vector3 } from 'three';
import type { CoastPoint } from '../coast-clip.js';
import { trailFillWidth } from '../core/routing.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import { onIslandSurface } from './island-surface.js';
import type { PlanetPathways, PlanetPathwaySegment } from './pathways.js';
import { plateTransform, type PlanetSpot } from './planet.js';

/** 0.2's lane inks: what the selection builds on, and what builds on it. */
export const LANE_COLOUR = { up: '#0d8fb0', down: '#6a5fee' } as const;

export interface LitLink { from: string; to: string; dir: 'up' | 'down' }
export interface LaneRoute extends LitLink {
  /** From `to`'s territory on the island built on, through its dock, along the road to the dock of the island building
   * on it and on to `from`'s territory: dependency order. */
  points: Vector3[];
  length: number;
  /** Across the lane at each point: the thread's width, or just under half its road where an up and a down lane share
   * one narrower than two threads. */
  widths: number[];
  /** The narrowest of `widths`. */
  width: number;
  colour: string;
  /** Only the code's types join the two capabilities (ADR-0991 D1); it is carried, not drawn: every lane is solid. */
  typeOnly?: true;
}

/** A dock a lane uses, as the host's way inland starts from it. */
export interface LaneDock { story: string; local: CoastPoint; point: Vector3 }
/** The way inland from `dock` to `capability`'s territory, on the globe, starting on the dock; none where it ends there. */
export type InlandWay = (dock: LaneDock, capability: string) => readonly Vector3[] | undefined;

/** A lane is a thread of one width wherever it runs, laid down the middle of its road and on along the borders inland:
 * two thirds of a road one link uses, so the road shows either side of it (by the owner's direction, 2026-10-12). */
export const THREAD_WIDTH = trailFillWidth(1) * RIBBON_GROUND_SCALE * 2 / 3;
/** The farthest apart two points of a way inland are, in ground units, so its straight pieces stay on the land. */
const INLAND_STEP = 1;

/** A way inland given in an island's own ground coordinates (`local`, starting on its dock), laid on the island as
 * the globe draws it at `spot`, every step at most a unit long. */
export function onIsland(local: readonly CoastPoint[], spot: PlanetSpot, radius: number, lift = 0): Vector3[] {
  const transform = plateTransform(spot, radius, lift), at = new Vector3(...transform.position), surface = onIslandSurface(radius);
  const fine = local.flatMap((p, i) => {
    if (i === 0) return [p];
    const a = local[i - 1]!, steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / INLAND_STEP));
    return Array.from({ length: steps }, (_, j) => ({ x: a.x + (p.x - a.x) * (j + 1) / steps, z: a.z + (p.z - a.z) * (j + 1) / steps }));
  });
  return fine.map(p => surface(p).applyQuaternion(transform.quaternion).add(at));
}

/** Each of two colours sharing a road takes just under half of it, so a hairline of road parts them. */
const SHARED_WIDTH = 0.48;
/** A lane's glow spreads this many times its width, beyond the road's edge. */
export const LANE_GLOW = 2.6;
/** A lane end's mark: about twice a one-link road across. */
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

/** Each lit link's road between islands as one strip in dependency order, continued at each end along `inland`'s way
 * to its capability's territory (ADR-0991 D4); a link with no trail (one within an island) lights nothing. */
export function laneRoutes(plan: PlanetPathways, lit: readonly LitLink[], inland?: InlandWay): LaneRoute[] {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  const selected = lit.flatMap(link => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    const chain = edge?.segments ?? [];
    return chain.length === 0 ? [] : [{ link, chain, typeOnly: edge?.typeOnly }];
  });
  const colours = new Map<string, number>();
  for (const { link, chain } of selected) for (const ref of chain) {
    colours.set(ref.id, (colours.get(ref.id) ?? 0) | (link.dir === 'up' ? 1 : 2));
  }
  const way = (end: Vector3, capability: string): Vector3[] => {
    const dock = inland && plan.docks.find(d => d.point.distanceTo(end) < 1e-6);
    return dock ? [...inland!(dock, capability) ?? []].slice(1) : [];
  };
  return selected.map(({ link, chain, typeOnly }): LaneRoute => {
    const points: Vector3[] = [], widths: number[] = [];
    // The chain runs from the building capability to the one built on; the lane runs back along it.
    for (const ref of [...chain].reverse()) {
      const segment = segments.get(ref.id)!, shared = colours.get(ref.id) === 3;
      const along = shared ? sharedStrip(segment, link.dir) : segment.points;
      for (const point of ref.reversed ? along : [...along].reverse()) {
        if (points.length === 0 || points.at(-1)!.distanceTo(point) > 1e-9) {
          points.push(point);
          widths.push(Math.min(THREAD_WIDTH, segment.width * (shared ? SHARED_WIDTH : 1)));
        }
      }
    }
    const [into, outOf] = [way(points[0]!, link.to).reverse(), way(points.at(-1)!, link.from)];
    points.unshift(...into); widths.unshift(...into.map(() => THREAD_WIDTH));
    points.push(...outOf); widths.push(...outOf.map(() => THREAD_WIDTH));
    const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
    return { ...link, points, length, widths, width: Math.min(...widths), colour: LANE_COLOUR[link.dir], ...typeOnly ? { typeOnly } : {} };
  });
}

export interface LaneEntrance {
  dir: LitLink['dir'];
  colour: string;
  /** At a lane's end: in its capability's territory, or on the coast at its dock where it has no way inland; beside the
   * other colour's mark where both end there. */
  point: Vector3;
  radius: number;
  /** The lanes it marks, and whether each leaves (`start`) or reaches (`end`) this end. */
  lanes: { from: string; to: string; at: 'start' | 'end' }[];
}

/** One mark per colour at each place a lane ends: an up and a down mark sharing one sit side by side across it. */
export function laneEntrances(lanes: readonly LaneRoute[]): LaneEntrance[] {
  const docks: { point: Vector3; heading: Vector3; marks: Map<LitLink['dir'], LaneEntrance> }[] = [];
  for (const lane of lanes) for (const at of ['start', 'end'] as const) {
    const points = at === 'start' ? lane.points : [...lane.points].reverse();
    const point = points[0]!, heading = points[Math.min(1, points.length - 1)]!.clone().sub(point);
    let dock = docks.find(d => d.point.distanceTo(point) < 1e-6);
    if (!dock) docks.push(dock = { point, heading: heading.clone().multiplyScalar(0), marks: new Map() });
    // Seen from where they end, a lane leaving and one arriving both head the same way along it.
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
      // The same sides as a shared trunk's strips, a hair apart, kept at the end's height over the globe.
      point: point.clone().addScaledVector(side, mark.radius * 1.15 * (mark.dir === 'up' ? 1 : -1)).normalize().multiplyScalar(point.length()) }));
  });
}

/** A mark appears when its lane's front leaves its start (`start`) or reaches its end (`end`), not before. */
export function entranceShown(at: 'start' | 'end', progress: number): boolean {
  return at === 'start' ? progress > 0 : progress >= 1;
}

/** Every front of a selection moves at this ground speed (ADR-1000 D1), so fronts sharing a road travel as one and The
 * library's lanes on storytree's own plan settle in about three seconds. */
export const LANE_SPEED = 250;

/** A lane's time: its length at the one pace, so the selection settles in its longest lane's time however many light. */
export function laneDrawSeconds(length: number): number {
  return length / LANE_SPEED;
}

/** Rendered time keeps slow frames from swallowing a lane's whole growth in one jump. */
export function advanceLaneClock(elapsed: number, delta: number): number {
  return elapsed + Math.max(0, Math.min(0.08, delta));
}

/** The physical fraction drawn `elapsed` rendered seconds after selection, every lane starting then and keeping the one
 * pace; all at once under reduced motion. */
export function laneProgress(elapsed: number, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion || seconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / seconds));
}

/** Where along a lane (from, to, in ground units) its head shows. */
export type HeadRange = readonly [number, number];

/** A stretch of route, the same whichever way a lane walks it, kept apart by colour. */
const stretchKey = (colour: string, a: Vector3, b: Vector3) => {
  const at = (p: Vector3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
  return [colour, ...[at(a), at(b)].sort()].join('|');
};

/** One head per shared stretch (ADR-1000 D1): each stretch of route of one colour is led by the lane whose front reaches it
 * first (lanes start together and keep one pace, so the nearest along its own route), ties going to the lowest
 * `from->to`; each lane's head shows only along the stretches it leads, so a wave splits at a fork and merges at a join. */
export function laneHeads(lanes: readonly Pick<LaneRoute, 'from' | 'to' | 'colour' | 'points'>[]): HeadRange[][] {
  const walks = lanes.map(lane => {
    const distances = [0];
    for (let i = 1; i < lane.points.length; i++) distances.push(distances[i - 1]! + lane.points[i]!.distanceTo(lane.points[i - 1]!));
    return distances;
  });
  const name = (i: number) => `${lanes[i]!.from}->${lanes[i]!.to}`;
  const leaders = new Map<string, { lane: number; reaches: number }>();
  lanes.forEach((lane, l) => lane.points.slice(1).forEach((point, i) => {
    const key = stretchKey(lane.colour, lane.points[i]!, point), reaches = walks[l]![i]!, leader = leaders.get(key);
    if (!leader || reaches < leader.reaches - 1e-9 || (Math.abs(reaches - leader.reaches) <= 1e-9 && name(l) < name(leader.lane))) {
      leaders.set(key, { lane: l, reaches });
    }
  }));
  return lanes.map((lane, l) => {
    const ranges: [number, number][] = [];
    lane.points.slice(1).forEach((point, i) => {
      if (leaders.get(stretchKey(lane.colour, lane.points[i]!, point))!.lane !== l) return;
      const [from, to] = [walks[l]![i]!, walks[l]![i + 1]!], last = ranges.at(-1);
      if (last && Math.abs(last[1] - from) < 1e-9) last[1] = to;
      else ranges.push([from, to]);
    });
    return ranges;
  });
}

/** Ground units over which a head grows in as its front enters a stretch it leads, and dims as it leaves one. */
const HEAD_FADE = 3;

/** How bright a lane's head shows `elapsed` rendered seconds after selection: along the stretches it leads (`heads`),
 * growing in and dimming over a few ground units at their ends, then fading over 0.4 s once the lane is whole; never
 * under reduced motion. */
export function laneHead(elapsed: number, length: number, heads: readonly HeadRange[], reducedMotion: boolean): number {
  if (reducedMotion || elapsed <= 0) return 0;
  const front = Math.min(length, elapsed * LANE_SPEED);
  const led = Math.max(0, ...heads.map(([from, to]) => from > 0 && front < from ? 0
    : Math.min(from > 0 ? (front - from) / HEAD_FADE : 1, 1 - (front - to) / HEAD_FADE, 1)));
  return led * Math.min(1, Math.max(0, 1 - (elapsed - laneDrawSeconds(length)) / 0.4));
}

/** A road's own draw-on (11.16, 11.17, 12.4): constant speed between 0.2's bounds, so a short road still reads as motion
 * and a long one never drags. */
export function roadDrawSeconds(length: number): number {
  return Math.min(1.2, Math.max(0.28, 0.15 + length / 600));
}

/** The physical fraction of a road drawn after `elapsed` rendered seconds, at constant speed; all at once under reduced motion. */
export function roadProgress(elapsed: number, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return Math.min(1, Math.max(0, elapsed / seconds));
}
