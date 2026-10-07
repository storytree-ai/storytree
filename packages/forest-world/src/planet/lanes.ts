/** Capability 6 · The planet. Selection lanes over the globe's roads (world contracts 6.8–6.9), ported from 0.2's laneLayout and lane draw-on. */
import type { Vector3 } from 'three';
import { trailFillWidth } from '../core/routing.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import type { PlanetPathways } from './pathways.js';

/** 0.2's lane inks: what the selection builds on, and what builds on it. */
export const LANE_COLOUR = { up: '#0d8fb0', down: '#6a5fee' } as const;

export interface LitLink { from: string; to: string; dir: 'up' | 'down' }
export interface LaneRoute extends LitLink {
  /** From the capability built on (`to`) to the one building on it (`from`): dependency order. */
  points: Vector3[];
  length: number;
  /** Narrower than a one-link road, so every road it rides keeps a rim. */
  width: number;
  colour: string;
}

const LANE_WIDTH = 0.6 * trailFillWidth(1) * RIBBON_GROUND_SCALE;

/** Each lit link's trail as one strip, in dependency order; a link with no trail lights nothing. */
export function laneRoutes(plan: PlanetPathways, lit: readonly LitLink[]): LaneRoute[] {
  const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
  return lit.flatMap((link): LaneRoute[] => {
    const edge = plan.edges.find(e => e.from === link.from && e.to === link.to);
    if (edge === undefined) return [];
    const points: Vector3[] = [];
    // The chain runs from the building capability to the one built on; the lane runs back along it.
    for (const ref of [...edge.segments].reverse()) {
      const along = segments.get(ref.id)!.points;
      for (const point of ref.reversed ? along : [...along].reverse()) {
        if (points.length === 0 || points.at(-1)!.distanceTo(point) > 1e-9) points.push(point);
      }
    }
    const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]!), 0);
    return [{ ...link, points, length, width: LANE_WIDTH, colour: LANE_COLOUR[link.dir] }];
  });
}

/** Constant speed between 0.2's bounds: a short lane still reads as motion, a long one never drags. */
export function laneDrawSeconds(length: number): number {
  return Math.min(1.2, Math.max(0.28, 0.15 + length / 600));
}

/** How much of a lane is drawn `elapsed` seconds after it was lit: ease-out, or all of it under reduced motion. */
export function laneProgress(elapsed: number, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const t = Math.min(1, Math.max(0, elapsed / seconds));
  return 1 - (1 - t) ** 3;
}
