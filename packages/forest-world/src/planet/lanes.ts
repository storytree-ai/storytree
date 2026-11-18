// Capability 4 · The planet
import { Vector3 } from 'three';
import type { PlanetLanes } from './pathways.js';

export const SEA_LANE = '#80acbf';
export const SEA_LANE_FILL = '#d2ecf5';

export interface LitLink { from: string; to: string; dir: 'up' | 'down' }
export interface LaneRoute extends LitLink {
  points: Vector3[];
  length: number;
  widths: number[];
  width: number;
  colour: string;
  typeOnly?: true;
  islands: readonly [string, string];
}

export const SEA_LANE_ONE = 0.32;
export const SEA_LANE_CAP = 1.15;
const SEA_LANE_FULL = 64;
export function seaLaneWidth(sharing: number): number {
  const rise = (Math.sqrt(Math.max(1, sharing)) - 1) / (Math.sqrt(SEA_LANE_FULL) - 1);
  return Math.min(SEA_LANE_CAP, SEA_LANE_ONE + (SEA_LANE_CAP - SEA_LANE_ONE) * rise);
}

export const LANE_DOTS = { size: 0.5, pitch: 3.1, opacity: 0.75, dim: 0.7 } as const;

export const LANE_STRANDS = { cap: 4, gap: 1.1, fan: 9 } as const;

export const LANE_MIN_PX = 4.5;

export function laneScale(worldPerPixel: number): number {
  const want = LANE_MIN_PX * worldPerPixel / SEA_LANE_ONE;
  return want > 1 && Number.isFinite(want) ? Math.max(1, 2 ** Math.round(Math.log2(want))) : 1;
}

export interface RestStretch {
  id: string;
  size: number;
  strands: number;
  carries: string[][];
  bright: number;
  dots: { at: Vector3; along: Vector3; across: number; ends: readonly [number, number] }[];
  islands: (readonly [string, string])[];
}

export function strandSpread(ends: readonly [number, number], scale = 1): number {
  const t = Math.min(1, Math.max(0, Math.min(...ends) / (LANE_STRANDS.fan * SEA_LANE_ONE * scale)));
  return t * t * (3 - 2 * t);
}

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

export function restShown(stretch: Pick<RestStretch, 'islands'>, island: (story: string) => number): boolean {
  return stretch.islands.some(lane => laneShown({ islands: lane }, island));
}

export function laneRoutes(plan: PlanetLanes, lit: readonly LitLink[]): LaneRoute[] {
  const selected = lit.flatMap(link => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    const chain = edge?.segments ?? [];
    return chain.length === 0 ? [] : [{ link, chain, typeOnly: edge?.typeOnly, islands: edge!.islands }];
  });
  const sharing = new Map<string, number>();
  for (const { chain } of selected) for (const ref of chain) sharing.set(ref.id, (sharing.get(ref.id) ?? 0) + 1);
  return selected.map(({ link, chain, typeOnly, islands }): LaneRoute => {
    const line = alongChain(plan, [...chain].reverse().map(ref => ({ ...ref, reversed: !ref.reversed })), sharing);
    return { ...link, ...line, colour: SEA_LANE_FILL, islands, ...typeOnly ? { typeOnly } : {} };
  });
}

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

export function laneDrawn(lane: Pick<LaneRoute, 'islands'>, island: (story: string) => number, elapsed: number, seconds: number, reducedMotion: boolean): number {
  return laneShown(lane, island) ? laneProgress(elapsed, seconds, reducedMotion) : 0;
}

export function laneShown(lane: Pick<LaneRoute, 'islands'>, island: (story: string) => number): boolean {
  return lane.islands.every(story => island(story) >= 1);
}

export const LANE_SPEED = 250;

export function laneDrawSeconds(length: number): number {
  return length / LANE_SPEED;
}

export function advanceLaneClock(elapsed: number, delta: number): number {
  return elapsed + Math.max(0, Math.min(0.08, delta));
}

export function laneProgress(elapsed: number, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion || seconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / seconds));
}

export type HeadRange = readonly [number, number];

const stretchKey = (colour: string, a: Vector3, b: Vector3) => {
  const at = (p: Vector3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
  return [colour, ...[at(a), at(b)].sort()].join('|');
};

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

const HEAD_FADE = 3;

export function laneHead(elapsed: number, length: number, heads: readonly HeadRange[], reducedMotion: boolean): number {
  if (reducedMotion || elapsed <= 0) return 0;
  const front = Math.min(length, elapsed * LANE_SPEED);
  const led = Math.max(0, ...heads.map(([from, to]) => from > 0 && front < from ? 0
    : Math.min(from > 0 ? (front - from) / HEAD_FADE : 1, 1 - (front - to) / HEAD_FADE, 1)));
  return led * Math.min(1, Math.max(0, 1 - (elapsed - laneDrawSeconds(length)) / 0.4));
}

export function roadDrawSeconds(length: number): number {
  return Math.min(1.2, Math.max(0.28, 0.15 + length / 600));
}
