// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SourceText } from "./index.js";
import { scorecardOf, scorecardText } from "./scorecard.js";
import { planTreeOf, proposedTreeOf, type Tree } from "./tree.js";
import { importsOf } from "./tree-structure.js";

const SOURCE = "packages/p/src";
const at = (file: string) => `${SOURCE}/${file}`;
const source = (file: string, lines: readonly string[]): SourceText => ({ path: at(file), text: `${lines.join("\n")}\n` });

const FILES = [
  source("sh/index.ts", ["export const bit = 1;"]),
  source("p1/index.ts", ['import { two } from "../p2/two.js";', "export const front = two;"]),
  source("p1/more.ts", ['import { bit } from "../sh/index.js";', "export const m1 = bit;", "export const m2 = 2;", "export const m3 = 3;", "export const m4 = 4;"]),
  source("p2/two.ts", ['import { m1 } from "../p1/more.js";', "export const two = m1;"]),
];

const TREE: Tree = proposedTreeOf({
  nodes: [
    { id: "SH", title: "1 · Shared bits", files: [at("sh/index.ts")] },
    { id: "P", title: "2 · Pages" },
    { id: "P1", title: "First page", parent: "P", files: [at("p1/index.ts"), at("p1/more.ts")] },
    { id: "P2", title: "Second page", parent: "P", files: [at("p2/two.ts")] },
  ],
}, planTreeOf([], FILES.map(({ path }) => ({ path }))));

const readingsOf = (text: string): string => {
  const guidance = text.search(/^Guidance\b/m);
  assert.ok(guidance > 0, `a Guidance heading after the readings:\n${text}`);
  return text.slice(0, guidance);
};

const lineOf = (text: string, pattern: RegExp): string => {
  const found = text.split("\n").find((line) => pattern.test(line));
  assert.ok(found !== undefined, `a line matching ${pattern}:\n${text}`);
  return found;
};

test("5.10, 5.11, 5.12, 5.13, 5.14 · the printed scorecard names each new reading under Readings, before Guidance: meet depths, the entry share with offenders by file, split candidates by title, the cycle gate and the flagged technical names", () => {
  const readings = readingsOf(scorecardText(scorecardOf({ tree: TREE, units: [], imports: importsOf(FILES) })));
  const meet = lineOf(readings, /meet depth/i);
  assert.match(meet, /\b0\b/, "one import meets at the top level");
  assert.match(meet, /\b2\b/, "two meet under Pages");
  assert.match(lineOf(readings, /entr(y|ies)/i), /33(\.3)?%|1 of 3|1\/3/, "one of three sibling imports lands on an entry");
  assert.match(readings, /p2\/two\.ts.*p1\/more\.ts/, "Second page's import of First page's more.ts, not its index, is named by file");
  assert.match(readings, /p1\/index\.ts.*p2\/two\.ts/, "First page's import of Second page, which has no entry, is named by file");
  assert.match(lineOf(readings, /entry size/i), /exported/i, "the entry size reading is named and explained");
  assert.match(lineOf(readings, /First page:.*p1\/index\.ts/), /\b1\b.*\b4\b/, "First page's entry exports one name against four behind it");
  assert.match(lineOf(readings, /split/i), /Second page.*First page/, "Second page uses one of First page's five names");
  assert.match(lineOf(readings, /cycle gate/i), /fail.*Pages.*(First page.*Second page|Second page.*First page)/i);
  assert.match(lineOf(readings, /technical/i), /Shared bits/);
});

test("5.13 · the printed scorecard's cycle gate line reads pass when no cycle stands among siblings", () => {
  const imports = importsOf(FILES).filter(({ from }) => from !== at("p1/index.ts"));
  const readings = readingsOf(scorecardText(scorecardOf({ tree: TREE, units: [], imports })));
  const gate = lineOf(readings, /cycle gate/i);
  assert.match(gate, /\bpass\b/i);
  assert.doesNotMatch(gate, /\bfail\b/i);
});
