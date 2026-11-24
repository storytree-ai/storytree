// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { removeTemp } from "@storytree/test-waits";

import { groupingOf, pairsOf, readCoChange } from "./co-change.js";
import type { Tree } from "./tree.js";

function near(actual: number, expected: number, what: string, within = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < within, `${what}: ${actual}, expected ${expected}`);
}

const SRC = "packages/p/src";

interface History {
  readonly folder: string;
  readonly head: string;
  readonly merges: Readonly<Record<string, string>>;
}

function repo(t: TestContext) {
  const folder = mkdtempSync(path.join(tmpdir(), "co-change-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Co-change test", "-c", "user.email=co-change@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: folder, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  const merged = (branch: string) => {
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", `Merge ${branch}`, branch);
    return git("rev-parse", "HEAD");
  };
  return { folder, git, write, commit, merged };
}

function history(t: TestContext): History {
  const { folder, git, write, commit, merged } = repo(t);
  const merges: Record<string, string> = {};

  git("init", "-q", "-b", "main");
  write(`${SRC}/a.ts`, "export const a = 1;\n");
  write(`${SRC}/b.ts`, "export const b = 1;\n");
  write(`${SRC}/c.ts`, "export const c = 1;\nexport const cc = 'a line long enough to keep a rename whole';\n");
  write(`${SRC}/a.test.ts`, 'import { a } from "./a.js";\nvoid a;\n');
  write("README.md", "# fixture\n");
  commit("base");

  git("checkout", "-q", "-b", "both");
  write(`${SRC}/a.ts`, "export const a = 2;\n");
  write(`${SRC}/b.ts`, "export const b = 2;\n");
  write(`${SRC}/a.test.ts`, 'import { a } from "./a.js";\nvoid a;\nvoid 2;\n');
  write("README.md", "# fixture, edited\n");
  commit("a and b");
  merges.both = merged("both");

  write(`${SRC}/c.ts`, "export const c = 2;\nexport const cc = 'a line long enough to keep a rename whole';\n");
  commit("a direct commit on main is no unit");

  git("checkout", "-q", "-b", "thirty");
  for (let n = 0; n < 30; n++) write(`${SRC}/gen/f${String(n).padStart(2, "0")}.ts`, `export const f${n} = ${n};\n`);
  write(`${SRC}/gen/f.test.ts`, "export {};\n");
  write("docs/thirty.md", "thirty\n");
  commit("thirty source files, a test and a doc");
  merges.thirty = merged("thirty");

  git("checkout", "-q", "-b", "sweep");
  for (let n = 0; n < 31; n++) write(`${SRC}/sweep/s${String(n).padStart(2, "0")}.ts`, `export const s${n} = ${n};\n`);
  commit("thirty-one source files");
  merges.sweep = merged("sweep");

  git("checkout", "-q", "-b", "rename");
  git("mv", `${SRC}/c.ts`, `${SRC}/see.ts`);
  write(`${SRC}/a.ts`, "export const a = 3;\n");
  commit("c renamed whole, a edited");
  merges.rename = merged("rename");

  git("checkout", "-q", "-b", "outer");
  write(`${SRC}/b.ts`, "export const b = 3;\n");
  commit("b on the outer branch");
  git("checkout", "-q", "-b", "inner");
  write(`${SRC}/see.ts`, "export const c = 3;\nexport const cc = 'a line long enough to keep a rename whole';\n");
  commit("see on the inner branch");
  git("checkout", "-q", "outer");
  git("merge", "-q", "--no-ff", "-m", "Merge inner into outer", "inner");
  git("checkout", "-q", "main");
  write(`${SRC}/a.ts`, "export const a = 4;\n");
  commit("a direct on main while outer was open");
  merges.outer = merged("outer");

  return { folder, head: git("rev-parse", "HEAD"), merges };
}

test("5.2 · co-change units are the merges on main's first-parent history, each the source files it changed against its first parent; a unit over 30 source files or with a whole-file rename is dropped as a structural sweep", async (t) => {
  const { folder, head, merges } = history(t);
  const read = await readCoChange(folder, head);

  const thirty = Array.from({ length: 30 }, (_, n) => `${SRC}/gen/f${String(n).padStart(2, "0")}.ts`);
  assert.deepEqual(
    Object.fromEntries(read.kept.map(({ merge, files }) => [merge, [...files].sort()])),
    {
      [merges.both!]: [`${SRC}/a.ts`, `${SRC}/b.ts`],
      [merges.thirty!]: thirty,
      [merges.outer!]: [`${SRC}/b.ts`, `${SRC}/see.ts`],
    },
    "only main's merges, source files only (no test, no doc), and outer's changes against main's line, not a.ts edited on main meanwhile; the inner merge and direct commits are no unit",
  );
  assert.deepEqual(
    Object.fromEntries(read.dropped.map(({ merge, why }) => [merge, why])),
    { [merges.sweep!]: "over 30 files", [merges.rename!]: "rename" },
  );
});

const LONG = "export const kept = 'a line long enough to keep a rename whole, even with an edit beside it';\n";

function renamed(t: TestContext): History {
  const { folder, git, write, commit, merged } = repo(t);
  const merges: Record<string, string> = {};

  git("init", "-q", "-b", "main");
  write(`${SRC}/a.ts`, "export const a = 1;\n");
  write(`${SRC}/b.ts`, "export const b = 1;\n");
  write(`${SRC}/c.ts`, `export const c = 1;\n${LONG}`);
  write(`${SRC}/d.ts`, `export const d = 1;\n${LONG}`);
  write(`${SRC}/x.ts`, "export const x = 1;\n");
  write(`${SRC}/w.ts`, "export const w = 1;\n");
  write(`${SRC}/y.ts`, "export const y = 'the file that takes the path x leaves, long enough to be kept whole';\n");
  commit("base");

  git("checkout", "-q", "-b", "early");
  write(`${SRC}/a.ts`, "export const a = 2;\n");
  write(`${SRC}/c.ts`, `export const c = 2;\n${LONG}`);
  write(`${SRC}/d.ts`, `export const d = 2;\n${LONG}`);
  commit("a, c and d before any rename");
  merges.early = merged("early");

  write(`${SRC}/c.ts`, `export const c = 4;\n${LONG}`);
  commit("c edited by a direct commit on main before it is renamed");

  git("checkout", "-q", "-b", "move");
  git("mv", `${SRC}/c.ts`, `${SRC}/see.ts`);
  commit("c renamed whole to see");
  merges.move = merged("move");

  mkdirSync(path.join(folder, SRC, "deep"), { recursive: true });
  git("mv", `${SRC}/see.ts`, `${SRC}/deep/see.ts`);
  commit("see moved into deep by a direct commit on main");

  git("checkout", "-q", "-b", "sweep");
  for (let n = 0; n < 31; n++) write(`${SRC}/sweep/s${String(n).padStart(2, "0")}.ts`, `export const s${n} = ${n};\n`);
  mkdirSync(path.join(folder, SRC, "dee"), { recursive: true });
  git("mv", `${SRC}/d.ts`, `${SRC}/dee/d.ts`);
  commit("thirty-one new files and d moved into dee");
  merges.sweep = merged("sweep");

  git("checkout", "-q", "-b", "again");
  write(`${SRC}/c.ts`, "export const fresh = 'a new file at an old name';\n");
  write(`${SRC}/a.ts`, "export const a = 3;\n");
  commit("a fresh c at the name c left, and a");
  merges.again = merged("again");

  git("checkout", "-q", "-b", "late");
  write(`${SRC}/b.ts`, "export const b = 2;\n");
  write(`${SRC}/deep/see.ts`, `export const c = 3;\n${LONG}`);
  commit("b and deep/see after every rename");
  merges.late = merged("late");

  git("checkout", "-q", "-b", "gone");
  write(`${SRC}/x.ts`, "export const x = 2;\n");
  write(`${SRC}/w.ts`, "export const w = 2;\n");
  commit("x and w before they are deleted");
  merges.gone = merged("gone");

  git("rm", "-q", `${SRC}/x.ts`, `${SRC}/w.ts`);
  commit("x and w deleted by a direct commit on main");
  git("mv", `${SRC}/y.ts`, `${SRC}/x.ts`);
  write(`${SRC}/w.ts`, "export const w = 'a new file at a deleted name, long enough to be kept whole';\n");
  commit("y renamed onto the path x left, and w added afresh");
  git("mv", `${SRC}/x.ts`, `${SRC}/z.ts`);
  git("mv", `${SRC}/w.ts`, `${SRC}/v.ts`);
  commit("the new x renamed to z and the new w to v");

  return { folder, head: git("rev-parse", "HEAD"), merges };
}

test("5.2 · a unit's files are named by their paths today, following every later rename on main's first-parent line, by a dropped rename merge, a direct commit on main or a dropped sweep, chained through more than one and past an edit of the old path between; a rename made after a unit leaves it alone; a file deleted before another took its path, by a rename onto it or a fresh add, keeps its own path", async (t) => {
  const { folder, head, merges } = renamed(t);
  const read = await readCoChange(folder, head);

  assert.deepEqual(
    Object.fromEntries(read.kept.map(({ merge, files }) => [merge, [...files].sort()])),
    {
      [merges.early!]: [`${SRC}/a.ts`, `${SRC}/dee/d.ts`, `${SRC}/deep/see.ts`],
      [merges.again!]: [`${SRC}/a.ts`, `${SRC}/c.ts`],
      [merges.late!]: [`${SRC}/b.ts`, `${SRC}/deep/see.ts`],
      [merges.gone!]: [`${SRC}/w.ts`, `${SRC}/x.ts`],
    },
    "early's c.ts reads deep/see.ts through the edit on main, the rename merge and then the direct commit, and its d.ts reads dee/d.ts through the sweep; again's fresh c.ts, made after c.ts was renamed, stays c.ts; gone's x.ts and w.ts, deleted before y took x's path and a new w was added, stay x.ts and w.ts, not z.ts and v.ts",
  );
  assert.deepEqual(
    Object.fromEntries(read.dropped.map(({ merge, why }) => [merge, why])),
    { [merges.move!]: "rename", [merges.sweep!]: "over 30 files" },
    "the merges that renamed are still dropped as structural sweeps",
  );
});

const unit = (...files: string[]) => ({ files: files.map((file) => `${SRC}/${file}`) });
const times = (count: number, made: { files: readonly string[] }) => Array.from({ length: count }, () => made);

test("5.2 · node pairs are ranked by lift, with Jaccard beside it, over the units touching the tree's nodes, at support 5 or more: a hub's frequent pair at chance ranks below a rarer pair that always changes together", () => {
  const ownerOf = Object.fromEntries(([["a1.ts", "A"], ["a2.ts", "A"], ["b.ts", "B"], ["c.ts", "C"], ["d.ts", "D"], ["e.ts", "E"], ["h.ts", "H"]] as [string, string][]).map(([file, id]) => [`${SRC}/${file}`, id]));
  const units = [
    ...times(5, unit("b.ts", "c.ts")),
    ...times(4, unit("d.ts", "e.ts")),
    ...times(9, unit("h.ts", "a1.ts")),
    unit("h.ts", "a1.ts", "a2.ts"),
    ...times(10, unit("h.ts")),
    ...times(5, unit("a2.ts")),
    ...times(2, { files: ["packages/other/src/o.ts"] }),
  ];
  const pairs = pairsOf(units, ownerOf);
  assert.deepEqual(pairs.map(({ a, b, support }) => [a, b, support]), [["B", "C", 5], ["A", "H", 10]], "D and E at support 4 are left out; B–C at lift 6.8 ranks above A–H's support 10 at lift 1.13");
  near(pairs[0]!.lift, (5 * 34) / (5 * 5), "B–C lift over the 34 units touching a node");
  near(pairs[0]!.jaccard, 5 / (5 + 5 - 5), "B–C Jaccard");
  near(pairs[1]!.lift, (10 * 34) / (15 * 20), "A–H lift: A in 15 units, H in 20");
  near(pairs[1]!.jaccard, 10 / (15 + 20 - 10), "A–H Jaccard");
});

const GROUPED: Tree = {
  nodes: [
    { id: "P", title: "Pages" },
    { id: "Q", title: "Queues" },
    { id: "A", title: "Alpha", parent: "P" },
    { id: "B", title: "Beta", parent: "P" },
    { id: "C", title: "Gamma", parent: "Q" },
    { id: "D", title: "Delta", parent: "Q" },
  ],
  ownerOf: Object.fromEntries(([["a.ts", "A"], ["b.ts", "B"], ["c.ts", "C"], ["d.ts", "D"]] as [string, string][]).map(([file, id]) => [`${SRC}/${file}`, id])),
  unplaced: [],
};

test("5.3 · the top-level grouping reads Bunch TurboMQ and the share of co-change inside groups, counted between files, each beside its mean and 95th percentile over 500 random groupings of the files into groups of the same sizes from a fixed seed, the same on every run", () => {
  const units = [...times(3, unit("a.ts", "b.ts")), ...times(3, unit("c.ts", "d.ts")), unit("a.ts", "c.ts")];
  const read = groupingOf(units, GROUPED);

  assert.equal(read.runs, 500);
  near(read.mq.value, 6 / 7 + 6 / 7, "TurboMQ: P and Q each 2·3/(2·3 + 1)");
  near(read.inside.value, 6 / 7, "six of seven co-changes inside a group");
  near(read.mq.p95, 12 / 7, "the best of the three same-size groupings, drawn a third of the time");
  near(read.inside.p95, 6 / 7, "the best grouping's inside share");
  near(read.mq.mean, (12 / 7 + 1 / 4 + 0) / 3, "near the mean of {A,B}{C,D} 12/7, {A,C}{B,D} 1/4 and {A,D}{B,C} 0", 0.15);
  near(read.inside.mean, (6 / 7 + 1 / 7 + 0) / 3, "near the mean of 6/7, 1/7 and 0", 0.08);

  assert.deepEqual(groupingOf(units, GROUPED), read, "a fixed seed reads the same history the same on every run");
});

const nodes = (...pairs: [string, string?][]) => pairs.map(([id, parent]) => ({ id, title: id, ...(parent === undefined ? {} : { parent }) }));
const owned = (...pairs: [string, string][]) => Object.fromEntries(pairs.map(([file, id]) => [`${SRC}/${file}`, id]));

test("5.3 · merging two capabilities that change together, moving one's files under the other, keeps their co-change inside the group: a pair of files under one node counts inside, so the merge lowers neither TurboMQ nor the inside share, and its random groupings shuffle the files, not the nodes", () => {
  const units = [...times(4, unit("a.ts", "b.ts")), ...times(2, unit("a.ts", "c.ts")), ...times(2, unit("c.ts", "d.ts"))];
  const split: Tree = { nodes: nodes(["P"], ["Q"], ["A", "P"], ["B", "P"], ["C", "P"], ["D", "Q"]), ownerOf: owned(["a.ts", "A"], ["b.ts", "B"], ["c.ts", "C"], ["d.ts", "D"]), unplaced: [] };
  const merged: Tree = { nodes: nodes(["P"], ["Q"], ["A", "P"], ["C", "P"], ["D", "Q"]), ownerOf: owned(["a.ts", "A"], ["b.ts", "A"], ["c.ts", "C"], ["d.ts", "D"]), unplaced: [] };

  const before = groupingOf(units, split);
  const after = groupingOf(units, merged);

  near(before.inside.value, 6 / 8, "before: a–b 4 and a–c 2 of the 8 file pairs sit inside P");
  near(before.mq.value, 12 / 14, "before: P 2·6/(2·6 + 2), Q nothing inside");
  near(after.inside.value, 6 / 8, "after: a.ts and b.ts both under A still count inside P");
  near(after.mq.value, 12 / 14, "after: the merge keeps P's TurboMQ");

  near(after.mq.p95, 12 / 14, "the best of the four ways to put one file in Q, drawn a quarter of the time");
  near(after.inside.p95, 6 / 8, "the best way's inside share");
  near(after.mq.mean, (6 / 7 + 2 / 5 + 2 / 3 + 2 / 3) / 4, "near the mean of d, a, b or c alone in Q: 6/7, 2/5, 2/3, 2/3; shuffling the nodes A, C, D would give about 1.0", 0.05);
  near(after.inside.mean, (6 / 8 + 2 / 8 + 4 / 8 + 4 / 8) / 4, "near the mean of 6/8, 2/8, 4/8, 4/8; shuffling the nodes would give about 0.67", 0.05);
});
