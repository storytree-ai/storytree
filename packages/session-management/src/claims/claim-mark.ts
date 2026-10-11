/**
 * Capability 5 · Claims: a claim's mark, one shape and one colour for every surface that draws it (ADR-0968's flag on the
 * globe, the arc surface's planted flag). Plain numbers and strings, with no renderer, so a browser page and three.js
 * both read it.
 */

/** Hues a session may wear: clear of the "needs you" amber and of every green (30°–170°). */
const FIRST_HUE = 170;
const HUE_SPAN = 220;

/** A session's own colour, the same on every read, shared by its wisps, its row and its flags. */
export function sessionColour(session: string): string {
  return `hsl(${Math.round(FIRST_HUE + hashOf(session) % HUE_SPAN) % 360}, 80%, 68%)`;
}

function hashOf(session: string): number {
  let hash = 2166136261;
  for (const char of session) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  // Spread ids that differ only in their last letter (session-1, session-2) across the whole span.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** A colour greyed by `q` (0 held, 1 quiet): a third less saturated and four points darker. `s` and `l` run 0 to 1. */
export function quietHsl({ h, s, l }: { h: number; s: number; l: number }, q: number): { h: number; s: number; l: number } {
  return { h, s: s * (1 - q / 3), l: Math.max(0, l - 0.04 * q) };
}

/** `quietHsl` on a `sessionColour` string. */
export function quietColour(colour: string, q: number): string {
  if (q === 0) return colour;
  const [h, s, l] = /^hsl\(([\d.]+), ([\d.]+)%, ([\d.]+)%\)$/u.exec(colour)!.slice(1).map(Number) as [number, number, number];
  const quiet = quietHsl({ h, s: s / 100, l: l / 100 }, q);
  const percent = (value: number) => Number((value * 100).toFixed(2));
  return `hsl(${h}, ${percent(quiet.s)}%, ${percent(quiet.l)}%)`;
}

const quadratic = (from: readonly [number, number], via: readonly [number, number], to: readonly [number, number], steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i): [number, number] => { const t = i / steps, u = 1 - t; return [u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]]; });

/**
 * The pennant's outline at scale `k`, furled by `q`, as [x, y] points with y up and the pole's foot at the origin: from
 * the pole's top (26k up) out to its tip and back, its edges bowed (ADR-0968's reference drawing).
 */
export function pennantOutline(k: number, q: number): [number, number][] {
  const H = 26 * k, W = 17 * k * (1 - 0.58 * q), h = 12 * k, droop = q * 9 * k;
  // The drawing's y runs down the canvas; here it runs up the screen.
  const tip: [number, number] = [W, H - h * 0.5 - droop];
  return [...quadratic([0.6 * k, H], [W * 0.5, H - h * 0.16 - droop * 0.4], tip), ...quadratic(tip, [W * 0.5, H - h * 0.84 - droop * 0.8], [0.6 * k, H - h - droop * 0.25]).slice(1)];
}
