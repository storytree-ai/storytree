// Capability 5 · Capability tree scorecard
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { removeTemp } from "@storytree/test-waits";

interface Unit {
  readonly merge: string;
  readonly files: readonly string[];
}

interface Dropped extends Unit {
  readonly why: "over 30 files" | "rename";
}

interface Pair {
  readonly a: string;
  readonly b: string;
  readonly support: number;
  readonly lift: number;
  readonly jaccard: number;
}

interface Spread {
  readonly value: number;
  readonly mean: number;
  readonly p95: number;
}

interface Tree {
  readonly nodes: readonly { id: string; title: string; parent?: string }[];
  readonly ownerOf: Readonly<Record<string, string>>;
  readonly unplaced: readonly string[];
}

interface CoChangeSeam {
  readCoChange(folder: string, commit: string): Promise<{ kept: readonly Unit[]; dropped: readonly Dropped[] }>;
  pairsOf(units: readonly { files: readonly string[] }[], ownerOf: Readonly<Record<string, string>>): Pair[];
  groupingOf(units: readonly { files: readonly string[] }[], tree: Tree): { mq: Spread; inside: Spread; runs: number };
}

async function coChange(): Promise<CoChangeSeam> {
  const module = "./co-change.js";
  const loaded = (await import(module).catch(() => ({}))) as Record<string, unknown>;
  for (const name of ["readCoChange", "pairsOf", "groupingOf"]) assert.equal(typeof loaded[name], "function", `${module} exports ${name}`);
  return loaded as unknown as CoChangeSeam;
}

function near(actual: number, expected: number, what: string, within = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < within, `${what}: ${actual}, expected ${expected}`);
}

const SRC = "packages/p/src";

interface History {
  readonly folder: string;
  readonly head: string;
  readonly merges: Readonly<Record<string, string>>;
}

function history(t: TestContext): History {
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
  const { readCoChange } = await coChange();
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

const unit = (...files: string[]) => ({ files: files.map((file) => `${SRC}/${file}`) });
const times = (count: number, made: { files: readonly string[] }) => Array.from({ length: count }, () => made);

test("5.2 · node pairs are ranked by lift, with Jaccard beside it, over the units touching the tree's nodes, at support 5 or more: a hub's frequent pair at chance ranks below a rarer pair that always changes together", async () => {
  const { pairsOf } = await coChange();
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

test("5.3 · the top-level grouping reads Bunch TurboMQ and the share of co-change inside groups, each beside its mean and 95th percentile over 500 random groupings of the same sizes from a fixed seed, the same on every run", async () => {
  const { groupingOf } = await coChange();
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
