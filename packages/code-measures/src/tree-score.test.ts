// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { test } from "node:test";
import { VerbRefusal } from "@storytree/library/verbs";

import { planTreeOf, proposedTreeOf, type Tree } from "./tree.js";
import { importsOf, treeStructureOf, type Import, type NodeStructure, type TreeStructure } from "./tree-structure.js";
import type { SourceText } from "./index.js";

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
