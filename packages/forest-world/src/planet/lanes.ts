/** Capability 4 · The planet. Lanes at sea, routed on their own: fine dotted strands at rest, a selection's share filled
 * (contracts 4.8–4.9, 4.41–4.42, 4.44, ADR-1261 D3–D4, ADR-1278), ported from 0.2's laneLayout and lane draw-on. */
import { Vector3 } from 'three';
import type { PlanetLanes } from './pathways.js';

/** At sea every lane is one solid pale sea-blue line, in and out alike (ADR-1236 D1, overtaking 0.2's teal and violet,
 * ADR-1236 D2): the capability tree mock's #8fbfd4 mixed into its sea (#17222b) at 0.78, as it shows there. */
export const SEA_LANE = '#80acbf';
/** A selected story's share of a stretch is filled solid in this pale blue (ADR-1278 D2: the mocks' fill, picked as C2). */
export const SEA_LANE_FILL = '#d2ecf5';

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
  /** The two islands it joins, by story: it shows once both have risen (4.33). */
  islands: readonly [string, string];
}

/** A lane's width in ground units alone, and the most any stretch is drawn (ADR-1261 D4): the old first and widest steps. */
export const SEA_LANE_ONE = 0.32;
export const SEA_LANE_CAP = 1.15;
/** How many lit lanes sharing a stretch first draw it at the cap. */
const SEA_LANE_FULL = 64;
/** A lane's width in ground units by how many lit lanes share its stretch: rising with the square root of the count from
 * one lane's width, so every link more reads, to the cap at SEA_LANE_FULL, so the busiest trunk stays a line. */
export function seaLaneWidth(sharing: number): number {
  const rise = (Math.sqrt(Math.max(1, sharing)) - 1) / (Math.sqrt(SEA_LANE_FULL) - 1);
  return Math.min(SEA_LANE_CAP, SEA_LANE_ONE + (SEA_LANE_CAP - SEA_LANE_ONE) * rise);
}

/** The chart dots at rest (ADR-1278 D1 as ADR-1307 narrows it): each dot's size against one lane's width,
 * whatever shares its stretch, the distance between dots against their size, and how opaque they are, dimmed by `dim`
 * under a selection. */
export const LANE_DOTS = { size: 0.5, pitch: 3.1, opacity: 0.75, dim: 0.7 } as const;

/** A stretch shared by several lanes at rest is drawn as that many dotted strands side by side, up to `cap` of them, the
 * lanes above it carried by brighter dots (`restLanes`); strands lie `gap` lane widths apart and fan in over `fan` lane
 * widths at each end of the stretch, where its lanes join their neighbours' strands or come ashore; every second strand's
 * dots fall half their spacing along, between its neighbours'. */
export const LANE_STRANDS = { cap: 4, gap: 1.1, fan: 9 } as const;

/** The fewest pixels one lane is drawn across, as the picked mock draws it (ADR-1278 D3): zoomed out past it, every lane
 * size scales up together. */
export const LANE_MIN_PX = 4.5;

/** How much every lane size (the dots and the fills alike) is scaled when ground units are `worldPerPixel` on screen: 1
 * while one lane is at least about LANE_MIN_PX across, else the power of two nearest to bringing it there, so the dots
 * keep their places while the view zooms within a step and every second one stays at the next. */
export function laneScale(worldPerPixel: number): number {
  const want = LANE_MIN_PX * worldPerPixel / SEA_LANE_ONE;
  return want > 1 && Number.isFinite(want) ? Math.max(1, 2 ** Math.round(Math.log2(want))) : 1;
}

export interface RestStretch {
  /** The lane plan's segment it dots. */
  id: string;
  /** Each dot's diameter in ground units: one lane's dot, whatever shares the stretch. */
  size: number;
  /** How many dotted strands it is drawn as: one a lane riding it, up to LANE_STRANDS.cap. */
  strands: number;
  /** The lanes each strand carries, by link, strand by strand from − to + across the route. */
  carries: string[][];
  /** How much brighter its dots are, 0 to 1, for the lanes riding it above the cap: rising with the square root of
   * their count, full at SEA_LANE_FULL. */
  bright: number;
  /** Where each dot lies on its stretch's route, the way along the route there, its strand's place across the route at
   * full spread (ground units at the lanes' own size, + on the side of `at` × `along`), and how far it lies from the
   * stretch's two ends, by which its strand fans in (`strandSpread`). */
  dots: { at: Vector3; along: Vector3; across: number; ends: readonly [number, number] }[];
  /** The islands of each lane riding it, by story. */
  islands: (readonly [string, string])[];
}

/** How far out of its stretch's middle a strand is drawn, 0 to 1 of its full place, `ends` from the stretch's two ends,
 * every lane size scaled by `scale` (`laneScale`): in, at an end, so a stretch's strands meet its neighbours' and their
 * port, and out over LANE_STRANDS.fan lane widths, easing both ways. The dots' shader draws the same. */
export function strandSpread(ends: readonly [number, number], scale = 1): number {
  const t = Math.min(1, Math.max(0, Math.min(...ends) / (LANE_STRANDS.fan * SEA_LANE_ONE * scale)));
  return t * t * (3 - 2 * t);
}

/** Every lane at rest, with nothing selected (ADR-1278 D1 as ADR-1307 narrows it, ADR-1276 D1): each stretch of the
 * merged routes once, as fine round dots of one lane's size spaced about three times their size apart, one dotted strand
 * a lane riding it side by side across the route, up to LANE_STRANDS.cap strands, the lanes above it brightening the
 * dots. Each lane keeps to the side of the stretch its route leaves by at either end, so strands fan out where lanes
 * part without crossing. */
export function restLanes(plan: PlanetLanes): RestStretch[] {
  const islands = new Map(plan.edges.map(edge => [`${edge.from}->${edge.to}`, edge.islands]));
  const chains = new Map(plan.edges.map(edge => [`${edge.from}->${edge.to}`, edge.segments.map(ref => ref.id)]));
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  const size = SEA_LANE_ONE * LANE_DOTS.size;
  return plan.segments.flatMap(segment => {
    const points = segment.points;
    const walk = [0];
    for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + points[i]!.distanceTo(points[i - 1]!));
    const length = walk.at(-1)!;
    if (!(length > 0)) return [];
    // Which side each lane leaves by: towards the far end of the neighbouring stretch it rides on from either end.
    const ends = [[points[0]!, points[1]!.clone().sub(points[0]!)], [points.at(-1)!, points.at(-1)!.clone().sub(points.at(-2)!)]] as const;
    const side = (lane: string) => {
      const chain = chains.get(lane) ?? [], at = chain.indexOf(segment.id);
      return [chain[at - 1], chain[at + 1]].reduce((sum, id) => {
        const next = id === undefined ? undefined : segments.get(id);
        if (!next) return sum;
        return sum + ends.reduce((total, [end, along]) => {
          const near = next.points[0]!.distanceTo(end) < 1e-3 ? next.points : next.points.at(-1)!.distanceTo(end) < 1e-3 ? [...next.points].reverse() : undefined;
          if (!near) return total;
          const away = near[Math.min(near.length - 1, 4)]!.clone().sub(end).normalize();
          return total + end.clone().normalize().cross(along).normalize().dot(away);
        }, 0);
      }, 0);
    };
    const lanes = segment.links.map(link => ({ link, side: side(link) })).sort((a, b) => a.side - b.side || (a.link < b.link ? -1 : 1));
    const strands = Math.max(1, Math.min(LANE_STRANDS.cap, lanes.length));
    const carries = Array.from({ length: strands }, (_, strand) => lanes.slice(Math.round(strand * lanes.length / strands), Math.round((strand + 1) * lanes.length / strands)).map(lane => lane.link));
    const count = Math.max(1, Math.round(length / (size * LANE_DOTS.pitch))), dots: RestStretch['dots'] = [];
    for (let strand = 0; strand < strands; strand++) {
      const across = (strand - (strands - 1) / 2) * LANE_STRANDS.gap * SEA_LANE_ONE;
      for (let k = 0, i = 1; k < count; k++) {
        // Every second strand's dots fall between its neighbours', so side by side they read as lines, not rungs.
        const distance = Math.min(length, (k + 0.5 + (strand % 2) / 2) * length / count);
        while (i < points.length - 1 && walk[i]! < distance) i++;
        const a = points[i - 1]!, b = points[i]!, t = (distance - walk[i - 1]!) / (walk[i]! - walk[i - 1]! || 1);
        dots.push({ at: a.clone().lerp(b, t), along: b.clone().sub(a).normalize(), across, ends: [distance, length - distance] });
      }
    }
    const bright = Math.min(1, Math.max(0, (Math.sqrt(lanes.length) - Math.sqrt(LANE_STRANDS.cap)) / (Math.sqrt(SEA_LANE_FULL) - Math.sqrt(LANE_STRANDS.cap))));
    return [{ id: segment.id, size, strands, carries, bright, dots, islands: segment.links.flatMap(link => islands.has(link) ? [islands.get(link)!] : []) }];
  });
}

/** Whether a stretch shows in a recorded growth (4.33): once both islands of a lane riding it have risen. */
export function restShown(stretch: Pick<RestStretch, 'islands'>, island: (story: string) => number): boolean {
  return stretch.islands.some(lane => laneShown({ islands: lane }, island));
}

/** Each lit link's lane between islands as one line in dependency order, from dock to dock, down the middle of its own
 * route in the lane plan (ADR-1261 D3): inland, the selected island's own roads take over (ADR-1236 D2); a link with no
 * route (one within an island) lights nothing. Lanes sharing a stretch, in and out alike, are one line there, wider by
 * how many share it: the selected story's share of the stretch, filled solid (ADR-1278 D2). */
export function laneRoutes(plan: PlanetLanes, lit: readonly LitLink[]): LaneRoute[] {
  const selected = lit.flatMap(link => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    const chain = edge?.segments ?? [];
    return chain.length === 0 ? [] : [{ link, chain, typeOnly: edge?.typeOnly, islands: edge!.islands }];
  });
  const sharing = new Map<string, number>();
  for (const { chain } of selected) for (const ref of chain) sharing.set(ref.id, (sharing.get(ref.id) ?? 0) + 1);
  return selected.map(({ link, chain, typeOnly, islands }): LaneRoute => {
    // The chain runs from the building capability to the one built on; the lane runs back along it.
    const line = alongChain(plan, [...chain].reverse().map(ref => ({ ...ref, reversed: !ref.reversed })), sharing);
    return { ...link, ...line, colour: SEA_LANE_FILL, islands, ...typeOnly ? { typeOnly } : {} };
  });
}

/** One line along `chain` (each segment walked forwards, or backwards where `reversed`), as wide at each point as
 * `sharing` lit lanes share its segment. */
export function alongChain(plan: Pick<PlanetLanes, 'segments'>, chain: readonly { id: string; reversed: boolean }[], sharing: ReadonlyMap<string, number>): { points: Vector3[]; widths: number[]; length: number; width: number } {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  const points: Vector3[] = [], widths: number[] = [];
  for (const ref of chain) {
    const segment = segments.get(ref.id)!, width = seaLaneWidth(sharing.get(ref.id) ?? 1);
    for (const point of ref.reversed ? [...segment.points].reverse() : segment.points) {
      if (points.length === 0 || points.at(-1)!.distanceTo(point) > 1e-9) {
        points.push(point);
        widths.push(width);
      }
    }
  }
  const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
  return { points, widths, length, width: Math.min(...widths) };
}

/** How far along a lane is drawn `elapsed` rendered seconds after selection (`laneProgress`), and nothing while it is not
 * shown in a recorded growth (4.33). */
export function laneDrawn(lane: Pick<LaneRoute, 'islands'>, island: (story: string) => number, elapsed: number, seconds: number, reducedMotion: boolean): number {
  return laneShown(lane, island) ? laneProgress(elapsed, seconds, reducedMotion) : 0;
}

/** Whether a lane shows in a recorded growth (4.33): once both its islands have risen (`island` reads how risen a
 * story's island is, 1 when whole), never while either is still rising. */
export function laneShown(lane: Pick<LaneRoute, 'islands'>, island: (story: string) => number): boolean {
  return lane.islands.every(story => island(story) >= 1);
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

/** How long a dependency's crossing takes in a recorded growth, from the island built on to the one building on it
 * (5.1): constant speed between 0.2's bounds, so a short one still reads as motion and a long one never drags. */
export function roadDrawSeconds(length: number): number {
  return Math.min(1.2, Math.max(0.28, 0.15 + length / 600));
}
