// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbInputs } from "@storytree/library/verbs";
import { withLibrary } from "@storytree/library/testing/pg";
import { removeTemp } from "@storytree/test-waits";

import { CODE_MEASURES_FAMILIES } from "./verbs.js";

import { scorecardOf, scorecardText, type Lead, type Scorecard } from "./scorecard.js";
import type { Tree } from "./tree.js";

const SRC = "packages/p/src";
const unit = (...files: string[]) => ({ files: files.map((file) => `${SRC}/${file}`) });
const times = (count: number, made: { files: readonly string[] }) => Array.from({ length: count }, () => made);

const TREE: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "E", title: "Epsilon" },
    { id: "A", title: "Alpha", parent: "P" },
    { id: "B", title: "Beta", parent: "P" },
    { id: "C", title: "Gamma", parent: "Q" },
    { id: "D", title: "Delta", parent: "Q" },
  ],
  ownerOf: Object.fromEntries(([["a.ts", "A"], ["b.ts", "B"], ["c.ts", "C"], ["d.ts", "D"], ["e.ts", "E"]] as [string, string][]).map(([file, id]) => [`${SRC}/${file}`, id])),
  unplaced: [],
};

const UNITS = [
  ...times(5, unit("a.ts", "c.ts", "d.ts")),
  ...times(5, unit("a.ts", "b.ts", "d.ts", "e.ts")),
  ...times(6, unit("d.ts", "e.ts")),
  ...times(4, unit("d.ts")),
];

const leadsOf = (guidance: readonly Lead[]) => guidance.map((lead) => (lead.kind === "merge-or-nest" ? [lead.kind, [lead.a, lead.b].sort(), lead.lift] : [lead.kind, lead.parent, lead.lift])).sort((x, y) => String(x[0]).localeCompare(String(y[0])));

test("5.9 · the scorecard's guidance leads are merge-or-nest for a pair at lift 2 or more split across top-level groups, and no change family for a parent whose children's pairs average lift 1 or less, apart from its readings", () => {
  const card = scorecardOf({ tree: TREE, units: UNITS, imports: [] });
  assert.deepEqual(leadsOf(card.guidance), [
    ["merge-or-nest", ["A", "C"], 2],
    ["no-change-family", "Q", 1],
  ], "Alpha–Gamma at lift 2 across Pages and Queues; Alpha–Beta at lift 2 sit in one group; Beta–Epsilon at 1.8 is under 2; Queues' Gamma–Delta average 1; Pages' Alpha–Beta average 2");
  assert.deepEqual(Object.keys(card.readings).sort(), ["boundaries", "cycleGate", "cycles", "depths", "entries", "grouping", "inversions", "meetDepths", "nodes", "pairs", "reuse", "splitCandidates", "technicalNames", "unplaced"], "every measured reading on the card, the leads apart from them");
});

test("5.9 · the printed scorecard puts the readings first and the leads under a Guidance heading after them, each naming its nodes by title, with no verdict", () => {
  const text = scorecardText(scorecardOf({ tree: TREE, units: UNITS, imports: [] }));
  const at = text.search(/^Guidance\b/m);
  assert.ok(at > 0, `a Guidance heading after the readings:\n${text}`);
  const readings = text.slice(0, at);
  const guidance = text.slice(at);
  assert.match(readings, /^Readings\b/m, "a Readings heading");
  assert.match(readings, /TurboMQ/, "the grouping's reading is among the readings");
  assert.doesNotMatch(readings, /merge-or-nest|no change family/i, "no lead among the readings");
  const merge = guidance.split("\n").filter((line) => /merge-or-nest/i.test(line));
  assert.equal(merge.length, 1, `one merge-or-nest lead:\n${guidance}`);
  assert.match(merge[0]!, /Alpha/);
  assert.match(merge[0]!, /Gamma/);
  const family = guidance.split("\n").filter((line) => /no change family/i.test(line));
  assert.equal(family.length, 1, `one no change family lead:\n${guidance}`);
  assert.match(family[0]!, /Queues/);
  assert.equal(text.match(/cycle gate/gi)?.length, 1, "one sibling-cycle gate line");
  assert.doesNotMatch(text.replace(/^.*cycle gate.*$/gim, ""), /\b(pass(ed)?|fail(ed|s)?|verdict)\b/i, "report only: no verdict but the sibling-cycle gate's");
});

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const PACKAGE = "packages/tree-fixture";

function checkout(t: TestContext, files: Readonly<Record<string, string>> = {}, repository: Readonly<Record<string, string>> = {}): string {
  const folder = mkdtempSync(path.join(tmpdir(), "tree-verb-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Tree test", "-c", "user.email=tree@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: folder, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  git("init", "-q", "-b", "main");
  write("package.json", '{ "name": "fixture", "private": true }\n');
  write(`${PACKAGE}/package.json`, '{ "name": "@ws/tree-fixture", "exports": { ".": "./src/a.ts" } }\n');
  for (const name of ["a", "c", "e"]) write(`${PACKAGE}/src/${name}.ts`, `export const ${name} = 0;\n`);
  for (const [file, text] of Object.entries(files)) write(`${PACKAGE}/src/${file}`, text);
  for (const [file, text] of Object.entries(repository)) write(file, text);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const change = (round: number, names: readonly string[]) => {
    git("checkout", "-q", "-b", `round-${round}`);
    for (const name of names) write(`${PACKAGE}/src/${name}.ts`, `export const ${name} = ${round};\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `round ${round}`);
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", `Merge round ${round}`, `round-${round}`);
  };
  for (let round = 1; round <= 5; round++) change(round, ["a", "c"]);
  for (let round = 6; round <= 10; round++) change(round, ["e"]);
  return folder;
}

function treeVerb(): Verb<VerbInputs, VerbContext> {
  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  const verb = family?.verbs.find((one) => mounted(one.command) && one.command.name === "tree") as Verb<VerbInputs, VerbContext> | undefined;
  assert.ok(verb !== undefined, "the code-measures family has a tree verb");
  return verb;
}

test("5.9 · storytree code-measures tree <story> --tree <file> grades the proposed tree over the checkout's merge history, printing readings apart from guidance and the same as JSON, writing nothing and answering", async (t) => {
  const tree = treeVerb();
  assert.equal(tree.writes, undefined, "it declares no write: report only");
  const folder = checkout(t);
  const proposal = path.join(folder, "proposal.json");
  writeFileSync(proposal, JSON.stringify({
    nodes: [
      { id: "P", title: "Pages" },
      { id: "A", title: "Alpha", parent: "P", files: [`${PACKAGE}/src/a.ts`] },
      { id: "Q", title: "Queues" },
      { id: "C", title: "Gamma", parent: "Q", files: [`${PACKAGE}/src/c.ts`] },
      { id: "E", title: "Epsilon", files: [`${PACKAGE}/src/e.ts`] },
    ],
  }));

  await withLibrary(async (library) => {
    await library.addStory({ title: "Tree fixture" });
    const before = await library.latestChanges();
    const context: VerbContext = { folder, project: library.name, session: "s", library };

    const data = await tree.act({ story: "Tree fixture", tree: proposal, json: true }, context, WORDS);
    assert.equal(data.raw, true);
    const card = JSON.parse(data.text) as Scorecard & { readings: { pairs: { a: string; b: string; support: number }[] } };
    assert.deepEqual(card.readings.pairs.map(({ a, b, support }) => [[a, b].sort(), support]), [[["A", "C"], 5]], "Alpha and Gamma changed together in five merges");
    assert.deepEqual(leadsOf(card.guidance), [["merge-or-nest", ["A", "C"], 2]], "lift 5·10/(5·5) = 2 across Pages and Queues");

    const text = (await tree.act({ story: "Tree fixture", tree: proposal, json: false }, context, WORDS)).text;
    const at = text.search(/^Guidance\b/m);
    assert.ok(at > 0 && /^Readings\b/m.test(text.slice(0, at)), `readings, then guidance:\n${text}`);
    assert.match(text.slice(at), /merge-or-nest.*Alpha.*Gamma|merge-or-nest.*Gamma.*Alpha/i);

    assert.deepEqual(await library.latestChanges(), before, "nothing written to the library");
  });
});

test("5.9 · storytree code-measures tree <story> without --tree grades the plan's tree: the story's capabilities nested by parent, its source files no capability owns named unplaced", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t);
  await withLibrary(async (library) => {
    const story = await library.addStory({ title: "Tree fixture" });
    const reading = await library.addCapability({ story: story.id, title: "1 · Reading" });
    const drafts = await library.addCapability({ story: story.id, title: "2 · Drafts", parent: reading.id }, { levels: [`${PACKAGE}/src/drafts`] });
    const context: VerbContext = { folder, project: library.name, session: "s", library };

    const card = JSON.parse((await tree.act({ story: story.id, json: true }, context, WORDS)).text) as Scorecard & { readings: { unplaced: string[] } };
    assert.deepEqual(
      [...card.nodes].map(({ id, parent }) => [id, parent ?? null]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      [[reading.id, null], [drafts.id, reading.id]].sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    assert.deepEqual([...card.readings.unplaced].sort(), ["a", "c", "e"].map((name) => `${PACKAGE}/src/${name}.ts`), "no test reaches them, so the owner rule gives them no capability");
  });
});

const SPLIT_FILES = {
  "types.ts": "export interface Page { readonly page: number }\nexport interface Queue { readonly queue: number }\n",
  "use.ts": 'import type { Page, Queue } from "./types.js";\nexport const use: [Page, Queue] | undefined = undefined;\n',
};

test("5.15 · storytree code-measures tree <story> --tree <file> reads the file's splits: a split file's types crossing a boundary land on the parts that hold them", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t, SPLIT_FILES);
  const proposal = path.join(folder, "proposal.json");
  const at = (file: string) => `${PACKAGE}/src/${file}`;
  writeFileSync(proposal, JSON.stringify({
    nodes: [
      { id: "U", title: "Users", files: [at("use.ts"), at("a.ts"), at("c.ts"), at("e.ts")] },
      { id: "P", title: "Pages", files: [at("pages/types.ts")] },
      { id: "Q", title: "Queues", files: [at("queues/types.ts")] },
    ],
    splits: [{ file: at("types.ts"), into: { [at("pages/types.ts")]: ["Page"], [at("queues/types.ts")]: ["Queue"] } }],
  }));
  await withLibrary(async (library) => {
    await library.addStory({ title: "Tree fixture" });
    const context: VerbContext = { folder, project: library.name, session: "s", library };
    const card = JSON.parse((await tree.act({ story: "Tree fixture", tree: proposal, json: true }, context, WORDS)).text) as Scorecard;
    assert.deepEqual(card.readings.boundaries.map(({ from, to, types }) => [`${from}→${to}`, types]), [["U→P", ["Page"]], ["U→Q", ["Queue"]]]);
    assert.deepEqual(card.readings.unplaced, [], "the split file left the tree; its parts are taken");
  });
});

test("5.15 · storytree code-measures tree <story> --tree <file> reads the file's retargets: a retargeted import's types cross to its new file", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t, SPLIT_FILES);
  const proposal = path.join(folder, "proposal.json");
  const at = (file: string) => `${PACKAGE}/src/${file}`;
  writeFileSync(proposal, JSON.stringify({
    nodes: [
      { id: "U", title: "Users", files: [at("use.ts"), at("a.ts"), at("c.ts"), at("e.ts")] },
      { id: "T", title: "Types", files: [at("types.ts")] },
      { id: "P", title: "Pages", files: [at("pages/types.ts")] },
    ],
    retargets: [{ file: at("use.ts"), from: at("types.ts"), to: at("pages/types.ts"), names: ["Page"] }],
  }));
  await withLibrary(async (library) => {
    await library.addStory({ title: "Tree fixture" });
    const context: VerbContext = { folder, project: library.name, session: "s", library };
    const card = JSON.parse((await tree.act({ story: "Tree fixture", tree: proposal, json: true }, context, WORDS)).text) as Scorecard;
    assert.deepEqual(card.readings.boundaries.map(({ from, to, types }) => [`${from}→${to}`, types]), [["U→P", ["Page"]], ["U→T", ["Queue"]]]);
  });
});

test("5.15 · a proposed tree file whose splits or retargets are not of their shapes is refused as misuse, naming the list", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t);
  const at = (file: string) => `${PACKAGE}/src/${file}`;
  const nodes = [{ id: "U", title: "Users", files: [at("a.ts"), at("c.ts"), at("e.ts")] }];
  const malformed = [
    { splits: [{ file: at("a.ts"), into: [at("a/one.ts")] }] },
    { splits: [{ file: at("a.ts"), into: { [at("a/one.ts")]: "a" } }] },
    { splits: { file: at("a.ts") } },
    { retargets: [{ file: at("a.ts"), to: at("c.ts") }] },
    { retargets: [{ file: at("a.ts"), from: at("c.ts"), names: "c" }] },
    { retargets: [{ file: at("a.ts"), from: at("c.ts"), to: 3 }] },
  ];
  await withLibrary(async (library) => {
    await library.addStory({ title: "Tree fixture" });
    const context: VerbContext = { folder, project: library.name, session: "s", library };
    for (const [which, extra] of malformed.entries()) {
      const proposal = path.join(folder, `proposal-${which}.json`);
      writeFileSync(proposal, JSON.stringify({ nodes, ...extra }));
      await assert.rejects(tree.act({ story: "Tree fixture", tree: proposal, json: true }, context, WORDS), (error: unknown) => {
        assert.ok(error instanceof VerbRefusal, `a refusal for ${JSON.stringify(extra)}, not ${String(error)}`);
        assert.equal(error.misuse, true, `misuse for ${JSON.stringify(extra)}`);
        assert.match(error.message, new RegExp(Object.keys(extra)[0]!), `the malformed list is named for ${JSON.stringify(extra)}`);
        return true;
      });
    }
  });
});

const CYCLE_FILES = {
  "x.ts": 'import { y, type Queue } from "./y.js";\nexport const x = 1;\nexport const xy = (queue: Queue) => [y, queue];\n',
  "y.ts": 'import { x } from "./x.js";\nexport interface Queue { readonly queue: number }\nexport const y = () => x;\n',
  "alpha.test.ts": 'import { test } from "node:test";\nimport { a } from "./a.js";\nimport { x } from "./x.js";\ntest("1.1 · alpha", () => void [a, x]);\n',
  "gamma.test.ts": 'import { test } from "node:test";\nimport { y } from "./y.js";\ntest("2.1 · gamma", () => void y);\n',
};

const OTHER_STORY = {
  "packages/other-fixture/package.json": '{ "name": "@ws/other-fixture" }\n',
  "packages/other-fixture/src/o.ts": 'import { a } from "@ws/tree-fixture";\nexport const o = a;\n',
};

interface Inverted {
  readonly parent: string | null;
  readonly from: string;
  readonly to: string;
  readonly fanIn: { readonly from: number; readonly to: number };
  readonly imports: readonly { readonly from: string; readonly to: string; readonly types: readonly string[] }[];
}

test("5.16 · storytree code-measures tree <story> --tree <file> names an inversion from a sibling cycle, another story's package importing into a node raising its fan-in, in JSON and on the printed inverted line", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t, CYCLE_FILES, OTHER_STORY);
  const proposal = path.join(folder, "proposal.json");
  const at = (file: string) => `${PACKAGE}/src/${file}`;
  writeFileSync(proposal, JSON.stringify({
    nodes: [
      { id: "A", title: "Alpha", files: [at("a.ts"), at("x.ts")] },
      { id: "G", title: "Gamma", files: [at("y.ts"), at("c.ts"), at("e.ts")] },
    ],
  }));
  await withLibrary(async (library) => {
    await library.addStory({ title: "Tree fixture" });
    await library.addStory({ title: "Other fixture" });
    const context: VerbContext = { folder, project: library.name, session: "s", library };
    const card = JSON.parse((await tree.act({ story: "Tree fixture", tree: proposal, json: true }, context, WORDS)).text) as Scorecard & { readings: { inversions?: readonly Inverted[] } };
    assert.deepEqual(card.readings.inversions, [{ parent: null, from: "A", to: "G", fanIn: { from: 2, to: 1 }, imports: [{ from: "A", to: "G", types: ["Queue"] }] }], "Alpha is imported by Gamma and by Other fixture's o.ts, Gamma by Alpha alone");
    const text = (await tree.act({ story: "Tree fixture", tree: proposal, json: false }, context, WORDS)).text;
    const inverted = text.slice(0, text.search(/^Guidance\b/m)).split("\n").find((line) => /^ {2}inverted\b/.test(line));
    assert.ok(inverted !== undefined, `an inverted line among the readings:\n${text}`);
    assert.match(inverted, /under the top level, Alpha \(fan-in 2\) → Gamma \(fan-in 1\)/);
    assert.match(inverted, /Alpha → Gamma: Queue/);
  });
});

test("5.16 · storytree code-measures tree <story> without --tree names an inversion among the plan's capabilities, another story's package importing into one raising its fan-in", async (t) => {
  const tree = treeVerb();
  const folder = checkout(t, CYCLE_FILES, OTHER_STORY);
  await withLibrary(async (library) => {
    const story = await library.addStory({ title: "Tree fixture" });
    await library.addStory({ title: "Other fixture" });
    const alpha = await library.addCapability({ story: story.id, title: "1 · Alpha" });
    const gamma = await library.addCapability({ story: story.id, title: "2 · Gamma" });
    const context: VerbContext = { folder, project: library.name, session: "s", library };
    const card = JSON.parse((await tree.act({ story: story.id, json: true }, context, WORDS)).text) as Scorecard & { readings: { inversions?: readonly Inverted[] } };
    assert.deepEqual(card.readings.inversions, [{ parent: null, from: alpha.id, to: gamma.id, fanIn: { from: 2, to: 1 }, imports: [{ from: alpha.id, to: gamma.id, types: ["Queue"] }] }], "Alpha's tests reach a.ts and x.ts, Gamma's y.ts; Other fixture's o.ts imports a.ts through the package's entry");
    const text = (await tree.act({ story: story.id, json: false }, context, WORDS)).text;
    assert.match(text.slice(0, text.search(/^Guidance\b/m)), /^ {2}inverted .*under the top level, 1 · Alpha \(fan-in 2\) → 2 · Gamma \(fan-in 1\).*1 · Alpha → 2 · Gamma: Queue/m);
  });
});
