/** Capability 4 · The planet. Selection lanes at sea, routed on their own (contracts 4.8–4.9, 4.41–4.42, ADR-1261 D3–D4),
 * ported from 0.2's laneLayout and lane draw-on. */
import { Vector3 } from 'three';
import type { PlanetLanes, PlanetPathways } from './pathways.js';

/** At sea every lane is one solid pale sea-blue line, in and out alike (ADR-1236 D1, overtaking 0.2's teal and violet,
 * ADR-1236 D2): the capability tree mock's #8fbfd4 mixed into its sea (#17222b) at 0.78, as it shows there. */
export const SEA_LANE = '#80acbf';

export interface LitLink { from: string; to: string; dir: 'up' | 'down' }
export interface LaneRoute extends LitLink {
  /** From the dock of the island built on (`to`'s), along its own route to the dock of the island building on it: dependency order. */
  points: Vector3[];
  length: number;
  /** Across the lane at each point: wider by how many lit lanes share its stretch (`seaLaneWidth`). */
  widths: number[];
  /** The narrowest of `widths`. */
  width: number;
  colour: string;
  /** Only the code's types join the two capabilities (ADR-0991 D1); it is carried, not drawn: every lane is solid. */
  typeOnly?: true;
}

/** A lane's width in ground units alone, and the most any stretch is drawn (ADR-1261 D4): the old first and widest steps. */
const SEA_LANE_ONE = 0.32;
export const SEA_LANE_CAP = 1.15;
/** How many lit lanes sharing a stretch first draw it at the cap. */
const SEA_LANE_FULL = 64;
/** A lane's width in ground units by how many lit lanes share its stretch: rising with the square root of the count from
 * one lane's width, so every link more reads, to the cap at SEA_LANE_FULL, so the busiest trunk stays a line. */
export function seaLaneWidth(sharing: number): number {
  const rise = (Math.sqrt(Math.max(1, sharing)) - 1) / (Math.sqrt(SEA_LANE_FULL) - 1);
  return Math.min(SEA_LANE_CAP, SEA_LANE_ONE + (SEA_LANE_CAP - SEA_LANE_ONE) * rise);
}

/** Each lit link's lane between islands as one line in dependency order, from dock to dock, down the middle of its own
 * route in the lane plan (ADR-1261 D3): inland, the selected island's own roads take over (ADR-1236 D2); a link with no
 * route (one within an island) lights nothing. Lanes sharing a stretch, in and out alike, are one line there, wider by
 * how many share it. */
export function laneRoutes(plan: PlanetLanes, lit: readonly LitLink[]): LaneRoute[] {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  const selected = lit.flatMap(link => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    const chain = edge?.segments ?? [];
    return chain.length === 0 ? [] : [{ link, chain, typeOnly: edge?.typeOnly }];
  });
  const sharing = new Map<string, number>();
  for (const { chain } of selected) for (const ref of chain) sharing.set(ref.id, (sharing.get(ref.id) ?? 0) + 1);
  return selected.map(({ link, chain, typeOnly }): LaneRoute => {
    const points: Vector3[] = [], widths: number[] = [];
    // The chain runs from the building capability to the one built on; the lane runs back along it.
    for (const ref of [...chain].reverse()) {
      const segment = segments.get(ref.id)!, width = seaLaneWidth(sharing.get(ref.id)!);
      for (const point of ref.reversed ? segment.points : [...segment.points].reverse()) {
        if (points.length === 0 || points.at(-1)!.distanceTo(point) > 1e-9) {
          points.push(point);
          widths.push(width);
        }
      }
    }
    const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
    return { ...link, points, length, widths, width: Math.min(...widths), colour: SEA_LANE, ...typeOnly ? { typeOnly } : {} };
  });
}

/** The roads between islands carrying a selection's lit links: its lanes are drawn in their stead (ADR-1236 D1), so they are not. */
export function roadsUnderLanes(plan: PlanetPathways, lit: readonly LitLink[]): ReadonlySet<string> {
  const keys = new Set(lit.map(link => `${link.from}->${link.to}`));
  return new Set(plan.segments.filter(segment => segment.links.some(link => keys.has(link))).map(segment => segment.id));
}

/** Every front of a selection moves at this ground speed (ADR-1000 D1), so fronts sharing a stretch travel as one and The
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

/** A stretch of route, the same whichever way a lane walks it. */
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
