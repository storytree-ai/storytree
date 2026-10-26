/**
 * Capability 1 · The environment's factor. How much slower than Linux, where tests were tuned, the machine running them is
 * (ADR-1156 D2), read from this one place so no test carries its own platform guess.
 *
 * A fixed table, from CI's own unit pass times on main (runs 40091655118 and 40090706896, 26 units of 3 s
 * or more on Linux): Windows passed the same units 2.2 times slower at the median and 3.5 to 4.2 times at
 * the 90th percentile, macOS 1.3 and 2.3 times. A budget costs time only when its test is already failing,
 * since a wait returns as soon as its check holds, so the table covers the slow tail rather than the median.
 * A ratio learned from ADR-1152's timing history was not the simpler that holds: CI keeps each system's
 * history in its own cache, so no run sees the same tests' Linux and Windows times side by side.
 */

const FACTORS: Readonly<Partial<Record<NodeJS.Platform, number>>> = { linux: 1, darwin: 2, win32: 4 };

/** The environment's factor: 1 on Linux, larger where the same tests pass slower. */
export function factor(platform: NodeJS.Platform = process.platform): number {
  return FACTORS[platform] ?? 1;
}

/** A budget a test states in its own terms, in ms, as this environment spends it. */
export function scaled(ms: number, platform: NodeJS.Platform = process.platform): number {
  return ms * factor(platform);
}
