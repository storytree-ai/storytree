/**
 * Capability 1 · Story nodes. Islands grow with their code (ADR-0804 D3): a surveyed story's island has land in proportion
 * to its lines of code, {@link LAND_PER_LINE} ground units² a line, never below {@link MIN_ISLAND_AREA}, so a tiny story
 * stays visible; the glass sheet keeps {@link SEA_GAP} between neighbours (sheet-places).
 */

/**
 * Ground units² of land per line of code in a surveyed story.
 *
 * Twice what ADR-0804 D3 first derived (0.75, so the islands kept the capability-ratio land's total): the owner
 * asked for bigger land (ADR-0910). Land still follows lines of code: more lines, more land.
 */
export const LAND_PER_LINE = 1.5;

/** The least land an island has, and what each capability of an unsurveyed story draws (ADR-0910: 800, from 318, with the land per line). */
export const MIN_ISLAND_AREA = 800;

/** A surveyed story's land: its lines times the per-line constant, never below the floor. */
export function islandArea(lines: number): number {
  return Math.max(MIN_ISLAND_AREA, lines * LAND_PER_LINE);
}

/**
 * The most land a mapped island has (ADR-0993 D3, D13), in ground units²: a mapped island follows its lines as a built
 * one does up to here, so a very large inherited codebase does not crowd out the islands built beside it.
 */
export const MAPPED_ISLAND_CAP = 12_000;

/** A mapped story's land: a surveyed island's for its lines, never above {@link MAPPED_ISLAND_CAP}. */
export function mappedArea(lines: number): number {
  return Math.min(MAPPED_ISLAND_CAP, islandArea(lines));
}

/** An unsurveyed story's land: one {@link MIN_ISLAND_AREA} per capability, at least one's worth, so it grows in step with the surveyed islands. */
export function unsurveyedArea(capabilities: number): number {
  return Math.max(1, capabilities) * MIN_ISLAND_AREA;
}

/**
 * The open sea kept between two islands' reaches, in ground units. An island's reach is its coast's farthest
 * point, so this is measured against the worst direction, and the real coast gap facing a neighbour is wider.
 * Thirty-six, three times what it was (ADR-0910), against the approved ribbon envelope of 19.3 (ADR-0655 D3).
 */
export const SEA_GAP = 36;

/** An island to place: its place (planet-places' placeInRow), and how far its coast reaches from its middle, in ground units. */
export interface GrowingIsland { readonly story: string; readonly place: number; readonly reach: number }
