/** Capability 1 · Home page. Chapter 1's randomness is seeded: jittered windows, typing rhythm and grain are the same on every load. */
export const OPENING_SEED = 0x0c1a0f;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
