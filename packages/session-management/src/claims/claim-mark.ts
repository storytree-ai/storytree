// Capability 5 · Claims

const FIRST_HUE = 170;
const HUE_SPAN = 150;

export function sessionColour(session: string): string {
  return `hsl(${Math.round(FIRST_HUE + hashOf(session) % HUE_SPAN) % 360}, 80%, 68%)`;
}

function hashOf(session: string): number {
  let hash = 2166136261;
  for (const char of session) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function quietHsl({ h, s, l }: { h: number; s: number; l: number }, q: number): { h: number; s: number; l: number } {
  return { h, s: s * (1 - q / 3), l: Math.max(0, l - 0.04 * q) };
}

export function quietColour(colour: string, q: number): string {
  if (q === 0) return colour;
  const [h, s, l] = /^hsl\(([\d.]+), ([\d.]+)%, ([\d.]+)%\)$/u.exec(colour)!.slice(1).map(Number) as [number, number, number];
  const quiet = quietHsl({ h, s: s / 100, l: l / 100 }, q);
  const percent = (value: number) => Number((value * 100).toFixed(2));
  return `hsl(${h}, ${percent(quiet.s)}%, ${percent(quiet.l)}%)`;
}

const quadratic = (from: readonly [number, number], via: readonly [number, number], to: readonly [number, number], steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i): [number, number] => { const t = i / steps, u = 1 - t; return [u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]]; });

export function pennantOutline(k: number, q: number): [number, number][] {
  const H = 26 * k, W = 17 * k * (1 - 0.58 * q), h = 12 * k, droop = q * 9 * k;
  const tip: [number, number] = [W, H - h * 0.5 - droop];
  return [...quadratic([0.6 * k, H], [W * 0.5, H - h * 0.16 - droop * 0.4], tip), ...quadratic(tip, [W * 0.5, H - h * 0.84 - droop * 0.8], [0.6 * k, H - h - droop * 0.25]).slice(1)];
}
