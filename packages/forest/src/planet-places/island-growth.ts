/**
 * Islands grow with their code from anchored places (ADR-0804 D3, D7).
 *
 * - A surveyed story's island has land in proportion to its lines of code: {@link LAND_PER_LINE} ground
 *   units² a line, never below {@link MIN_ISLAND_AREA}, so a tiny story stays visible.
 * - Each island keeps its permanent place (ADR-0646) as an ANCHOR. When islands grow into each other,
 *   {@link growPlanet} nudges them apart: first by pushing every overlapping pair away from each other
 *   along the sphere, then by pulling each back toward its anchor as far as it can go without touching
 *   another. Islands that do not overlap never move, so a small project keeps its places exactly.
 * - When nudging cannot make room, the globe grows: the radius rises in steps of {@link GROWTH_STEP} until
 *   nothing overlaps and no island is more than {@link MAX_NUDGE} from its anchor. Islands keep their
 *   ground size, so a bigger globe only spaces them further apart.
 *
 * Pure and deterministic: the same islands always give the same globe (no random, no clock).
 */
import { placeOnPackedGlobe, PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";

/**
 * Ground units² of land per line of code in a surveyed story.
 *
 * Derived so a typical story's island stays near today's: over the eight-story seed and its real code survey
 * (`view/evidence/growth/measurements.json`), the islands' land today is capabilities x 318 ground units²
 * (10,584 in all) over 24,122 non-test lines in all, 0.44 a line, or 0.73 in the units the ground is sized
 * in (the cells' area, before the coast's outset adds about a fifth). The per-story ratios run from 0.29 to
 * 2.6 with a median of 0.86; 0.75 keeps the total land within 3% of today's while letting the
 * story with the most code (The agent link) grow to 2.6 times its old island and a story with little
 * shrink to a third of its.
 */
export const LAND_PER_LINE = 0.75;

/** The least land an island has: one capability's worth, as an unsurveyed story with one capability draws. */
export const MIN_ISLAND_AREA = 318;

/** A surveyed story's land: its lines times the per-line constant, never below the floor. */
export function islandArea(lines: number): number {
  return Math.max(MIN_ISLAND_AREA, lines * LAND_PER_LINE);
}

/**
 * The farthest an island may be nudged from its anchor, in radians of arc (about 65 ground units on the
 * shipped globe): under half the front of the globe's spacing, so an island never trades places with a neighbour.
 */
export const MAX_NUDGE = 0.3;

/**
 * The open sea kept between two islands' reaches, in ground units. An island's reach is its coast's farthest
 * point, so this is measured against the worst direction, and the real coast gap facing a neighbour is wider.
 * Twelve is the most that leaves the eight-story seed at today's sizes unmoved (its nearest pair has 18.3 to spare);
 * the approved ribbon envelope (19.3, ADR-0655 D3) is met by real coasts, which a test measures.
 */
export const SEA_GAP = 12;

/** How much the radius rises at each try when nudging cannot make room. */
export const GROWTH_STEP = 1.02;

/** An island to place: its permanent place, and how far its coast reaches from its middle, in ground units. */
export interface GrowingIsland { readonly story: string; readonly place: number; readonly reach: number }

export interface GrownPlanet {
  /** The globe's radius, in ground units: PLANET_RADIUS until the islands no longer fit. */
  readonly radius: number;
  /** Each island's unit direction after nudging (its anchor's, exactly, when it was not moved). */
  readonly spots: ReadonlyMap<string, PlanetPoint>;
}

/** Sweeps of pairwise separation before nudging is declared unable to make room. */
const SEPARATION_SWEEPS = 400;
/** Rounds of pulling back toward the anchors. */
const RELAXATION_ROUNDS = 80;
/** Room, in radians, below which two islands count as clear of each other. */
const SLACK = 1e-9;

type Vec = readonly [number, number, number];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angleBetween = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const normalise = (v: Vec): Vec => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };

/** `from` moved `by` radians along the great circle toward `toward`, or away from it when `by` is negative. */
function step(from: Vec, toward: Vec, by: number): Vec {
  const c = dot(from, toward);
  const side: Vec = [toward[0] - c * from[0], toward[1] - c * from[1], toward[2] - c * from[2]];
  const length = Math.hypot(side[0], side[1], side[2]);
  // Coincident (or opposite) directions have no side to lean toward: pick a fixed tangent, so the answer is deterministic.
  const tangent: Vec = length > 1e-12 ? [side[0] / length, side[1] / length, side[2] / length]
    : normalise(Math.abs(from[1]) < 0.9 ? [-from[2], 0, from[0]] : [0, from[2], -from[1]]);
  return normalise([from[0] * Math.cos(by) + tangent[0] * Math.sin(by), from[1] * Math.cos(by) + tangent[1] * Math.sin(by), from[2] * Math.cos(by) + tangent[2] * Math.sin(by)]);
}

/** The islands at `radius`, nudged apart and pulled back toward their anchors; undefined when they cannot be made to fit within the bound. */
function settle(anchors: readonly Vec[], reaches: readonly number[], radius: number): Vec[] | undefined {
  const need = (i: number, j: number) => (reaches[i]! + reaches[j]! + SEA_GAP) / radius;
  const clashes = (spots: readonly Vec[]) => spots.some((a, i) => spots.some((b, j) => j > i && angleBetween(a, b) < need(i, j) - SLACK));
  const spots = anchors.slice();
  if (!clashes(spots)) return spots;
  for (let sweep = 0; clashes(spots); sweep++) {
    if (sweep >= SEPARATION_SWEEPS) return undefined;
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const short = need(i, j) - angleBetween(spots[i]!, spots[j]!);
      if (short <= SLACK) continue;
      const a = spots[i]!, b = spots[j]!;
      spots[i] = step(a, b, -short / 2);
      spots[j] = step(b, a, -short / 2);
    }
    if (spots.some((spot, i) => angleBetween(spot, anchors[i]!) > MAX_NUDGE)) return undefined;
  }
  // Pulled back one island at a time, each as far toward its anchor as it can go without touching another.
  for (let round = 0; round < RELAXATION_ROUNDS; round++) {
    let moved = false;
    for (let i = 0; i < spots.length; i++) {
      const away = angleBetween(spots[i]!, anchors[i]!);
      if (away < SLACK) continue;
      for (let fraction = 1; fraction > 1 / 64; fraction /= 2) {
        const there = step(spots[i]!, anchors[i]!, away * fraction);
        if (spots.some((other, j) => j !== i && angleBetween(there, other) < need(i, j) - SLACK)) continue;
        spots[i] = there;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return spots.some((spot, i) => angleBetween(spot, anchors[i]!) > MAX_NUDGE) ? undefined : spots;
}

/** Every island at its anchor, nudged as little as needed; the globe's radius grows only when nudging cannot make room. */
export function growPlanet(islands: readonly GrowingIsland[]): GrownPlanet {
  const anchors = islands.map(({ place }): Vec => { const p = placeOnPackedGlobe(place); return [p.x / PLANET_RADIUS, p.y / PLANET_RADIUS, p.z / PLANET_RADIUS]; });
  const reaches = islands.map(({ reach }) => reach);
  for (let radius = PLANET_RADIUS; ; radius *= GROWTH_STEP) {
    const spots = settle(anchors, reaches, radius);
    if (spots !== undefined) return { radius, spots: new Map(islands.map(({ story }, i) => [story, { x: spots[i]![0], y: spots[i]![1], z: spots[i]![2] }])) };
  }
}
