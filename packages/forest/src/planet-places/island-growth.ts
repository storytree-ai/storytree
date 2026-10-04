/**
 * Islands grow with their code from anchored places (ADR-0804 D3, D7).
 *
 * - A surveyed story's island has land in proportion to its lines of code: {@link LAND_PER_LINE} ground
 *   units² a line, never below {@link MIN_ISLAND_AREA}, so a tiny story stays visible.
 * - Each island's ANCHOR is its place in the rows (planet-places): its row's latitude, packed along the parallel
 *   in slot order with two reaches and {@link SEA_GAP} between neighbours, each row centred on the front of the
 *   globe. When islands still grow into each other (across rows),
 *   {@link growPlanet} nudges them apart: first by pushing every overlapping pair away from each other
 *   along the sphere (and, where a row's band stops a pair parting north and south, along their parallels), then by pulling each back toward its anchor as far as it can go without touching
 *   another. Nudging keeps each island within {@link ROW_BAND} of its row's latitude, so no island is pushed past
 *   a row below or above it. Islands that do not overlap never move, so a small project keeps its places exactly.
 * - When nudging cannot make room, the globe grows: the radius rises in steps of {@link GROWTH_STEP} until
 *   nothing overlaps and no island is more than {@link MAX_NUDGE} from its anchor, which also widens the rows in ground units. Islands keep their
 *   ground size, so a bigger globe only spaces them further apart.
 *
 * Pure and deterministic: the same islands always give the same globe (no random, no clock).
 */
import { PLANET_RADIUS, ROW_LATITUDE, rowLatitude, rowOf, type PlanetPoint } from "./planet-places.js";

/**
 * Ground units² of land per line of code in a surveyed story.
 *
 * Twice what ADR-0804 D3 first derived (0.75, so the islands kept the capability-ratio land's total): the owner
 * asked for bigger land on a globe with plenty of room (ADR-0910). The camera frames the whole globe, so land
 * gets bigger by taking a larger share of it, at the same radius: on storytree's own globe, 8.6% of the surface
 * to 18.3% (view/evidence/more-sea). Land still follows lines of code: more lines, more land.
 */
export const LAND_PER_LINE = 1.5;

/** The least land an island has, and what each capability of an unsurveyed story draws (ADR-0910: 800, from 318, with the land per line). */
export const MIN_ISLAND_AREA = 800;

/** A surveyed story's land: its lines times the per-line constant, never below the floor. */
export function islandArea(lines: number): number {
  return Math.max(MIN_ISLAND_AREA, lines * LAND_PER_LINE);
}

/** An unsurveyed story's land: one {@link MIN_ISLAND_AREA} per capability, at least one's worth, so it grows in step with the surveyed islands. */
export function unsurveyedArea(capabilities: number): number {
  return Math.max(1, capabilities) * MIN_ISLAND_AREA;
}

/**
 * The farthest an island may be nudged from its anchor, in radians of arc: 1.2, about 260 ground units on the
 * shipped globe (ADR-0910; was 0.3). A judgement, not a measurement: bigger islands with wider sea between them
 * need farther nudging, and this is the point past which an island would no longer be near enough to its
 * row to be found there, so the globe grows instead.
 */
export const MAX_NUDGE = 1.2;

/**
 * The open sea kept between two islands' reaches, in ground units. An island's reach is its coast's farthest
 * point, so this is measured against the worst direction, and the real coast gap facing a neighbour is wider.
 * Thirty-six, three times what it was (ADR-0910): on storytree's own globe the nearest coasts run from 38 to
 * 45 or more apart, against the approved ribbon envelope of 19.3 (ADR-0655 D3), which real coasts meet and a test measures.
 */
export const SEA_GAP = 36;

/** How much the radius rises at each try when nudging cannot make room. */
export const GROWTH_STEP = 1.02;

/** An island to place: its place in the rows (planet-places' placeInRow), and how far its coast reaches from its middle, in ground units. */
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

const longitudeOf = (v: Vec) => Math.atan2(v[0], v[2]);
/** `spot` moved `by` radians of arc east (west when negative) along its parallel. */
function along(spot: Vec, by: number): Vec {
  const turn = by / Math.max(1e-6, Math.hypot(spot[0], spot[2])), cos = Math.cos(turn), sin = Math.sin(turn);
  return [spot[0] * cos + spot[2] * sin, spot[1], spot[2] * cos - spot[0] * sin];
}

/**
 * How far north or south of its row's latitude nudging may move an island, as a share of the rows' spacing.
 * Under a half, so an island never reaches the band of the row above or below: every island stays north of
 * every island in a lower row, and so of every story it depends on (Story nodes 1.4), whatever their sizes.
 */
export const ROW_BAND = 0.4;

/** `spot` moved along its meridian into the latitudes `band` (south, north), when it has strayed out of them. */
function intoBand(spot: Vec, band: readonly [number, number]): Vec {
  const latitude = Math.asin(Math.max(-1, Math.min(1, spot[1])));
  if (latitude >= band[0] && latitude <= band[1]) return spot;
  const clamped = Math.max(band[0], Math.min(band[1], latitude)), longitude = Math.atan2(spot[0], spot[2]);
  return [Math.cos(clamped) * Math.sin(longitude), Math.sin(clamped), Math.cos(clamped) * Math.cos(longitude)];
}

/** The islands at `radius`, nudged apart within their rows' bands and pulled back toward their anchors; undefined when they cannot be made to fit within the bound. */
function settle(anchors: readonly Vec[], bands: readonly (readonly [number, number])[], reaches: readonly number[], radius: number): Vec[] | undefined {
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
      spots[i] = intoBand(step(a, b, -short / 2), bands[i]!);
      spots[j] = intoBand(step(b, a, -short / 2), bands[j]!);
      // A pair the bands stop from parting north and south parts east and west instead, the more westerly one going west.
      const left = need(i, j) - angleBetween(spots[i]!, spots[j]!);
      if (left > SLACK) {
        const apart = longitudeOf(spots[j]!) - longitudeOf(spots[i]!), west = Math.atan2(Math.sin(apart), Math.cos(apart)) >= 0 ? i : j, east = west === i ? j : i;
        spots[west] = along(spots[west]!, -left / 2);
        spots[east] = along(spots[east]!, left / 2);
      }
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
        const there = intoBand(step(spots[i]!, anchors[i]!, away * fraction), bands[i]!);
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

/** Every island at its anchor, nudged as little as needed; the globe's radius grows only when a row no longer fits round it or nudging cannot make room. */
export function growPlanet(islands: readonly GrowingIsland[]): GrownPlanet {
  const reaches = islands.map(({ reach }) => reach);
  const rows = Math.max(0, ...islands.map(({ place }) => rowOf(place).row + 1));
  const half = rows <= 1 ? Math.PI : ROW_BAND * 2 * ROW_LATITUDE / (rows - 1);
  const bands = islands.map(({ place }): [number, number] => { const at = rowLatitude(rowOf(place).row, rows); return [at - half, at + half]; });
  for (let radius = PLANET_RADIUS; ; radius *= GROWTH_STEP) {
    const anchors = rowAnchors(islands, radius);
    const spots = anchors === undefined ? undefined : settle(anchors, bands, reaches, radius);
    if (spots !== undefined) return { radius, spots: new Map(islands.map(({ story }, i) => [story, { x: spots[i]![0], y: spots[i]![1], z: spots[i]![2] }])) };
  }
}

/**
 * Each island's anchor at `radius`: on its row's latitude, west to east in slot order, each neighbour two reaches
 * and the sea gap away along the globe, the row centred on the front; undefined when a row no longer fits round it.
 */
function rowAnchors(islands: readonly GrowingIsland[], radius: number): Vec[] | undefined {
  const rows = Math.max(0, ...islands.map(({ place }) => rowOf(place).row + 1));
  const anchors: Vec[] = [];
  for (let row = 0; row < rows; row++) {
    const members = islands.flatMap((island, i) => (rowOf(island.place).row === row ? [i] : [])).sort((a, b) => rowOf(islands[a]!.place).slot - rowOf(islands[b]!.place).slot);
    const latitude = rowLatitude(row, rows);
    const apart = (a: number, b: number) => longitudeApart(latitude, (islands[a]!.reach + islands[b]!.reach + SEA_GAP) / radius);
    const steps = members.slice(1).map((member, k) => apart(members[k]!, member));
    const round = members.length > 1 ? apart(members[members.length - 1]!, members[0]!) : 0;
    if (round === undefined || steps.some(step => step === undefined)) return undefined;
    const span = steps.reduce<number>((sum, step) => sum + step!, 0);
    if (span + round > 2 * Math.PI) return undefined;
    let longitude = -span / 2;
    members.forEach((member, k) => {
      if (k > 0) longitude += steps[k - 1]!;
      anchors[member] = [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
    });
  }
  return anchors;
}

/** How far apart in longitude two points on `latitude` must be to be `angle` apart along the globe; undefined when the parallel is too small. */
function longitudeApart(latitude: number, angle: number): number | undefined {
  const cosine = (Math.cos(angle) - Math.sin(latitude) ** 2) / Math.cos(latitude) ** 2;
  return cosine < -1 ? undefined : Math.acos(Math.min(1, cosine));
}
