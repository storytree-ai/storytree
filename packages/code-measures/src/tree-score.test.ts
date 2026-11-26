// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { test } from "node:test";
import { VerbRefusal } from "@storytree/library/verbs";

import { planTreeOf, proposedTreeOf, type Tree } from "./tree.js";
import * as treeStructure from "./tree-structure.js";
import { importsOf, treeStructureOf, type Import, type NodeStructure, type TreeStructure } from "./tree-structure.js";
import type { SourceText } from "./index.js";
import { scorecardOf, type Scorecard } from "./scorecard.js";

const READING = "capability_000000000001";
const WRITING = "capability_000000000002";
const DRAFTS = "capability_000000000003";
const ARCHIVE = "capability_000000000004";

const CAPABILITIES = [
  { id: READING, title: "1 · Reading" },
  { id: WRITING, title: "2 · Writing" },
  { id: DRAFTS, title: "3 · Drafts", parent: WRITING },
  { id: ARCHIVE, title: "4 · Archive" },
];

const SOURCE = "packages/p/src";
const FILES = [
  { path: `${SOURCE}/read.ts`, capability: READING },
  { path: `${SOURCE}/write.ts`, capability: WRITING },
  { path: `${SOURCE}/drafts/draft.ts`, capability: DRAFTS },
  { path: `${SOURCE}/drafts/index.ts`, capability: DRAFTS },
  { path: `${SOURCE}/orphan.ts` },
];

const shape = (tree: Tree) => ({
  nodes: [...tree.nodes].map(({ id, title, parent }) => [id, title, parent ?? null]).sort(([a], [b]) => String(a).localeCompare(String(b))),
  ownerOf: { ...tree.ownerOf },
  unplaced: [...tree.unplaced].sort(),
});

test("5.1 · the plan's tree nests the story's capabilities by parent and places each source file in the capability the owner rule gives it, a file it gives none named unplaced", () => {
  assert.deepEqual(shape(planTreeOf(CAPABILITIES, FILES)), {
    nodes: [
      [READING, "1 · Reading", null],
      [WRITING, "2 · Writing", null],
      [DRAFTS, "3 · Drafts", WRITING],
      [ARCHIVE, "4 · Archive", null],
    ],
    ownerOf: {
      [`${SOURCE}/read.ts`]: READING,
      [`${SOURCE}/write.ts`]: WRITING,
      [`${SOURCE}/drafts/draft.ts`]: DRAFTS,
      [`${SOURCE}/drafts/index.ts`]: DRAFTS,
    },
    unplaced: [`${SOURCE}/orphan.ts`],
  });
});

test("5.1 · a proposed tree file's leaves take files by path or by capability number, the files the plan gives that capability; a story file no node takes is named unplaced", () => {
  const plan = planTreeOf(CAPABILITIES, FILES);
  const proposed = proposedTreeOf({
    nodes: [
      { id: "core", title: "Core" },
      { id: "drafting", title: "Drafting", parent: "core", capabilities: [3] },
      { id: "writes", title: "Writes", parent: "core", files: [`${SOURCE}/write.ts`, `${SOURCE}/orphan.ts`] },
    ],
  }, plan);
  assert.deepEqual(shape(proposed), {
    nodes: [
      ["core", "Core", null],
      ["drafting", "Drafting", "core"],
      ["writes", "Writes", "core"],
    ],
    ownerOf: {
      [`${SOURCE}/drafts/draft.ts`]: "drafting",
      [`${SOURCE}/drafts/index.ts`]: "drafting",
      [`${SOURCE}/write.ts`]: "writes",
      [`${SOURCE}/orphan.ts`]: "writes",
    },
    unplaced: [`${SOURCE}/read.ts`],
  });
});

test("5.1 · a proposed tree file giving one file to two nodes is refused, naming the file and both nodes", () => {
  const plan = planTreeOf(CAPABILITIES, FILES);
  assert.throws(
    () => proposedTreeOf({
      nodes: [
        { id: "first-home", title: "First home", files: [`${SOURCE}/read.ts`] },
        { id: "second-home", title: "Second home", capabilities: [1] },
      ],
    }, plan),
    (error: unknown) => {
      assert.ok(error instanceof VerbRefusal, `a refusal, not ${String(error)}`);
      assert.match(error.message, /packages\/p\/src\/read\.ts/);
      assert.match(error.message, /first-home/);
      assert.match(error.message, /second-home/);
      return true;
    },
  );
});

const flat = (owned: Record<string, readonly string[]>): Tree => ({
  nodes: Object.keys(owned).map((id) => ({ id, title: id })),
  ownerOf: Object.fromEntries(Object.entries(owned).flatMap(([id, files]) => files.map((file) => [`${SOURCE}/${file}`, id]))),
  unplaced: [],
});

const edges = (pairs: readonly (readonly [string, string])[]): Import[] => pairs.map(([from, to]) => ({ from: `${SOURCE}/${from}`, to: `${SOURCE}/${to}` }));

const byId = (structure: TreeStructure, pick: (node: NodeStructure) => unknown) => Object.fromEntries([...structure.nodes].map((node) => [node.id, pick(node)]));

test("5.4 · a node's Common Reuse is the share of the other nodes importing it that import only part of the files imported into it from outside; a node nothing imports reads none", () => {
  const tree = flat({ X: ["x/one.ts", "x/two.ts", "x/three.ts"], Y: ["y.ts"], Z: ["z.ts"], W: ["w.ts"] });
  const imports = edges([
    ["y.ts", "x/one.ts"], ["y.ts", "x/two.ts"],
    ["z.ts", "x/one.ts"], ["z.ts", "y.ts"],
    ["w.ts", "x/one.ts"], ["w.ts", "x/two.ts"],
    ["x/one.ts", "x/three.ts"],
  ]);
  assert.deepEqual(byId(treeStructureOf(tree, imports), (node) => node.commonReuse), { X: 1 / 3, Y: 0, Z: null, W: null });
});

const NESTED: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "A", title: "Alpha", parent: "P" },
    { id: "B", title: "Beta", parent: "P" },
    { id: "C", title: "Gamma", parent: "P" },
    { id: "D", title: "Delta", parent: "P" },
    { id: "Q1", title: "First queue", parent: "Q" },
    { id: "Q2", title: "Second queue", parent: "Q" },
  ],
  ownerOf: Object.fromEntries(([["a.ts", "A"], ["a2.ts", "A"], ["b.ts", "B"], ["c.ts", "C"], ["d.ts", "D"], ["q1.ts", "Q1"], ["q2.ts", "Q2"]] as [string, string][]).map(([file, id]) => [`${SOURCE}/${file}`, id])),
  unplaced: [],
};

const NESTED_IMPORTS = edges([
  ["a.ts", "b.ts"], ["a2.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"], ["d.ts", "a.ts"],
  ["a.ts", "q1.ts"], ["d.ts", "q1.ts"], ["q1.ts", "b.ts"],
]);

test("5.5 · import cycles among sibling nodes, a parent's through its children's files, are named under their parent as strongly connected sets of two or more", () => {
  const cycles = treeStructureOf(NESTED, NESTED_IMPORTS).cycles.map(({ parent, members }) => [parent, [...members].sort()]).sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(cycles, [
    ["P", ["A", "B", "C"]],
    [null, ["P", "Q"]],
  ].sort(([a], [b]) => String(a).localeCompare(String(b))));
});

test("5.6 · each node's Lakos level among its siblings, a cycle's members sharing one, and its instability Ce/(Ca+Ce) counting nodes, not import lines; none for a node with neither", () => {
  const tree = flat({ A: ["a1.ts", "a2.ts"], B: ["b.ts"], C: ["c.ts"], D: ["d.ts"], E: ["e1.ts", "e2.ts"], F: ["f.ts"] });
  const imports = edges([
    ["a1.ts", "b.ts"], ["b.ts", "a1.ts"],
    ["a1.ts", "c.ts"], ["a2.ts", "c.ts"],
    ["c.ts", "d.ts"],
    ["e1.ts", "c.ts"], ["e2.ts", "c.ts"], ["e1.ts", "d.ts"],
  ]);
  const structure = treeStructureOf(tree, imports);
  assert.deepEqual(byId(structure, (node) => node.level), { A: 3, B: 3, C: 2, D: 1, E: 3, F: 1 });
  assert.deepEqual(byId(structure, (node) => node.instability), { A: 2 / 3, B: 1 / 2, C: 1 / 3, D: 0, E: 1, F: null });

  const nested = byId(treeStructureOf(NESTED, NESTED_IMPORTS), (node) => node.level);
  assert.deepEqual(nested, { P: 1, Q: 1, A: 1, B: 1, C: 1, D: 2, Q1: 1, Q2: 1 }, "levels are read among siblings only: Q1's import of B, a node under another parent, raises no level");
});

test("5.7 · each depth of the tree reads its node count and the import edges among siblings at that depth, one per importing and imported node, not per import line", () => {
  const depths = [...treeStructureOf(NESTED, NESTED_IMPORTS).depths].sort((a, b) => a.depth - b.depth);
  assert.deepEqual(depths, [
    { depth: 1, nodes: 2, edges: 2 },
    { depth: 2, nodes: 6, edges: 4 },
  ]);
});

const source = (file: string, lines: readonly string[]): SourceText => ({ path: `${SOURCE}/${file}`, text: `${lines.join("\n")}\n` });

test("5.8 · each boundary, an import edge from one node to another, lists the type and interface names imported across it, through a barrel's export * too, never values, classes or enums, and a boundary crossed by values only lists none", () => {
  const files = [
    source("x/shapes.ts", [
      "export interface Shape { readonly side: number }",
      'export type Colour = "red" | "blue";',
      "export const unit = 1;",
      "export class Box {}",
      "export enum Kind { Square }",
    ]),
    source("x/area.ts", ['import type { Shape } from "./shapes.js";', "export function area(shape: Shape): number { return shape.side ** 2; }"]),
    source("y/use.ts", [
      'import { area } from "../x/area.js";',
      'import { unit, Box, Kind, type Colour, Shape } from "../x/shapes.js";',
      "export interface Thing { readonly name: string }",
      "export const used: [Shape, Colour] | number = area({ side: unit });",
      "export const made = [new Box(), Kind.Square];",
    ]),
    source("z/more.ts", [
      'import type { Shape } from "../x/shapes.js";',
      'import { unit } from "../x/shapes.js";',
      'import type { Thing } from "../y/use.js";',
      "export const s: Shape = { side: unit };",
      "export const t: Thing | undefined = undefined;",
    ]),
    source("w/plain.ts", ['import { unit } from "../x/shapes.js";', "export const twice = unit * 2;"]),
    source("x/index.ts", ['export * from "./shapes.js";']),
    source("v/barrel.ts", ['import { unit, Shape } from "../x/index.js";', "export const v: Shape = { side: unit };"]),
  ];
  const tree = flat({ X: ["x/shapes.ts", "x/area.ts", "x/index.ts"], Y: ["y/use.ts"], Z: ["z/more.ts"], W: ["w/plain.ts"], V: ["v/barrel.ts"] });
  const boundaries = treeStructureOf(tree, importsOf(files)).boundaries
    .map(({ from, to, types }) => [`${from}→${to}`, [...types].sort()])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(boundaries, [
    ["V→X", ["Shape"]],
    ["W→X", []],
    ["Y→X", ["Colour", "Shape"]],
    ["Z→X", ["Shape"]],
    ["Z→Y", ["Thing"]],
  ]);
});

const DEEP: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "A", title: "Alpha", parent: "P" },
    { id: "B", title: "Beta", parent: "P" },
    { id: "A1", title: "Inner alpha", parent: "A" },
    { id: "Q1", title: "First queue", parent: "Q" },
  ],
  ownerOf: Object.fromEntries(([["p.ts", "P"], ["a.ts", "A"], ["a1.ts", "A1"], ["a1b.ts", "A1"], ["b.ts", "B"], ["q.ts", "Q"], ["q1.ts", "Q1"]] as [string, string][]).map(([file, id]) => [`${SOURCE}/${file}`, id])),
  unplaced: [`${SOURCE}/loose.ts`],
};

test("5.10 · each import between two placed files counts at the depth its ends' nodes meet, 0 when they share no ancestor, a node's own depth when both ends sit in it or one holds the other, listed by depth ascending with no empty depth", () => {
  const imports = edges([
    ["a.ts", "q1.ts"],
    ["a1.ts", "a1b.ts"],
    ["a.ts", "b.ts"],
    ["q.ts", "p.ts"],
    ["a1.ts", "b.ts"],
    ["p.ts", "a.ts"],
    ["loose.ts", "a.ts"],
    ["a.ts", "outside.ts"],
  ]);
  const structure = treeStructureOf(DEEP, imports) as TreeStructure & { meetDepths?: unknown };
  assert.deepEqual(structure.meetDepths, [
    { depth: 0, imports: 2 },
    { depth: 1, imports: 3 },
    { depth: 3, imports: 1 },
  ]);
});

interface Entries {
  readonly share: number | null;
  readonly through: number;
  readonly total: number;
  readonly offenders: readonly { from: string; to: string; sibling: string }[];
  readonly nodes: readonly { id: string; entry: string | null; exported: number; behind: number }[];
}

test("5.11 · of the imports between siblings, the share landing on the imported sibling's entry, a proposed node's entry else its shallowest index file, each other one named with its files; each imported sibling reads its entry's exported names against those behind it", () => {
  const files = [
    source("k/keys.ts", [
      'import { version } from "../v/api.js";',
      'import { secret } from "../v/impl.js";',
      'import { one } from "../m/index.mts";',
      'import { two } from "../m/index.js";',
      'import { plain } from "../n/plain.js";',
      'import { deep } from "./deep/index.js";',
      'import "./index.js";',
      'export const key = "k";',
      "export const other = [version, secret, one, two, plain, deep];",
    ]),
    source("k/index.ts", ['export * from "./keys.js";']),
    source("k/deep/index.ts", ["export const deep = 3;"]),
    source("v/api.ts", ['export { make, type Value } from "./impl.js";', "export const version = 1;", 'export const label = "v";']),
    source("v/impl.ts", [
      'import { key } from "../k/index.js";',
      'import { other } from "../k/keys.js";',
      "export function make(): string { return key; }",
      "export interface Value { readonly v: number }",
      "export const secret = other;",
      "export default function fallback(): void {}",
    ]),
    source("v/index.ts", ['export { version } from "./api.js";']),
    source("m/index.mts", ["export const one = 1;"]),
    source("m/index.ts", ["export const one = 1;", "export const two = 2;"]),
    source("n/plain.ts", ["export const plain = 1;"]),
    source("t/tool.ts", ['import { version } from "../v/api.js";', "export const tool = version;"]),
  ];
  const plan = planTreeOf([], files.map(({ path }) => ({ path })));
  const at = (file: string) => `${SOURCE}/${file}`;
  const proposal = {
    nodes: [
      { id: "S", title: "Store" },
      { id: "K", title: "Keys", parent: "S", files: [at("k/keys.ts"), at("k/deep/index.ts")] },
      { id: "K1", title: "Key entry", parent: "K", files: [at("k/index.ts")] },
      { id: "V", title: "Values", parent: "S", entry: at("v/api.ts"), files: [at("v/api.ts"), at("v/impl.ts"), at("v/index.ts")] },
      { id: "M", title: "Marks", parent: "S", files: [at("m/index.mts"), at("m/index.ts")] },
      { id: "N", title: "Names", parent: "S", files: [at("n/plain.ts")] },
      { id: "T", title: "Tools", files: [at("t/tool.ts")] },
    ],
  };
  const tree = proposedTreeOf(proposal, plan);
  const { entries } = treeStructureOf(tree, importsOf(files)) as TreeStructure & { entries?: Entries };
  assert.ok(entries !== undefined, "an entries reading");
  assert.deepEqual({ share: entries.share, through: entries.through, total: entries.total }, { share: 3 / 8, through: 3, total: 8 });
  assert.deepEqual(
    [...entries.offenders].map(({ from, to, sibling }) => [from, to, sibling]).sort((a, b) => a.join().localeCompare(b.join())),
    [
      [at("k/keys.ts"), at("m/index.ts"), "M"],
      [at("k/keys.ts"), at("n/plain.ts"), "N"],
      [at("k/keys.ts"), at("v/impl.ts"), "V"],
      [at("t/tool.ts"), at("v/api.ts"), "S"],
      [at("v/impl.ts"), at("k/keys.ts"), "K"],
    ],
  );
  assert.deepEqual([...entries.nodes].sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "K", entry: at("k/index.ts"), exported: 2, behind: 3 },
    { id: "M", entry: at("m/index.mts"), exported: 1, behind: 2 },
    { id: "N", entry: null, exported: 0, behind: 1 },
    { id: "S", entry: at("k/index.ts"), exported: 2, behind: 12 },
    { id: "V", entry: at("v/api.ts"), exported: 4, behind: 5 },
  ], "behind counts the files other than the entry: Values' label, exported only by its entry, is not behind it");
});

test("5.11 · with no import between siblings the entry share reads none", () => {
  const { entries } = treeStructureOf(DEEP, edges([["a1.ts", "a.ts"], ["p.ts", "b.ts"]])) as TreeStructure & { entries?: Entries };
  assert.deepEqual(entries, { share: null, through: 0, total: 0, offenders: [], nodes: [] });
});

interface Reuse {
  readonly consumer: string;
  readonly dependency: string;
  readonly used: number;
  readonly exported: number;
  readonly share: number | null;
}

test("5.12 · each consumer and dependency node pair reads the share of the dependency's own exported names the consumer imports, a namespace import or export * counting all of a file's names and a default import counting default; a pair under a quarter is named a split candidate", () => {
  const files = [
    source("d/one.ts", ["export const a = 1;", "export const b = 2;", "export function c(): number { return 3; }"]),
    source("d/two.ts", ['import { a } from "./one.js";', "export const e = a;", "export interface F { readonly f: number }", "export default 6;"]),
    source("e/four.ts", ["export const p = 1;", "export const q = 2;", "export const r = 3;", "export const s = 4;"]),
    source("c1/one.ts", ['import { a } from "../d/one.js";', 'import { p } from "../e/four.js";', "export const x = a + p;"]),
    source("c1/two.ts", ['import { a } from "../d/one.js";', "export const y = a;"]),
    source("c2/use.ts", ['import * as one from "../d/one.js";', 'import six from "../d/two.js";', "export const z = one.a + six;"]),
    source("c3/barrel.ts", ['export * from "../d/one.js";', 'import type { F } from "../d/two.js";', "export const w: F | undefined = undefined;"]),
    source("c4/rename.ts", ['export { b as bee } from "../d/one.js";']),
    source("c5/qualified.ts", ['export type G = import("../d/two.js").F;']),
  ];
  const tree = flat({ D: ["d/one.ts", "d/two.ts"], E: ["e/four.ts"], C1: ["c1/one.ts", "c1/two.ts"], C2: ["c2/use.ts"], C3: ["c3/barrel.ts"], C4: ["c4/rename.ts"], C5: ["c5/qualified.ts"] });
  const structure = treeStructureOf(tree, importsOf(files)) as TreeStructure & { reuse?: readonly Reuse[]; splitCandidates?: readonly { consumer: string; dependency: string }[] };
  assert.deepEqual(structure.reuse, [
    { consumer: "C1", dependency: "D", used: 1, exported: 6, share: 1 / 6 },
    { consumer: "C1", dependency: "E", used: 1, exported: 4, share: 0.25 },
    { consumer: "C2", dependency: "D", used: 4, exported: 6, share: 4 / 6 },
    { consumer: "C3", dependency: "D", used: 4, exported: 6, share: 4 / 6 },
    { consumer: "C4", dependency: "D", used: 1, exported: 6, share: 1 / 6 },
    { consumer: "C5", dependency: "D", used: 1, exported: 6, share: 1 / 6 },
  ], "a renamed re-export uses the dependency's name, and a qualified import type the one name it qualifies");
  assert.equal((treeStructure as Record<string, unknown>).SPLIT_SHARE, 0.25);
  assert.deepEqual((structure.splitCandidates ?? []).map(({ consumer, dependency }) => [consumer, dependency]), [["C1", "D"], ["C4", "D"], ["C5", "D"]], "C1, C4 and C5 each use one of D's six names; C1's one of E's four is a quarter, not under it");
});

const GATED: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "P1", title: "First page", parent: "P" },
    { id: "P2", title: "Second page", parent: "P" },
    { id: "Q1", title: "First queue", parent: "Q" },
  ],
  ownerOf: Object.fromEntries(([["p.ts", "P"], ["p1.ts", "P1"], ["p2.ts", "P2"], ["q1.ts", "Q1"]] as [string, string][]).map(([file, id]) => [`${SOURCE}/${file}`, id])),
  unplaced: [],
};

test("5.13 · the sibling-cycle gate reads fail when a cycle stands among siblings nested under a parent, and pass when imports only run between a node and its own parent both ways", () => {
  const gate = (imports: Import[]) => (treeStructureOf(GATED, imports) as TreeStructure & { cycleGate?: unknown }).cycleGate;
  assert.equal(gate(edges([["p1.ts", "p2.ts"], ["p2.ts", "p1.ts"], ["p1.ts", "q1.ts"]])), "fail");
  assert.equal(gate(edges([["p1.ts", "p2.ts"], ["p.ts", "p1.ts"], ["p1.ts", "p.ts"], ["p1.ts", "q1.ts"]])), "pass");
});

test("5.14 · top-level nodes whose title, after its number, holds a technical-layer word as a whole word in any case are flagged with the word; a nested node or a word inside another word is not", () => {
  const tree: Tree = {
    nodes: [
      { id: "schemas", title: "1 · Schemas" },
      { id: "belt", title: "Utility belt" },
      { id: "ground", title: "Common ground" },
      { id: "helpers", title: "helpers" },
      { id: "misc", title: "MISC" },
      { id: "typewriter", title: "Typewriter" },
      { id: "domain", title: "Domain" },
      { id: "constants", title: "Constants", parent: "domain" },
      { id: "nested-util", title: "Util", parent: "domain" },
    ],
    ownerOf: {},
    unplaced: [],
  };
  const { technicalNames } = treeStructureOf(tree, []) as TreeStructure & { technicalNames?: readonly { id: string; word: string }[] };
  assert.deepEqual([...(technicalNames ?? [])].sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "belt", word: "utility" },
    { id: "ground", word: "common" },
    { id: "helpers", word: "helpers" },
    { id: "misc", word: "misc" },
    { id: "schemas", word: "schemas" },
  ]);
});

const at = (file: string): string => `${SOURCE}/${file}`;

test("5.15 · a proposed tree's split file leaves the tree unless it is one of its parts, owned by no node even through its capability, and each part and each retarget's new file is a story file, named unplaced when no node takes it", () => {
  const plan = planTreeOf(CAPABILITIES, FILES);
  const proposed = proposedTreeOf({
    nodes: [
      { id: "reading", title: "Reading", capabilities: [1] },
      { id: "writing", title: "Writing", capabilities: [2], files: [at("write/text.ts"), at("orphan.ts")] },
      { id: "drafting", title: "Drafting", capabilities: [3] },
    ],
    splits: [
      { file: at("write.ts"), into: { [at("write/text.ts")]: ["write"], [at("write/files.ts")]: ["save"] } },
      { file: at("read.ts"), into: { [at("read.ts")]: ["read"], [at("read/peek.ts")]: ["peek"] } },
    ],
    retargets: [{ file: at("drafts/draft.ts"), from: at("write/files.ts"), to: at("drafts/store.ts") }],
  }, plan);
  assert.deepEqual(shape(proposed), {
    nodes: [
      ["drafting", "Drafting", null],
      ["reading", "Reading", null],
      ["writing", "Writing", null],
    ],
    ownerOf: {
      [at("read.ts")]: "reading",
      [at("write/text.ts")]: "writing",
      [at("orphan.ts")]: "writing",
      [at("drafts/draft.ts")]: "drafting",
      [at("drafts/index.ts")]: "drafting",
    },
    unplaced: [at("drafts/store.ts"), at("read/peek.ts"), at("write/files.ts")],
  });
});

const SPLIT_TREE: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "R", title: "Readers" },
    { id: "T", title: "Types" },
    { id: "Y", title: "Logs" },
  ],
  ownerOf: Object.fromEntries(([
    ["p.ts", "P"], ["pages/types.ts", "P"], ["q.ts", "Q"], ["queues/types.ts", "Q"], ["r.ts", "R"], ["types.ts", "T"], ["y.ts", "Y"],
  ] as [string, string][]).map(([file, id]) => [at(file), id])),
  unplaced: [],
};

const SPLIT_IMPORTS: Import[] = [
  { from: at("p.ts"), to: at("types.ts"), used: ["Page", "makePage"], types: ["Page"] },
  { from: at("q.ts"), to: at("types.ts"), used: ["Mark", "Queue"], types: ["Mark", "Queue"] },
  { from: at("r.ts"), to: at("types.ts"), used: ["Page"], types: ["Page"] },
  { from: at("types.ts"), to: at("y.ts"), used: ["log"], types: [] },
];

const SPLIT_EXPORTS = new Map<string, readonly string[]>([
  [at("p.ts"), []], [at("q.ts"), []], [at("r.ts"), []],
  [at("types.ts"), ["Page", "makePage", "Queue", "Mark"]],
  [at("y.ts"), ["log", "other"]],
]);

const boundariesOf = (card: Scorecard) => card.readings.boundaries.map(({ from, to, types }) => [`${from}→${to}`, [...types]]);

test("5.15 · a split file's importers land on each part holding names they use, with the types among them, every part carries the file's own imports, and the file exports only the names a part gives it", () => {
  const card = scorecardOf({
    tree: SPLIT_TREE,
    units: [],
    imports: SPLIT_IMPORTS,
    exports: SPLIT_EXPORTS,
    refactor: { splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page", "makePage"], [at("queues/types.ts")]: ["Queue"], [at("types.ts")]: ["Mark"] } }] },
  });
  assert.deepEqual(boundariesOf(card), [
    ["P→Y", []],
    ["Q→T", ["Mark"]],
    ["Q→Y", []],
    ["R→P", ["Page"]],
    ["T→Y", []],
  ]);
  assert.deepEqual(card.readings.reuse, [
    { consumer: "P", dependency: "Y", used: 1, exported: 2, share: 1 / 2 },
    { consumer: "Q", dependency: "T", used: 1, exported: 1, share: 1 },
    { consumer: "Q", dependency: "Y", used: 1, exported: 2, share: 1 / 2 },
    { consumer: "R", dependency: "P", used: 1, exported: 2, share: 1 / 2 },
    { consumer: "T", dependency: "Y", used: 1, exported: 2, share: 1 / 2 },
  ], "Types now exports Mark alone; Pages' part exports Page and makePage");
});

test("5.15 · imports neither into nor out of a split file are read as they were", () => {
  const card = scorecardOf({
    tree: SPLIT_TREE,
    units: [],
    imports: [...SPLIT_IMPORTS, { from: at("r.ts"), to: at("y.ts"), used: ["other"], types: [] }],
    exports: SPLIT_EXPORTS,
    refactor: { splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page", "makePage"], [at("queues/types.ts")]: ["Queue", "Mark"] } }] },
  });
  assert.deepEqual(boundariesOf(card), [
    ["P→Y", []],
    ["Q→Y", []],
    ["R→P", ["Page"]],
    ["R→Y", []],
  ]);
});

test("5.15 · with no exports given, a split file's exported names are read from the imports into it, so a split leaving one in no part is still refused", () => {
  const files = [
    source("types.ts", ["export interface Page { readonly page: number }", "export interface Queue { readonly queue: number }", "export const makePage = 1;"]),
    source("r.ts", ['import type { Page } from "./types.js";', "export const r: Page | undefined = undefined;"]),
  ];
  assert.throws(
    () => scorecardOf({
      tree: SPLIT_TREE,
      units: [],
      imports: importsOf(files),
      refactor: { splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page"], [at("queues/types.ts")]: ["Queue"] } }] },
    }),
    (error: unknown) => {
      assert.ok(error instanceof VerbRefusal, `a refusal, not ${String(error)}`);
      assert.match(error.message, /packages\/p\/src\/types\.ts/);
      assert.match(error.message, /\bmakePage\b/);
      return true;
    },
  );
});

test("5.15 · a split leaving one of the file's exported names in no part is refused, naming the file and each name left out", () => {
  assert.throws(
    () => scorecardOf({
      tree: SPLIT_TREE,
      units: [],
      imports: SPLIT_IMPORTS,
      exports: SPLIT_EXPORTS,
      refactor: { splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page"], [at("queues/types.ts")]: ["Queue"] } }] },
    }),
    (error: unknown) => {
      assert.ok(error instanceof VerbRefusal, `a refusal, not ${String(error)}`);
      assert.match(error.message, /packages\/p\/src\/types\.ts/);
      assert.match(error.message, /\bmakePage\b/);
      assert.match(error.message, /\bMark\b/);
      return true;
    },
  );
});

const CYCLE_TREE = flat({ A: ["a.ts"], B: ["b.ts"], C: ["c.ts"], D: ["d.ts"] });

const CYCLE_IMPORTS: Import[] = [
  { from: at("a.ts"), to: at("b.ts"), used: ["Bee", "beta"], types: ["Bee"] },
  { from: at("b.ts"), to: at("a.ts"), used: ["alpha"], types: [] },
  { from: at("d.ts"), to: at("a.ts"), used: ["alpha"], types: [] },
];

const CYCLE_EXPORTS = new Map<string, readonly string[]>([
  [at("a.ts"), ["alpha"]], [at("b.ts"), ["Bee", "beta"]], [at("c.ts"), ["gamma"]], [at("d.ts"), []],
]);

test("5.15 · a retarget moves an import's names, all or those named, with their types, to a new file that then exports them, or drops them with no new file; a cycle it breaks is gone", () => {
  const before = scorecardOf({ tree: CYCLE_TREE, units: [], imports: CYCLE_IMPORTS, exports: CYCLE_EXPORTS });
  assert.equal(before.readings.cycleGate, "fail");
  const card = scorecardOf({
    tree: CYCLE_TREE,
    units: [],
    imports: CYCLE_IMPORTS,
    exports: CYCLE_EXPORTS,
    refactor: {
      retargets: [
        { file: at("b.ts"), from: at("a.ts"), to: at("c.ts") },
        { file: at("a.ts"), from: at("b.ts"), to: at("c.ts"), names: ["Bee"] },
        { file: at("d.ts"), from: at("a.ts") },
      ],
    },
  });
  assert.deepEqual(boundariesOf(card), [
    ["A→B", []],
    ["A→C", ["Bee"]],
    ["B→C", []],
  ]);
  assert.deepEqual(card.readings.cycles, []);
  assert.equal(card.readings.cycleGate, "pass");
  assert.deepEqual(card.readings.reuse, [
    { consumer: "A", dependency: "B", used: 1, exported: 2, share: 1 / 2 },
    { consumer: "A", dependency: "C", used: 1, exported: 3, share: 1 / 3 },
    { consumer: "B", dependency: "C", used: 1, exported: 3, share: 1 / 3 },
  ], "c.ts exports gamma, alpha and Bee; b.ts keeps both its names");
});

test("5.15 · retargets apply after the splits, one after another, so a retarget may move an import of a part, or one an earlier retarget made", () => {
  const card = scorecardOf({
    tree: SPLIT_TREE,
    units: [],
    imports: SPLIT_IMPORTS,
    exports: SPLIT_EXPORTS,
    refactor: {
      splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page", "makePage"], [at("queues/types.ts")]: ["Queue", "Mark"] } }],
      retargets: [
        { file: at("r.ts"), from: at("pages/types.ts"), to: at("queues/types.ts") },
        { file: at("r.ts"), from: at("queues/types.ts"), to: at("y.ts") },
      ],
    },
  });
  assert.deepEqual(boundariesOf(card), [
    ["P→Y", []],
    ["Q→Y", []],
    ["R→Y", ["Page"]],
  ]);
});

test("5.15 · a retarget of an import that does not exist is refused, naming the importing file and the file it names", () => {
  assert.throws(
    () => scorecardOf({ tree: CYCLE_TREE, units: [], imports: CYCLE_IMPORTS, exports: CYCLE_EXPORTS, refactor: { retargets: [{ file: at("c.ts"), from: at("a.ts"), to: at("d.ts") }] } }),
    (error: unknown) => {
      assert.ok(error instanceof VerbRefusal, `a refusal, not ${String(error)}`);
      assert.match(error.message, /packages\/p\/src\/c\.ts/);
      assert.match(error.message, /packages\/p\/src\/a\.ts/);
      return true;
    },
  );
});

interface Inversion {
  readonly parent: string | null;
  readonly from: string;
  readonly to: string;
  readonly fanIn: { readonly from: number; readonly to: number };
  readonly imports: readonly { readonly from: string; readonly to: string; readonly types: readonly string[] }[];
}

type Outside = readonly { readonly story: string; readonly to: string }[];

const inversionsOf = (tree: Tree, imports: readonly Import[], outside?: Outside): Inversion[] | undefined => {
  const read = (treeStructureOf as (tree: Tree, imports: readonly Import[], exports?: undefined, outside?: Outside) => TreeStructure & { inversions?: readonly Inversion[] })(tree, imports, undefined, outside).inversions;
  return read === undefined ? undefined : [...read]
    .map((one) => ({ ...one, imports: [...one.imports].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)) }))
    .sort((a, b) => String(a.parent).localeCompare(String(b.parent)) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
};

const UNDER: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "A", title: "Alpha", parent: "P" },
    { id: "B", title: "Beta", parent: "P" },
    { id: "B1", title: "Beta one", parent: "B" },
    { id: "B2", title: "Beta two", parent: "B" },
    { id: "Q", title: "Queues" },
    { id: "R", title: "Rest" },
  ],
  ownerOf: Object.fromEntries(([["p.ts", "P"], ["a.ts", "A"], ["a2.ts", "A"], ["b.ts", "B"], ["b1.ts", "B1"], ["b2.ts", "B2"], ["q.ts", "Q"], ["r.ts", "R"]] as [string, string][]).map(([file, id]) => [`${SOURCE}/${file}`, id])),
  unplaced: [],
};

test("5.16 · an import edge between siblings in a sibling cycle, from the more widely imported to the less, is named under its parent with both fan-ins and the node-to-node imports beneath it with their types; its reverse edge is not; a fan-in counts the distinct other nodes owning a file importing into its subtree, its parent included, not files and not nodes inside it", () => {
  const imports: Import[] = [
    ...edges([["a.ts", "b.ts"], ["a2.ts", "b.ts"], ["b2.ts", "a.ts"], ["b.ts", "b1.ts"], ["q.ts", "b1.ts"], ["r.ts", "b.ts"], ["p.ts", "b.ts"]]),
    { from: `${SOURCE}/b1.ts`, to: `${SOURCE}/a.ts`, types: ["Page"] },
  ];
  assert.deepEqual(inversionsOf(UNDER, imports), [{
    parent: "P",
    from: "B",
    to: "A",
    fanIn: { from: 4, to: 2 },
    imports: [
      { from: "B1", to: "A", types: ["Page"] },
      { from: "B2", to: "A", types: [] },
    ],
  }], "Beta is imported by Alpha, Queues, Rest and Pages (its parent's own file), not by its own Beta one; Alpha by Beta one and Beta two; only Beta → Alpha is named");
});

test("5.16 · an edge between siblings outside any cycle, or in a cycle between siblings imported equally widely, is not named", () => {
  const tree = flat({ X: ["x.ts"], Y: ["y.ts"], Z: ["z.ts"], W: ["w.ts"], C: ["c.ts"], D: ["d.ts", "d2.ts"] });
  const imports = edges([["x.ts", "y.ts"], ["z.ts", "x.ts"], ["w.ts", "x.ts"], ["c.ts", "d.ts"], ["d.ts", "c.ts"]]);
  assert.deepEqual(inversionsOf(tree, imports), [], "X (fan-in 2) → Y (fan-in 1) is in no cycle; C and D each have fan-in 1");
});

test("5.16 · a node's fan-in counts each other story whose files import into it once, so an equal cycle becomes an inversion once other stories import one end", () => {
  const tree = flat({ X: ["x.ts"], Y: ["y.ts"], Z: ["z.ts"], W: ["w.ts"], C: ["c.ts"], D: ["d.ts", "d2.ts"] });
  const imports = edges([["x.ts", "y.ts"], ["z.ts", "x.ts"], ["w.ts", "x.ts"], ["c.ts", "d.ts"], ["d.ts", "c.ts"]]);
  const outside = [
    { story: "story_one", to: `${SOURCE}/d.ts` },
    { story: "story_one", to: `${SOURCE}/d2.ts` },
    { story: "story_two", to: `${SOURCE}/d2.ts` },
  ];
  assert.deepEqual(inversionsOf(tree, imports, outside), [{
    parent: null,
    from: "D",
    to: "C",
    fanIn: { from: 3, to: 1 },
    imports: [{ from: "D", to: "C", types: [] }],
  }], "D is imported by C and two other stories, the first through two files; C by D alone");
});
