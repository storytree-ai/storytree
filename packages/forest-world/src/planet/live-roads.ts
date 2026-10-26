/** Capability 4 · The planet. Live dependency roads (The drawing engine 4.16). */
import { crossingLength, linkKey, roadSegmentWindows, type GrowthWindow } from './growth.js';
import { roadDrawSeconds, roadProgress } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

/** Arrivals follow real links, so rerouting or a poll cannot restart an existing road.
 * Removing a link forgets its arrival; adding it again gives it a new one. While the plan's roads are still being
 * routed (The drawing engine 4.21) it keeps every road that finished drawing, so those are not drawn on again when they arrive;
 * one still drawing when its roads were taken away draws on afresh. A road whose spans all drew whole on `drawn`, the
 * plan last routed, has finished drawing though its own time runs on (an earlier road shares them): it is kept, its time ended now. */
export function nextLiveRoads(previous: ReadonlyMap<string, GrowthWindow>, plan: PlanetPathways, elapsed: number, routing = false,
  drawn?: PlanetPathways): ReadonlyMap<string, GrowthWindow> {
  if (routing) {
    const windows = drawn === undefined ? undefined : roadSegmentWindows(drawn, previous);
    const whole = (key: string) => drawn?.edges.find(edge => linkKey(edge) === key)?.segments
      .every(ref => liveRoadProgress(windows!.get(ref.id), elapsed, false) === 1) ?? false;
    const kept = [...previous].flatMap(([key, road]): [string, GrowthWindow][] => elapsed >= road.start + road.seconds ? [[key, road]]
      : whole(key) ? [[key, { start: elapsed - road.seconds, seconds: road.seconds }]] : []);
    return kept.every(([key, road]) => previous.get(key) === road) && kept.length === previous.size ? previous : new Map(kept);
  }
  const keys = new Set(plan.edges.map(linkKey));
  if (keys.size === previous.size && [...keys].every(key => previous.has(key))) return previous;
  return new Map([...keys].map(key => [key, previous.get(key)
    ?? { start: elapsed, seconds: roadDrawSeconds(crossingLength(plan, key)) }]));
}

/** Live roads use the selection lane's physical-distance pacing, independently of recorded growth. */
export function liveRoadProgress(window: GrowthWindow | undefined, elapsed: number, reducedMotion: boolean): number {
  if (window === undefined || reducedMotion) return 1;
  if (elapsed <= window.start) return 0;
  return window.seconds > 0 ? roadProgress(elapsed - window.start, window.seconds, false) : 1;
}

/** Whether any arrival's own time is still running. Spans an earlier road shares draw whole before a later road's
 * time ends, so the clock must not stop on drawn spans alone: a reroute can split its tail off, still to draw. */
export function liveRoadsGrowing(roads: ReadonlyMap<string, GrowthWindow>, elapsed: number, reducedMotion: boolean): boolean {
  return !reducedMotion && [...roads.values()].some(road => elapsed < road.start + road.seconds);
}
