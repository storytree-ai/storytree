/** Capability 4 · The planet. Plumbing roads (ADR-1085 D3): a build step, a cleanup or a forwarder drawn between the islands
 * it joins, labelled by what it is and never counted as a dependency. The map exposes them by its rules; the user decides. */
import { Vector3 } from 'three';
import type { Plumbing, PlumbingKind } from '../scene.js';
import type { PlanetPathwaySegment, PlanetPathways } from './pathways.js';

/** A plumbing call's key: its two stories and its kind, so two kinds between one pair, or a call beside a mapped
 * island's road between the same two stories (`from->to`), never share one. */
export const plumbingKey = (call: Pick<Plumbing, 'from' | 'to' | 'kind'>): string => `${call.from}->${call.to}#${call.kind}`;

/** The kinds in the order a label lists them. */
export const PLUMBING_KINDS: readonly PlumbingKind[] = ['build step', 'cleanup', 'forwarder'];

/** One plumbing road as the planet plans it: its chain of road segments runs from `from`'s island to `to`'s. */
export interface PlanetPlumbing extends Plumbing {
  segments: readonly { id: string; reversed: boolean }[];
}

/** A dependency's road: warm sand, a solid ribbon at its full width (by the owner's direction, 2026-10-11). */
export const DEPENDENCY_ROAD = '#c7bba1';
const DEPENDENCY_HALO = '#dacaaa';
/** A road only plumbing uses: a muted grey-green in the planet's own quiet range, narrower than a dependency's. */
export const PLUMBING_ROAD = '#8fa9a4';
const PLUMBING_HALO = '#a9c4bf';
/** The thread plumbing lays down a road a dependency shares, as a fraction of that road's width. */
const THREAD_SHARE = 0.4;

export interface RoadLook {
  road: string;
  halo: string;
  /** Where plumbing shares a dependency's road: the ink of the thread down its middle, and its width in ground units. */
  thread?: string;
  threadWidth?: number;
}

/** How a road segment is inked: a dependency's road is sand; one only plumbing uses is its own ink; one both use is
 * sand with a plumbing thread, so the two read apart wherever they share a route. */
export function roadLook(segment: Pick<PlanetPathwaySegment, 'links' | 'plumbing' | 'width'>): RoadLook {
  const plumbing = (segment.plumbing ?? []).length > 0;
  if (segment.links.length === 0) return plumbing ? { road: PLUMBING_ROAD, halo: PLUMBING_HALO } : { road: DEPENDENCY_ROAD, halo: DEPENDENCY_HALO };
  return { road: DEPENDENCY_ROAD, halo: DEPENDENCY_HALO, ...plumbing ? { thread: PLUMBING_ROAD, threadWidth: segment.width * THREAD_SHARE } : {} };
}

/** A label: at a road's middle, one chip per kind of plumbing between its two stories, with the files behind each. */
export interface PlumbingLabel {
  from: string;
  to: string;
  point: Vector3 | undefined;
  chips: { kind: PlumbingKind; files: readonly string[] }[];
}

/** The point halfway along a chain of segments, by length. */
function middleOf(chain: readonly { id: string; reversed: boolean }[], plan: PlanetPathways): Vector3 | undefined {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
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

/** Each pair of stories joined by plumbing gets one label, on the first of its roads (every kind between a pair
 * takes the one route), listing the kinds in the one order. The words are the kind's, nothing more. */
export function plumbingLabels(plan: PlanetPathways): PlumbingLabel[] {
  const pairs = new Map<string, PlanetPlumbing[]>();
  for (const road of plan.plumbing ?? []) {
    const key = `${road.from}->${road.to}`;
    pairs.set(key, [...pairs.get(key) ?? [], road]);
  }
  return [...pairs.values()].map(roads => {
    const sorted = [...roads].sort((a, b) => PLUMBING_KINDS.indexOf(a.kind) - PLUMBING_KINDS.indexOf(b.kind));
    return { from: roads[0]!.from, to: roads[0]!.to, point: middleOf(roads[0]!.segments, plan), chips: sorted.map(road => ({ kind: road.kind, files: road.files })) };
  });
}

/** Whether each segment a plumbing road rides is shown: once both the road's islands have risen (`island` reads how risen a
 * story's island is, 1 when whole), never while either is still rising. A segment two roads share shows when either does. */
export function plumbingSegmentsShown(plan: PlanetPathways, island: (story: string) => number): Map<string, boolean> {
  const shown = new Map<string, boolean>();
  for (const road of plan.plumbing ?? []) {
    const up = island(road.from) >= 1 && island(road.to) >= 1;
    for (const ref of road.segments) shown.set(ref.id, (shown.get(ref.id) ?? false) || up);
  }
  return shown;
}
