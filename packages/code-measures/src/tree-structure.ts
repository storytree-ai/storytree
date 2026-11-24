// Capability 5 · Capability tree scorecard
import { resolve } from "./coupling.js";
import { parsed, walk, type Node, type SourceText } from "./source.js";
import type { Tree } from "./tree.js";

export interface Import {
  readonly from: string;
  readonly to: string;
  readonly types?: readonly string[];
}

export interface NodeStructure {
  readonly id: string;
  readonly commonReuse: number | null;
  readonly level: number;
  readonly instability: number | null;
}

export interface Cycle {
  readonly parent: string | null;
  readonly members: readonly string[];
}

export interface Depth {
  readonly depth: number;
  readonly nodes: number;
  readonly edges: number;
}

export interface Boundary {
  readonly from: string;
  readonly to: string;
  readonly types: readonly string[];
}

export interface TreeStructure {
  readonly nodes: readonly NodeStructure[];
  readonly cycles: readonly Cycle[];
  readonly depths: readonly Depth[];
  readonly boundaries: readonly Boundary[];
}

const TYPE_DECLARATIONS = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]);

const nameOf = (node: Node): string => (node.type === "StringLiteral" ? (node.value as string) : (node.name as string));

const bodyOf = (file: SourceText): Node[] => (parsed(file).program?.body as Node[] | undefined) ?? [];

function typeNamesOf(file: SourceText, byPath: ReadonlyMap<string, SourceText>, known: Map<string, Set<string>>): Set<string> {
  const kept = known.get(file.path);
  if (kept !== undefined) return kept;
  const names = new Set<string>();
  known.set(file.path, names);
  const body = bodyOf(file);
  const local = new Set<string>();
  for (const node of body) {
    const declared = node.type === "ExportNamedDeclaration" ? (node.declaration as Node | null | undefined) : node;
    if (declared && TYPE_DECLARATIONS.has(declared.type)) local.add((declared.id as Node).name as string);
  }
  for (const node of body) {
    if (node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") continue;
    const specifier = (node.source as Node | null | undefined)?.value as string | undefined;
    const target = specifier?.startsWith(".") ? resolve(file.path, specifier, byPath) : undefined;
    const theirs = target === undefined ? new Set<string>() : typeNamesOf(target, byPath, known);
    if (node.type === "ExportAllDeclaration") {
      if (!node.exported) for (const name of theirs) names.add(name);
      continue;
    }
    const declared = node.declaration as Node | null | undefined;
    if (declared && TYPE_DECLARATIONS.has(declared.type)) names.add((declared.id as Node).name as string);
    for (const one of (node.specifiers as Node[] | undefined) ?? []) {
      const inner = nameOf((one.local ?? one.exported) as Node);
      const typed = node.exportKind === "type" || one.exportKind === "type" || (specifier === undefined ? local.has(inner) : theirs.has(inner));
      if (typed) names.add(nameOf(one.exported as Node));
    }
  }
  return names;
}

function importedNamesOf(node: Node): { specifier: string; names: string[] | "all" } | undefined {
  const source = node.source as Node | null | undefined;
  if (source?.type === "StringLiteral") {
    const specifier = source.value as string;
    if (node.type === "ImportDeclaration") return { specifier, names: (node.specifiers as Node[]).filter((one) => one.type === "ImportSpecifier").map((one) => nameOf(one.imported as Node)) };
    if (node.type === "ExportNamedDeclaration") return { specifier, names: ((node.specifiers as Node[] | undefined) ?? []).map((one) => nameOf((one.local ?? one.exported) as Node)) };
    if (node.type === "ExportAllDeclaration") return { specifier, names: node.exported ? [] : "all" };
  }
  if (node.type === "CallExpression" && (node.callee as Node).type === "Import") {
    const first = (node.arguments as Node[])[0];
    if (first?.type === "StringLiteral") return { specifier: first.value as string, names: [] };
  }
  if (node.type === "TSImportType" && (node.argument as Node | undefined)?.type === "StringLiteral") {
    const qualifier = node.qualifier as Node | null | undefined;
    return { specifier: (node.argument as Node).value as string, names: qualifier?.type === "Identifier" ? [qualifier.name as string] : [] };
  }
  return undefined;
}

export function importsOf(files: readonly SourceText[]): Import[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const known = new Map<string, Set<string>>();
  const found = new Map<string, { from: string; to: string; types: Set<string> }>();
  for (const file of files) {
    const { program } = parsed(file);
    if (program === undefined) continue;
    for (const node of walk(program)) {
      const imported = importedNamesOf(node);
      if (imported === undefined || !imported.specifier.startsWith(".")) continue;
      const target = resolve(file.path, imported.specifier, byPath);
      if (target === undefined || target.path === file.path) continue;
      const types = typeNamesOf(target, byPath, known);
      const key = `${file.path}\u0000${target.path}`;
      const edge = found.get(key) ?? { from: file.path, to: target.path, types: new Set<string>() };
      found.set(key, edge);
      for (const name of imported.names === "all" ? types : imported.names.filter((one) => types.has(one))) edge.types.add(name);
    }
  }
  return [...found.values()].map(({ from, to, types }) => ({ from, to, types: [...types].sort() }));
}

function stronglyConnected(members: readonly string[], edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sets: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
    }
    if (low.get(node) !== index.get(node)) return;
    const set: string[] = [];
    let popped: string;
    do {
      popped = stack.pop()!;
      onStack.delete(popped);
      set.push(popped);
    } while (popped !== node);
    sets.push(set);
  };
  for (const member of members) if (!index.has(member)) visit(member);
  return sets;
}

export function treeStructureOf(tree: Tree, imports: readonly Import[]): TreeStructure {
  const ids = new Set(tree.nodes.map(({ id }) => id));
  const parentOf = new Map(tree.nodes.flatMap(({ id, parent }) => (parent !== undefined && ids.has(parent) ? [[id, parent] as const] : [])));
  const chainOf = (id: string): string[] => {
    const chain = [id];
    for (let at = parentOf.get(id); at !== undefined && !chain.includes(at); at = parentOf.get(at)) chain.unshift(at);
    return chain;
  };
  const chains = new Map(tree.nodes.map(({ id }) => [id, chainOf(id)]));
  const owned = imports.flatMap((edge) => {
    const from = tree.ownerOf[edge.from];
    const to = tree.ownerOf[edge.to];
    return from === undefined || to === undefined || !chains.has(from) || !chains.has(to) ? [] : [{ ...edge, fromNode: from, toNode: to }];
  });

  const siblingEdges = new Map<string, Set<string>>();
  for (const { fromNode, toNode } of owned) {
    const a = chains.get(fromNode)!;
    const b = chains.get(toNode)!;
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    if (common === a.length || common === b.length) continue;
    const out = siblingEdges.get(a[common]!) ?? new Set<string>();
    out.add(b[common]!);
    siblingEdges.set(a[common]!, out);
  }

  const groups = new Map<string | null, string[]>();
  for (const { id } of tree.nodes) {
    const parent = parentOf.get(id) ?? null;
    groups.set(parent, [...(groups.get(parent) ?? []), id]);
  }
  const cycles: Cycle[] = [];
  const level = new Map<string, number>();
  for (const [parent, members] of groups) {
    const sets = stronglyConnected(members, siblingEdges);
    const setOf = new Map(sets.flatMap((set, which) => set.map((id) => [id, which] as const)));
    for (const set of sets) if (set.length > 1) cycles.push({ parent, members: set });
    const setLevel = new Map<number, number>();
    for (const [which, set] of sets.entries()) {
      let highest = 0;
      for (const id of set) for (const next of siblingEdges.get(id) ?? []) {
        const theirs = setOf.get(next)!;
        if (theirs !== which) highest = Math.max(highest, setLevel.get(theirs)!);
      }
      setLevel.set(which, highest + 1);
      for (const id of set) level.set(id, highest + 1);
    }
  }

  const nodes = tree.nodes.map(({ id }): NodeStructure => {
    const inside = (node: string): boolean => chains.get(node)!.includes(id);
    const importers = new Map<string, Set<string>>();
    const reached = new Set<string>();
    const afferent = new Set<string>();
    const efferent = new Set<string>();
    for (const edge of owned) {
      const fromIn = inside(edge.fromNode);
      const toIn = inside(edge.toNode);
      if (fromIn === toIn) continue;
      if (fromIn) {
        efferent.add(edge.toNode);
        continue;
      }
      afferent.add(edge.fromNode);
      reached.add(edge.to);
      const files = importers.get(edge.fromNode) ?? new Set<string>();
      files.add(edge.to);
      importers.set(edge.fromNode, files);
    }
    const partial = [...importers.values()].filter((files) => files.size < reached.size).length;
    const coupled = afferent.size + efferent.size;
    return { id, commonReuse: importers.size === 0 ? null : partial / importers.size, level: level.get(id)!, instability: coupled === 0 ? null : efferent.size / coupled };
  });

  const byDepth = new Map<number, Depth>();
  for (const { id } of tree.nodes) {
    const depth = chains.get(id)!.length;
    const was = byDepth.get(depth) ?? { depth, nodes: 0, edges: 0 };
    byDepth.set(depth, { depth, nodes: was.nodes + 1, edges: was.edges + (siblingEdges.get(id)?.size ?? 0) });
  }

  const crossings = new Map<string, { from: string; to: string; types: Set<string> }>();
  for (const { fromNode, toNode, types = [] } of owned) {
    if (fromNode === toNode) continue;
    const key = `${fromNode}\u0000${toNode}`;
    const boundary = crossings.get(key) ?? { from: fromNode, to: toNode, types: new Set<string>() };
    for (const name of types) boundary.types.add(name);
    crossings.set(key, boundary);
  }

  return {
    nodes,
    cycles,
    depths: [...byDepth.values()].sort((a, b) => a.depth - b.depth),
    boundaries: [...crossings.values()].map(({ from, to, types }) => ({ from, to, types: [...types].sort() })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
