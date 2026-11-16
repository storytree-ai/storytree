/**
 * Capability 3 · Story node render (the forest story): what an opened capability draws inside it, read from its code's own
 * nested parts (ADR-1339 D1).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { StorySurvey } from "@storytree/library";
import { sceneParts } from "./scene-parts.js";

const S = "story_s", T = "story_t";
// Capability a holds three parts, one with a deeper part inside it, and a file of its own in none; b holds one part only.
const survey: StorySurvey = {
  files: [
    { path: "src/a.ts", lines: 20, capability: "a" },
    { path: "src/tax/index.ts", lines: 30, capability: "a" },
    { path: "src/tax/payments/index.ts", lines: 50, capability: "a" },
    { path: "src/tax/payments/card.ts", lines: 100, capability: "a" },
    { path: "src/ledger/index.ts", lines: 40, capability: "a" },
    { path: "src/report/index.ts", lines: 10, capability: "a" },
    { path: "src/b/index.ts", lines: 60, capability: "b" },
    { path: "src/c.ts", lines: 5, capability: "c" },
  ],
  imports: [
    { from: "src/ledger/index.ts", to: "src/tax/payments/card.ts" },
    { from: "src/tax/index.ts", to: "src/ledger/index.ts" },
    { from: "src/tax/payments/card.ts", to: "src/tax/index.ts" },
    { from: "src/report/index.ts", to: "src/ledger/index.ts" },
  ],
  edges: [
    { story: S, from: "a", to: "b", typeOnly: false, files: [{ from: "src/report/index.ts", to: "src/b/index.ts", typeOnly: false }] },
    { story: S, from: "c", to: "a", typeOnly: false, files: [{ from: "src/c.ts", to: "src/tax/payments/card.ts", typeOnly: false }, { from: "src/c.ts", to: "src/a.ts", typeOnly: false }] },
  ],
  parts: {
    capabilities: {
      a: [
        { folder: "src/ledger", entry: "src/ledger/index.ts", files: ["src/ledger/index.ts"], parts: [] },
        { folder: "src/report", entry: "src/report/index.ts", files: ["src/report/index.ts"], parts: [] },
        { folder: "src/tax", entry: "src/tax/index.ts", files: ["src/tax/index.ts"], parts: [{ folder: "src/tax/payments", entry: "src/tax/payments/index.ts", files: ["src/tax/payments/card.ts", "src/tax/payments/index.ts"], parts: [] }] },
      ],
      b: [{ folder: "src/b", entry: "src/b/index.ts", files: ["src/b/index.ts"], parts: [] }],
    },
    clashes: [],
  },
};
// Another story's capability z imports a's ledger.
const other: StorySurvey = { files: [{ path: "z.ts", lines: 9, capability: "z" }], imports: [], edges: [{ story: S, from: "z", to: "a", typeOnly: false, files: [{ from: "z.ts", to: "src/ledger/index.ts", typeOnly: false }] }] };

test("3.112 · each capability with two or more parts to draw opens into its outermost parts and its own files, sized by every line inside, with a road between parts whose files import each other", () => {
  const found = sceneParts({ [S]: survey, [T]: other }, new Map([["a", "1 · Alpha"]]));
  assert.deepEqual(found.map(({ story, capability }) => [story, capability]), [[S, "a"]], "b, with one part and no files of its own, has nothing to open");
  const [a] = found;
  assert.deepEqual(a!.shares, [
    { capability: "src/ledger", title: "ledger", lines: 40 },
    { capability: "src/report", title: "report", lines: 10 },
    { capability: "src/tax", title: "tax", lines: 180 },
    { capability: "a", title: "1 · Alpha", lines: 20 },
  ], "tax holds payments' lines; a's own file is a territory named by a");
  assert.deepEqual(a!.links, [{ from: "src/ledger", to: "src/tax" }, { from: "src/report", to: "src/ledger" }, { from: "src/tax", to: "src/ledger" }], "an import inside one part is no road");
});

test("3.112 · each link the code shows names the parts its files reach inside, from this story and from others", () => {
  const [a] = sceneParts({ [S]: survey, [T]: other });
  assert.deepEqual(a!.lanes, { "a->b": ["src/report"], "c->a": ["a", "src/tax"], "z->a": ["src/ledger"] });
});

test("3.120 · each part road an import reaching round a part's front door rides on names the part it reaches, by the road's ends as the opened capability shows them", () => {
  const clash = (from: string, to: string, part: string, enters: string[]) => ({ from, to, part, enters, around: enters, suggestion: "" });
  const clashes = [
    // ledger reaches round tax's entry into payments: at a's level the road ledger -> tax carries it.
    clash("src/ledger/index.ts", "src/tax/payments/card.ts", "src/tax/payments", ["src/tax", "src/tax/payments"]),
    // c, another capability of the story, does too: its lane into tax carries it.
    clash("src/c.ts", "src/tax/payments/card.ts", "src/tax/payments", ["src/tax", "src/tax/payments"]),
    // report reaches round ledger's own entry: the part it reaches is the one shown.
    clash("src/report/index.ts", "src/ledger/other.ts", "src/ledger", ["src/ledger"]),
    // Inside tax, and between two other capabilities: no road of a's carries either.
    clash("src/tax/index.ts", "src/tax/payments/card.ts", "src/tax/payments", ["src/tax/payments"]),
    clash("src/c.ts", "src/b/deep.ts", "src/b", ["src/b"]),
  ];
  const files = [...survey.files, { path: "src/ledger/other.ts", lines: 1, capability: "a" }, { path: "src/b/deep.ts", lines: 1, capability: "b" }];
  const ledger = { folder: "src/ledger", entry: "src/ledger/index.ts", files: ["src/ledger/index.ts", "src/ledger/other.ts"], parts: [] };
  const capabilities = { ...survey.parts!.capabilities, a: survey.parts!.capabilities.a!.map((part) => (part.folder === "src/ledger" ? ledger : part)) };
  const [a] = sceneParts({ [S]: { ...survey, files, parts: { capabilities, clashes } }, [T]: other });
  assert.deepEqual(a!.clashes, { "c->src/tax": ["src/tax/payments"], "src/ledger->src/tax": ["src/tax/payments"], "src/report->src/ledger": ["src/ledger"] });
  assert.deepEqual(sceneParts({ [S]: survey, [T]: other })[0]!.clashes, {}, "no clash, no road marked");
});
