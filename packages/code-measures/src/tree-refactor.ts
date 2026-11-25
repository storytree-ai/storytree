// Capability 5 · Capability tree scorecard
import { VerbRefusal } from "@storytree/library/verbs";

import type { Import } from "./tree-structure.js";

export interface Split {
  readonly file: string;
  readonly into: Readonly<Record<string, readonly string[]>>;
}

export interface Retarget {
  readonly file: string;
  readonly from: string;
  readonly to?: string;
  readonly names?: readonly string[];
}

export interface Refactor {
  readonly splits?: readonly Split[];
  readonly retargets?: readonly Retarget[];
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly types: Set<string>;
  readonly used: Set<string>;
}

const keyOf = (from: string, to: string): string => `${from}\u0000${to}`;

function join(edges: Map<string, Edge>, from: string, to: string, used: Iterable<string>, types: Iterable<string>): void {
  if (from === to) return;
  const edge = edges.get(keyOf(from, to)) ?? { from, to, types: new Set<string>(), used: new Set<string>() };
  edges.set(keyOf(from, to), edge);
  for (const name of used) edge.used.add(name);
  for (const name of types) edge.types.add(name);
}

export function refactored(imports: readonly Import[], exports: ReadonlyMap<string, readonly string[]> | undefined, { splits = [], retargets = [] }: Refactor): { imports: Import[]; exports: Map<string, readonly string[]> } {
  const names = new Map<string, readonly string[]>(exports ?? []);
  for (const { from, to, exported } of imports) {
    if (exported === undefined) continue;
    if (!names.has(from)) names.set(from, exported.from);
    if (!names.has(to)) names.set(to, exported.to);
  }
  const gain = (file: string, more: readonly string[]): void => {
    names.set(file, [...new Set([...(names.get(file) ?? []), ...more])]);
  };
  let edges = new Map<string, Edge>();
  for (const { from, to, used = [], types = [] } of imports) join(edges, from, to, used, types);
  for (const { file, into } of splits) {
    const parts = Object.entries(into);
    const given = new Set(parts.flatMap(([, held]) => held));
    const left = (names.get(file) ?? []).filter((name) => !given.has(name));
    if (left.length > 0) throw new VerbRefusal(`The split of ${file} leaves ${left.join(", ")} in no part: give each of its exported names to a part.`);
    const next = new Map<string, Edge>();
    for (const edge of edges.values()) {
      if (edge.to === file) {
        for (const [part, held] of parts) {
          const used = [...edge.used].filter((name) => held.includes(name));
          if (used.length > 0) join(next, edge.from, part, used, [...edge.types].filter((name) => held.includes(name)));
        }
      } else if (edge.from === file) for (const [part] of parts) join(next, part, edge.to, edge.used, edge.types);
      else join(next, edge.from, edge.to, edge.used, edge.types);
    }
    edges = next;
    names.delete(file);
    for (const [part, held] of parts) gain(part, held);
  }
  for (const { file, from, to, names: named } of retargets) {
    const edge = edges.get(keyOf(file, from));
    if (edge === undefined) throw new VerbRefusal(`${file} does not import ${from}, so there is no import of it to retarget.`);
    const moved = named ?? [...edge.used];
    const types = [...edge.types].filter((name) => moved.includes(name));
    for (const name of moved) {
      edge.used.delete(name);
      edge.types.delete(name);
    }
    if (edge.used.size === 0) edges.delete(keyOf(file, from));
    if (to === undefined) continue;
    join(edges, file, to, moved, types);
    gain(to, moved);
  }
  const exportedOf = (file: string): string[] => [...(names.get(file) ?? [])];
  return {
    imports: [...edges.values()].map(({ from, to, types, used }) => ({ from, to, types: [...types].sort(), used: [...used].sort(), exported: { from: exportedOf(from), to: exportedOf(to) } })),
    exports: names,
  };
}
