/**
 * Capability 1 · Base structure measures. Duplication (contract 1.3, B4): the share of a story's source tokens lying in
 * an identical run of 50 tokens or more found at two places or more, within one file or across files, whitespace and
 * comments ignored and test files not read. A token counts once however many clones cover it.
 *
 * Every window of 50 tokens is hashed; windows that hash alike are compared token by token, and each window met at two
 * places or more marks its tokens cloned. A run of 50 or more at two places is exactly the union of such windows.
 */
import { labelOf, parsed, sourcesOf, type SourceText } from "./source.js";

/** The smallest run of tokens that is a clone. */
export const CLONE_TOKENS = 50;

/** A story's duplication: its source tokens, those in clones, and their share. */
export interface DuplicationReading {
  readonly tokens: number;
  readonly cloned: number;
  readonly share: number;
}

const MODULUS = 1_000_000_007;
const BASE = 1_000_003;

/** `files`' duplication (B4). */
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

  // Each window's hash, grouped: [stream, start] pairs.
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
    // Windows that merely share a hash are told apart by their tokens.
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
