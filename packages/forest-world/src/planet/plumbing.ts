/** Capability 4 · The planet. Plumbing lanes (ADR-1085 D3, ADR-1261 D5): a build step, a cleanup or a forwarder drawn at
 * sea between the islands it joins, in its own grey-green, labelled by what it is and never counted as a dependency. The
 * map exposes them by its rules; the user decides. */
import { Vector3 } from 'three';
import type { Plumbing, PlumbingKind } from '../scene.js';
import type { PlanetPathways } from './pathways.js';
import { alongChain, type LaneRoute } from './lanes.js';

/** A plumbing call's key: its two stories and its kind, so two kinds between one pair, or a call beside a mapped
 * island's lane between the same two stories (`from->to`), never share one. */
export const plumbingKey = (call: Pick<Plumbing, 'from' | 'to' | 'kind'>): string => `${call.from}->${call.to}#${call.kind}`;

/** The kinds in the order a label lists them. */
export const PLUMBING_KINDS: readonly PlumbingKind[] = ['build step', 'cleanup', 'forwarder'];

/** One plumbing call as the planet plans it: its chain of lane segments runs from `from`'s island to `to`'s. */
export interface PlanetPlumbing extends Plumbing {
  segments: readonly { id: string; reversed: boolean }[];
}

/** A plumbing lane: a muted grey-green in the planet's own quiet range, apart from a dependency's sea-blue (ADR-1261 D5). */
export const PLUMBING_LANE = '#8fa9a4';

/** A plumbing lane between two islands, every kind between them on its one route. */
export interface PlumbingLane extends LaneRoute {
  kinds: PlumbingKind[];
}

/** The plumbing lanes lit while `story` is selected: one per pair of islands its plumbing calls join, either way, from
 * `from`'s dock to `to`'s, in the plumbing ink, wider by how many lit plumbing lanes share a stretch. Dependency lanes
 * never widen them, nor they a dependency lane: they are not links (4.30). None with no story selected. */
export function plumbingLanes(plan: Pick<PlanetPathways, 'lanes' | 'plumbing'>, story: string | undefined): PlumbingLane[] {
  if (story === undefined) return [];
  const pairs = new Map<string, PlanetPlumbing[]>();
  for (const call of plan.plumbing ?? []) {
    if (call.from !== story && call.to !== story) continue;
    const key = `${call.from}->${call.to}`;
    pairs.set(key, [...pairs.get(key) ?? [], call]);
  }
  const sharing = new Map<string, number>();
  for (const [first] of pairs.values()) for (const ref of first!.segments) sharing.set(ref.id, (sharing.get(ref.id) ?? 0) + 1);
  return [...pairs.values()].map((calls): PlumbingLane => {
    const { from, to, segments } = calls[0]!;
    const kinds = PLUMBING_KINDS.filter(kind => calls.some(call => call.kind === kind));
    return { from, to, dir: from === story ? 'up' : 'down', ...alongChain(plan.lanes, segments, sharing), colour: PLUMBING_LANE,
      islands: [from, to] as const, kinds };
  });
}

/** A label: at a plumbing lane's middle, one chip per kind of plumbing between its two stories, with the files behind each. */
export interface PlumbingLabel {
  from: string;
  to: string;
  point: Vector3 | undefined;
  chips: { kind: PlumbingKind; files: readonly string[] }[];
}

/** The point halfway along a chain of segments, by length. */
function middleOf(chain: readonly { id: string; reversed: boolean }[], plan: PlanetPathways): Vector3 | undefined {
  const segments = new Map(plan.lanes.segments.map(segment => [segment.id, segment]));
  const points = chain.flatMap(ref => { const own = segments.get(ref.id)?.points ?? []; return ref.reversed ? [...own].reverse() : own; });
  const walk = [0];
  for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + points[i]!.distanceTo(points[i - 1]!));
  const half = (walk.at(-1) ?? 0) / 2;
  const next = walk.findIndex(distance => distance >= half);
  if (next < 0) return undefined;
  if (next === 0) return points[0]!.clone();
  const span = walk[next]! - walk[next - 1]!;
  return points[next - 1]!.clone().lerp(points[next]!, span > 0 ? (half - walk[next - 1]!) / span : 0);
}

/** The labels shown while `story` is selected: those of the plumbing lanes it lights (an end of theirs is `story`), at a
 * point on their lane; none with no story selected (4.31). */
export function litPlumbingLabels(plan: PlanetPathways, story: string | undefined): PlumbingLabel[] {
  return plumbingLabels(plan).filter(label => label.point !== undefined && (label.from === story || label.to === story));
}

/** Each pair of stories joined by plumbing gets one label, on the first of its lanes (every kind between a pair
 * takes the one route), listing the kinds in the one order. The words are the kind's, nothing more. */
export function plumbingLabels(plan: PlanetPathways): PlumbingLabel[] {
  const pairs = new Map<string, PlanetPlumbing[]>();
  for (const call of plan.plumbing ?? []) {
    const key = `${call.from}->${call.to}`;
    pairs.set(key, [...pairs.get(key) ?? [], call]);
  }
  return [...pairs.values()].map(calls => {
    const sorted = [...calls].sort((a, b) => PLUMBING_KINDS.indexOf(a.kind) - PLUMBING_KINDS.indexOf(b.kind));
    return { from: calls[0]!.from, to: calls[0]!.to, point: middleOf(calls[0]!.segments, plan), chips: sorted.map(call => ({ kind: call.kind, files: call.files })) };
  });
}
