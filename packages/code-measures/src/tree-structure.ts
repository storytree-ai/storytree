// Capability 5 · Capability tree scorecard
import { resolve } from "./coupling.js";
import { parsed, walk, type Node, type SourceText } from "./source.js";
import type { Tree } from "./tree.js";

export interface Import {
  readonly from: string;
  readonly to: string;
  readonly types?: readonly string[];
  readonly used?: readonly string[];
  readonly exported?: { readonly from: readonly string[]; readonly to: readonly string[] };
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

export interface MeetDepth {
  readonly depth: number;
  readonly imports: number;
}

export interface Entries {
  readonly share: number | null;
  readonly through: number;
  readonly total: number;
  readonly offenders: readonly { readonly from: string; readonly to: string; readonly sibling: string }[];
  readonly nodes: readonly { readonly id: string; readonly entry: string | null; readonly exported: number; readonly behind: number }[];
}

export interface Reuse {
  readonly consumer: string;
  readonly dependency: string;
  readonly used: number;
  readonly exported: number;
  readonly share: number | null;
}

export interface Inversion {
  readonly parent: string | null;
  readonly from: string;
  readonly to: string;
  readonly fanIn: { readonly from: number; readonly to: number };
  readonly imports: readonly Boundary[];
}

export interface OutsideImport {
  readonly story: string;
  readonly to: string;
}

export interface TreeStructure {
  readonly nodes: readonly NodeStructure[];
  readonly cycles: readonly Cycle[];
  readonly inversions: readonly Inversion[];
  readonly cycleGate: "pass" | "fail";
  readonly depths: readonly Depth[];
  readonly meetDepths: readonly MeetDepth[];
  readonly boundaries: readonly Boundary[];
  readonly entries: Entries;
  readonly reuse: readonly Reuse[];
  readonly splitCandidates: readonly Reuse[];
  readonly technicalNames: readonly { readonly id: string; readonly word: string }[];
}

export const SPLIT_SHARE = 0.25;

const TECHNICAL = /\b(schemas?|types?|utils?|utilit(?:y|ies)|helpers?|shared|common|misc|constants?)\b/i;

const INDEX = /(^|\/)index\.[cm]?[jt]sx?$/;

const TYPE_DECLARATIONS = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]);

const nameOf = (node: Node): string => (node.type === "StringLiteral" ? (node.value as string) : (node.name as string));

const bodyOf = (file: SourceText): Node[] => (parsed(file).program?.body as Node[] | undefined) ?? [];

interface Exported {
  readonly types: Set<string>;
  readonly names: Set<string>;
}

const declaredNamesOf = (declared: Node): string[] => declared.type === "VariableDeclaration"
  ? (declared.declarations as Node[]).flatMap((one) => ((one.id as Node).type === "Identifier" ? [(one.id as Node).name as string] : []))
  : (declared.id as Node | null | undefined)?.type === "Identifier" ? [(declared.id as Node).name as string] : [];

function exportedOf(file: SourceText, byPath: ReadonlyMap<string, SourceText>, known: Map<string, Exported>): Exported {
  const kept = known.get(file.path);
  if (kept !== undefined) return kept;
  const exported: Exported = { types: new Set<string>(), names: new Set<string>() };
  known.set(file.path, exported);
  const { types, names } = exported;
  const body = bodyOf(file);
  const local = new Set<string>();
  for (const node of body) {
    const declared = node.type === "ExportNamedDeclaration" ? (node.declaration as Node | null | undefined) : node;
    if (declared && TYPE_DECLARATIONS.has(declared.type)) local.add((declared.id as Node).name as string);
  }
  for (const node of body) {
    if (node.type === "ExportDefaultDeclaration") names.add("default");
    if (node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") continue;
    const specifier = (node.source as Node | null | undefined)?.value as string | undefined;
    const target = specifier?.startsWith(".") ? resolve(file.path, specifier, byPath) : undefined;
    const theirs = target === undefined ? { types: new Set<string>(), names: new Set<string>() } : exportedOf(target, byPath, known);
    if (node.type === "ExportAllDeclaration") {
      if (node.exported) names.add(nameOf(node.exported as Node));
      else {
        for (const name of theirs.types) types.add(name);
        for (const name of theirs.names) if (name !== "default") names.add(name);
      }
      continue;
    }
    const declared = node.declaration as Node | null | undefined;
    if (declared) for (const name of declaredNamesOf(declared)) names.add(name);
    if (declared && TYPE_DECLARATIONS.has(declared.type)) types.add((declared.id as Node).name as string);
    for (const one of (node.specifiers as Node[] | undefined) ?? []) {
      const inner = nameOf((one.local ?? one.exported) as Node);
      const typed = node.exportKind === "type" || one.exportKind === "type" || (specifier === undefined ? local.has(inner) : theirs.types.has(inner));
      names.add(nameOf(one.exported as Node));
      if (typed) types.add(nameOf(one.exported as Node));
    }
  }
  return exported;
}

type Used = string[] | "all";

function importedNamesOf(node: Node): { specifier: string; names: string[] | "all"; used: Used } | undefined {
  const source = node.source as Node | null | undefined;
  if (source?.type === "StringLiteral") {
    const specifier = source.value as string;
    const specifiers = (node.specifiers as Node[] | undefined) ?? [];
    if (node.type === "ImportDeclaration") {
      const used = specifiers.map((one) => (one.type === "ImportSpecifier" ? nameOf(one.imported as Node) : one.type === "ImportDefaultSpecifier" ? "default" : undefined));
      return { specifier, names: specifiers.filter((one) => one.type === "ImportSpecifier").map((one) => nameOf(one.imported as Node)), used: used.includes(undefined) ? "all" : (used as string[]) };
    }
    if (node.type === "ExportNamedDeclaration") {
      const names = specifiers.map((one) => nameOf((one.local ?? one.exported) as Node));
      return { specifier, names, used: specifiers.some((one) => one.type === "ExportNamespaceSpecifier") ? "all" : names };
    }
    if (node.type === "ExportAllDeclaration") return { specifier, names: node.exported ? [] : "all", used: "all" };
  }
  if (node.type === "CallExpression" && (node.callee as Node).type === "Import") {
    const first = (node.arguments as Node[])[0];
    if (first?.type === "StringLiteral") return { specifier: first.value as string, names: [], used: "all" };
  }
  if (node.type === "TSImportType" && (node.argument as Node | undefined)?.type === "StringLiteral") {
    const qualifier = node.qualifier as Node | null | undefined;
    const names = qualifier?.type === "Identifier" ? [qualifier.name as string] : [];
    return { specifier: (node.argument as Node).value as string, names, used: names.length === 0 ? "all" : names };
  }
  return undefined;
}

export function exportsOf(files: readonly SourceText[]): Map<string, string[]> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const known = new Map<string, Exported>();
  return new Map(files.map((file) => [file.path, [...exportedOf(file, byPath, known).names]]));
}

export function importsOf(files: readonly SourceText[]): Import[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const known = new Map<string, Exported>();
  const found = new Map<string, { from: string; to: string; types: Set<string>; used: Set<string> }>();
  for (const file of files) {
    const { program } = parsed(file);
    if (program === undefined) continue;
    for (const node of walk(program)) {
      const imported = importedNamesOf(node);
      if (imported === undefined || !imported.specifier.startsWith(".")) continue;
      const target = resolve(file.path, imported.specifier, byPath);
      if (target === undefined || target.path === file.path) continue;
      const { types, names } = exportedOf(target, byPath, known);
      const key = `${file.path}\u0000${target.path}`;
      const edge = found.get(key) ?? { from: file.path, to: target.path, types: new Set<string>(), used: new Set<string>() };
      found.set(key, edge);
      for (const name of imported.names === "all" ? types : imported.names.filter((one) => types.has(one))) edge.types.add(name);
      for (const name of imported.used === "all" ? names : imported.used) edge.used.add(name);
    }
  }
  const namesOf = (file: string): string[] => [...exportedOf(byPath.get(file)!, byPath, known).names];
  return [...found.values()].map(({ from, to, types, used }) => ({ from, to, types: [...types].sort(), used: [...used].sort(), exported: { from: namesOf(from), to: namesOf(to) } }));
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

export function treeStructureOf(tree: Tree, imports: readonly Import[], exports?: ReadonlyMap<string, readonly string[]>, outside: readonly OutsideImport[] = []): TreeStructure {
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

  const met = owned.map((edge) => {
    const a = chains.get(edge.fromNode)!;
    const b = chains.get(edge.toNode)!;
    let depth = 0;
    while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth++;
    return { ...edge, depth, ...(depth < a.length && depth < b.length ? { mine: a[depth]!, sibling: b[depth]! } : {}) };
  });
  const siblingEdges = new Map<string, Set<string>>();
  for (const { mine, sibling } of met) {
    if (mine === undefined || sibling === undefined) continue;
    const out = siblingEdges.get(mine) ?? new Set<string>();
    out.add(sibling);
    siblingEdges.set(mine, out);
  }

  const groups = new Map<string | null, string[]>();
  for (const { id } of tree.nodes) {
    const parent = parentOf.get(id) ?? null;
    groups.set(parent, [...(groups.get(parent) ?? []), id]);
  }
  const fanIns = new Map<string, number>();
  const fanInOf = (id: string): number => {
    const kept = fanIns.get(id);
    if (kept !== undefined) return kept;
    const inside = (node: string): boolean => chains.get(node)!.includes(id);
    const importers = new Set(owned.flatMap(({ fromNode, toNode }) => (!inside(fromNode) && inside(toNode) ? [fromNode] : [])));
    const stories = new Set(outside.flatMap(({ story, to }) => {
      const owner = tree.ownerOf[to];
      return owner !== undefined && chains.has(owner) && inside(owner) ? [story] : [];
    }));
    fanIns.set(id, importers.size + stories.size);
    return importers.size + stories.size;
  };
  const beneath = (from: string, to: string): Boundary[] => {
    const found = new Map<string, { from: string; to: string; types: Set<string> }>();
    for (const { fromNode, toNode, mine, sibling, types = [] } of met) {
      if (mine !== from || sibling !== to) continue;
      const key = `${fromNode}\u0000${toNode}`;
      const pair = found.get(key) ?? { from: fromNode, to: toNode, types: new Set<string>() };
      for (const name of types) pair.types.add(name);
      found.set(key, pair);
    }
    return [...found.values()].map(({ from, to, types }) => ({ from, to, types: [...types].sort() })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  };

  const cycles: Cycle[] = [];
  const inversions: Inversion[] = [];
  const level = new Map<string, number>();
  for (const [parent, members] of groups) {
    const sets = stronglyConnected(members, siblingEdges);
    const setOf = new Map(sets.flatMap((set, which) => set.map((id) => [id, which] as const)));
    for (const set of sets) {
      if (set.length < 2) continue;
      cycles.push({ parent, members: set });
      for (const from of set) for (const to of siblingEdges.get(from) ?? []) {
        if (!set.includes(to) || fanInOf(from) <= fanInOf(to)) continue;
        inversions.push({ parent, from, to, fanIn: { from: fanInOf(from), to: fanInOf(to) }, imports: beneath(from, to) });
      }
    }
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

  const namesOf = new Map<string, readonly string[]>(exports ?? []);
  for (const { from, to, exported } of imports) {
    if (exported === undefined) continue;
    if (!namesOf.has(from)) namesOf.set(from, exported.from);
    if (!namesOf.has(to)) namesOf.set(to, exported.to);
  }
  const filesOf = (id: string, nested: boolean): string[] => Object.entries(tree.ownerOf).filter(([, owner]) => chains.has(owner) && (nested ? chains.get(owner)!.includes(id) : owner === id)).map(([file]) => file);
  const namesIn = (files: readonly string[]): Set<string> => new Set(files.flatMap((file) => namesOf.get(file) ?? []));

  const meetCounts = new Map<number, number>();
  for (const { depth } of met) meetCounts.set(depth, (meetCounts.get(depth) ?? 0) + 1);

  const across = met.flatMap(({ from, to, sibling }) => (sibling === undefined ? [] : [{ from, to, sibling }]));
  const entryOf = new Map<string, string | null>();
  for (const { id, entry } of tree.nodes) {
    if (!across.some(({ sibling }) => sibling === id)) continue;
    const indexes = filesOf(id, true).filter((file) => INDEX.test(file)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    entryOf.set(id, entry ?? indexes[0] ?? null);
  }
  const offenders = across.filter(({ to, sibling }) => entryOf.get(sibling) !== to);
  const through = across.length - offenders.length;

  const used = new Map<string, { consumer: string; dependency: string; names: Set<string> }>();
  for (const { fromNode, toNode, used: names = [] } of owned) {
    if (fromNode === toNode) continue;
    const key = `${fromNode}\u0000${toNode}`;
    const pair = used.get(key) ?? { consumer: fromNode, dependency: toNode, names: new Set<string>() };
    for (const name of names) pair.names.add(name);
    used.set(key, pair);
  }
  const reuse = [...used.values()].map(({ consumer, dependency, names }): Reuse => {
    const exported = namesIn(filesOf(dependency, false));
    const count = [...names].filter((name) => exported.has(name)).length;
    return { consumer, dependency, used: count, exported: exported.size, share: exported.size === 0 ? null : count / exported.size };
  }).sort((a, b) => a.consumer.localeCompare(b.consumer) || a.dependency.localeCompare(b.dependency));

  return {
    nodes,
    cycles,
    inversions,
    cycleGate: cycles.length === 0 ? "pass" : "fail",
    depths: [...byDepth.values()].sort((a, b) => a.depth - b.depth),
    meetDepths: [...meetCounts].map(([depth, count]) => ({ depth, imports: count })).sort((a, b) => a.depth - b.depth),
    entries: {
      share: across.length === 0 ? null : through / across.length,
      through,
      total: across.length,
      offenders,
      nodes: [...entryOf].map(([id, entry]) => ({ id, entry, exported: entry === null ? 0 : namesIn([entry]).size, behind: namesIn(filesOf(id, true).filter((file) => file !== entry)).size })),
    },
    reuse,
    splitCandidates: reuse.filter(({ share }) => share !== null && share < SPLIT_SHARE),
    technicalNames: tree.nodes.flatMap(({ id, title }) => {
      const word = parentOf.has(id) ? null : TECHNICAL.exec(title.replace(/^\s*\d+\s*·\s*/, ""));
      return word === null ? [] : [{ id, word: word[1]!.toLowerCase() }];
    }),
    boundaries: [...crossings.values()].map(({ from, to, types }) => ({ from, to, types: [...types].sort() })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
