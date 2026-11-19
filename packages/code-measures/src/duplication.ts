// Capability 1 · Base structure measures
import { labelOf, parsed, sourcesOf, type SourceText } from "./source.js";

export const CLONE_TOKENS = 50;

export interface DuplicationReading {
  readonly tokens: number;
  readonly cloned: number;
  readonly share: number;
}

const MODULUS = 1_000_000_007;
const BASE = 1_000_003;

export function duplicationOf(files: readonly SourceText[]): DuplicationReading {
  const ids = new Map<string, number>();
  const streams = sourcesOf(files).map((file) =>
    parsed(file).tokens.map((token) => {
      const key = `${labelOf(token)}\u0001${String(token.value ?? "")}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size + 1;
        ids.set(key, id);
      }
      return id;
    }));
  const tokens = streams.reduce((total, stream) => total + stream.length, 0);

  let shift = 1;
  for (let step = 1; step < CLONE_TOKENS; step++) shift = (shift * BASE) % MODULUS;
  const windows = new Map<number, [number, number][]>();
  streams.forEach((stream, which) => {
    if (stream.length < CLONE_TOKENS) return;
    let hash = 0;
    for (let at = 0; at < stream.length; at++) {
      if (at >= CLONE_TOKENS) hash = (hash - ((stream[at - CLONE_TOKENS]! * shift) % MODULUS) + MODULUS) % MODULUS;
      hash = (hash * BASE + stream[at]!) % MODULUS;
      if (at < CLONE_TOKENS - 1) continue;
      const start = at - CLONE_TOKENS + 1;
      const group = windows.get(hash);
      if (group === undefined) windows.set(hash, [[which, start]]);
      else group.push([which, start]);
    }
  });

  const cloned = streams.map((stream) => new Uint8Array(stream.length));
  const same = ([a, i]: [number, number], [b, j]: [number, number]): boolean => {
    for (let k = 0; k < CLONE_TOKENS; k++) if (streams[a]![i + k] !== streams[b]![j + k]) return false;
    return true;
  };
  for (const group of windows.values()) {
    if (group.length < 2) continue;
    const classes: [number, number][][] = [];
    for (const window of group) {
      const into = classes.find((one) => same(one[0]!, window));
      if (into === undefined) classes.push([window]);
      else into.push(window);
    }
    for (const one of classes) {
      if (one.length < 2) continue;
      for (const [which, start] of one) cloned[which]!.fill(1, start, start + CLONE_TOKENS);
    }
  }
  const count = cloned.reduce((total, marks) => total + marks.reduce((sum, mark) => sum + mark, 0), 0);
  return { tokens, cloned: count, share: tokens === 0 ? 0 : count / tokens };
}
