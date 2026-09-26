// Deterministic pseudo-random — FNV-1a hash + a single mulberry32 step. Every
// "random" value in the forest world (tile growth, crown-blob jitter, road bows,
// mesh jitter) is hashed from a STABLE id, never Math.random, so the world renders
// identically every visit and ships as static output. Pure, browser-safe.

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One uniform [0,1) draw from an integer seed (mulberry32 single step). */
export function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
