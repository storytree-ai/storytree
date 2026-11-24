// Capability 5 · Capability tree scorecard
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { kindOf } from "./source.js";
import type { Tree } from "./tree.js";

export const SWEEP_FILES = 30;
export const SUPPORT = 5;
export const RUNS = 500;
const SEED = 1395;

export interface Unit {
  readonly merge: string;
  readonly files: readonly string[];
}

export interface Dropped extends Unit {
  readonly why: "over 30 files" | "rename";
}

export interface Pair {
  readonly a: string;
  readonly b: string;
  readonly support: number;
  readonly lift: number;
  readonly jaccard: number;
}

export interface Spread {
  readonly value: number;
  readonly mean: number;
  readonly p95: number;
}

export interface Grouping {
  readonly mq: Spread;
  readonly inside: Spread;
  readonly runs: number;
}

const run = promisify(execFile);
const MARK = "\u0001";
const isSource = (path: string): boolean => kindOf({ path, text: "" }) === "source";

export async function readCoChange(folder: string, commit: string): Promise<{ kept: Unit[]; dropped: Dropped[] }> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", "log", "--first-parent", "--merges", "--diff-merges=first-parent", "-M", "--name-status", `--format=${MARK}%H`, commit], { cwd: folder, encoding: "utf8", maxBuffer: 1 << 30 });
  const kept: Unit[] = [];
  const dropped: Dropped[] = [];
  for (const block of stdout.split(MARK).slice(1)) {
    const [merge, ...lines] = block.split("\n");
    const files = new Set<string>();
    let renamed = false;
    for (const line of lines) {
      const [status, ...paths] = line.split("\t");
      if (status === undefined || paths.length === 0) continue;
      const sources = paths.filter(isSource);
      if (status.startsWith("R") && sources.length > 0) renamed = true;
      const now = paths[paths.length - 1]!;
      if (isSource(now)) files.add(now);
    }
    const unit = { merge: merge!.trim(), files: [...files].sort() };
    if (unit.files.length > SWEEP_FILES) dropped.push({ ...unit, why: "over 30 files" });
    else if (renamed) dropped.push({ ...unit, why: "rename" });
    else if (unit.files.length > 0) kept.push(unit);
  }
  return { kept, dropped };
}

function nodeSets(units: readonly { files: readonly string[] }[], ownerOf: Readonly<Record<string, string>>): Set<string>[] {
  return units.flatMap((unit) => {
    const nodes = new Set(unit.files.flatMap((file) => ownerOf[file] ?? []));
    return nodes.size === 0 ? [] : [nodes];
  });
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

function supportOf(sets: readonly Set<string>[]): { counts: Map<string, number>; together: Map<string, number> } {
  const counts = new Map<string, number>();
  const together = new Map<string, number>();
  for (const set of sets) {
    const nodes = [...set];
    for (const [at, node] of nodes.entries()) {
      counts.set(node, (counts.get(node) ?? 0) + 1);
      for (const other of nodes.slice(at + 1)) {
        const key = pairKey(node, other);
        together.set(key, (together.get(key) ?? 0) + 1);
      }
    }
  }
  return { counts, together };
}

export function pairsOf(units: readonly { files: readonly string[] }[], ownerOf: Readonly<Record<string, string>>): Pair[] {
  const sets = nodeSets(units, ownerOf);
  const { counts, together } = supportOf(sets);
  const pairs: Pair[] = [];
  for (const [key, support] of together) {
    if (support < SUPPORT) continue;
    const [a, b] = key.split("\u0000") as [string, string];
    const ca = counts.get(a)!;
    const cb = counts.get(b)!;
    pairs.push({ a, b, support, lift: (support * sets.length) / (ca * cb), jaccard: support / (ca + cb - support) });
  }
  return pairs.sort((x, y) => y.lift - x.lift || y.support - x.support || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

export function topOf(nodes: Tree["nodes"]): (node: string) => string {
  const parentOf = new Map(nodes.flatMap(({ id, parent }) => (parent === undefined ? [] : [[id, parent] as const])));
  const ids = new Set(nodes.map(({ id }) => id));
  return (node) => {
    let at = node;
    const seen = new Set([at]);
    for (let up = parentOf.get(at); up !== undefined && ids.has(up) && !seen.has(up); up = parentOf.get(at)) {
      at = up;
      seen.add(at);
    }
    return at;
  };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function scoreOf(weights: ReadonlyMap<string, number>, groupOf: ReadonlyMap<string, string>): { mq: number; inside: number } {
  const intra = new Map<string, number>();
  const inter = new Map<string, number>();
  let total = 0;
  let within = 0;
  for (const [key, weight] of weights) {
    const [a, b] = key.split("\u0000") as [string, string];
    const ga = groupOf.get(a)!;
    const gb = groupOf.get(b)!;
    total += weight;
    if (ga === gb) {
      within += weight;
      intra.set(ga, (intra.get(ga) ?? 0) + weight);
    } else {
      inter.set(ga, (inter.get(ga) ?? 0) + weight);
      inter.set(gb, (inter.get(gb) ?? 0) + weight);
    }
  }
  let mq = 0;
  for (const group of new Set(groupOf.values())) {
    const mu = intra.get(group) ?? 0;
    if (mu > 0) mq += (2 * mu) / (2 * mu + (inter.get(group) ?? 0));
  }
  return { mq, inside: total === 0 ? 0 : within / total };
}

const p95 = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.ceil(0.95 * values.length) - 1] ?? 0;
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

export function groupingOf(units: readonly { files: readonly string[] }[], tree: Tree): Grouping {
  const top = topOf(tree.nodes);
  const ids = new Set(tree.nodes.map(({ id }) => id));
  const owners = [...new Set(Object.values(tree.ownerOf))].filter((id) => ids.has(id)).sort();
  const groupOf = new Map(owners.map((id) => [id, top(id)]));
  const { together } = supportOf(nodeSets(units, Object.fromEntries(Object.entries(tree.ownerOf).filter(([, id]) => ids.has(id)))));
  const value = scoreOf(together, groupOf);
  const slots = owners.map((id) => groupOf.get(id)!);
  const random = seeded(SEED);
  const mqs: number[] = [];
  const insides: number[] = [];
  for (let at = 0; at < RUNS; at++) {
    const shuffled = [...slots];
    for (let last = shuffled.length - 1; last > 0; last--) {
      const pick = Math.floor(random() * (last + 1));
      [shuffled[last], shuffled[pick]] = [shuffled[pick]!, shuffled[last]!];
    }
    const drawn = scoreOf(together, new Map(owners.map((id, which) => [id, shuffled[which]!])));
    mqs.push(drawn.mq);
    insides.push(drawn.inside);
  }
  return { mq: { value: value.mq, mean: mean(mqs), p95: p95(mqs) }, inside: { value: value.inside, mean: mean(insides), p95: p95(insides) }, runs: RUNS };
}
