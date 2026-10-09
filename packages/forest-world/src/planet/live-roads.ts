/** Capability 6 · The planet. Live dependency roads (world 6.16). */
import { crossingLength, linkKey, type GrowthWindow } from './growth.js';
import { roadDrawSeconds, roadProgress } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

/** Arrivals follow real links, so rerouting or a poll cannot restart an existing road.
 * Removing a link forgets its arrival; adding it again gives it a new one. */
export function nextLiveRoads(previous: ReadonlyMap<string, GrowthWindow>, plan: PlanetPathways, elapsed: number): ReadonlyMap<string, GrowthWindow> {
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
