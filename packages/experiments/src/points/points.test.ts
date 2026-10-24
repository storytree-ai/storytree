/**
 * Capability 5 · Per-merge points and curves, against a stand-in for GitHub (the injected `gh`) and the real Postgres
 * `pnpm test` provides. Each test works in a project of its own, as the points' one database is shared by every project.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { Library, Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { ACTIVITY_DATABASE, openActivityLog } from "@storytree/session-management";

import { mounted, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { EXPERIMENT_FAMILIES } from "../record/verbs.js";
import { armWorkflowText, type ArmCi, type Gh } from "../repositories.js";
import { withLibrary } from "../testing/pg.js";
import { curves, recordArms, recordedLines, recordPoints, type Structure } from "./points.js";

/** The arm's tree as no survey sees it: tests about other measures read no repository. */
const NO_STRUCTURE: Structure = { at: async () => ({ crossImports: 0, lines: 0 }), close: async () => {} };

/** The measures of a point in an arm whose lanes have spent, run into and reworked nothing. */
const NOTHING_YET = { tokens: 0, claimRefusals: 0, reds: 0, conflicts: 0, rework: 0, crossImports: 0, lines: 0 };

const CI: ArmCi = { checks: "npm test", verifier: { testsRepository: "storytree-ai/hidden", command: "./verify.sh" } };

interface Merge {
  /** The seed commit the import pushed, which no pull request merged: its push run is the arm's first. */
  seed?: true;
  number: number; mergedAt: string; sha: string; passed?: number; total?: number; running?: true; workflow?: string; files: number[];
  /** The pull request's changed files as GitHub lists them, with their patches. */
  changed?: { filename: string; previous_filename?: string; patch?: string }[];
}

/**
 * GitHub as `gh` answers for one arm's repository holding `merges`, its code cloned from the folder `origin` when one is
 * given; it counts the job logs it is asked for.
 */
function github(merges: Merge[], repository = "storytree-ai/x-twin-map-reads-on", origin?: string): Gh & { logs: number } {
  const of = (sha: string) => merges.find((merge) => merge.sha === sha)!;
  const gh = ((args: readonly string[]) => {
    const [first, second] = args;
    if (first === "repo" && second === "clone" && origin !== undefined) {
      assert.equal(args[2], repository, "the arm's own repository is cloned");
      execFileSync("git", ["clone", ...args.slice(args.indexOf("--") + 1), origin, args[3]!], { stdio: "ignore" });
      return "";
    }
    if (first === "pr" && second === "list") {
      assert.ok(args.includes(repository), `the arm's own repository is read: ${args.join(" ")}`);
      return JSON.stringify(merges.filter((merge) => !merge.seed).map((merge) => ({ number: merge.number, mergedAt: merge.mergedAt, mergeCommit: { oid: merge.sha } })).reverse());
    }
    if (first === "run" && second === "list" && !args.includes("--commit")) {
      assert.ok(args.includes("push") && args.includes("main"), "the seed is found among the push runs on main");
      return JSON.stringify(merges.map((merge) => ({ headSha: merge.sha, createdAt: merge.mergedAt })).reverse());
    }
    if (first === "run" && second === "list") return JSON.stringify([{ databaseId: merges.findIndex((merge) => merge.sha === args[args.indexOf("--commit") + 1]) + 1, status: "completed" }]);
    const route = args.at(-1)!;
    let match = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(route);
    if (match !== null) {
      const merge = merges[Number(match[1]) - 1]!;
      return JSON.stringify({ jobs: [
        { id: 900, name: "verify", status: "completed", conclusion: "success" },
        { id: Number(match[1]), name: "hidden-tests", status: merge.running ? "in_progress" : "completed", conclusion: merge.running ? null : merge.passed === undefined ? "failure" : "success" },
      ] });
    }
    match = /^repos\/[^/]+\/[^/]+\/actions\/jobs\/(\d+)\/logs$/.exec(route);
    if (match !== null) {
      gh.logs += 1;
      const merge = merges[Number(match[1]) - 1]!;
      return `2026-10-17T10:00:00Z REPORT_COUNTS: line = "passed=" + Number(result.passed) + " total=" + Number(result.total);\n2026-10-17T10:01:00Z passed=${merge.passed} total=${merge.total}\n`;
    }
    match = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files\?per_page=100$/.exec(route);
    if (match !== null) {
      assert.ok(args.includes("--paginate") && args.includes("--slurp"), "every page of a pull request's files is read");
      const changed = merges.find((merge) => merge.number === Number(match![1]))!.changed ?? [];
      return JSON.stringify([changed.slice(0, 1), changed.slice(1)]);
    }
    match = /^repos\/[^/]+\/[^/]+\/git\/trees\/(\w+)\?recursive=1$/.exec(route);
    if (match !== null) return JSON.stringify({ truncated: false, tree: [{ type: "tree", path: "src" }, ...of(match[1]!).files.map((size, index) => ({ type: "blob", path: `src/${index}.ts`, size }))] });
    match = /^repos\/[^/]+\/[^/]+\/contents\/\.github\/workflows\/arm\.yml\?ref=(\w+)$/.exec(route);
    if (match !== null) return of(match[1]!).workflow ?? armWorkflowText(CI);
    throw new Error(`unexpected gh ${args.join(" ")}`);
  }) as Gh & { logs: number };
  gh.logs = 0;
  return gh;
}

test("5.1 · recording an arm writes one point per merge to main, in merge order, with the counts its hidden-tests run printed and the tree's files and bytes, never twice, and stops at a merge whose run has not finished", async () => {
  await withLibrary(async (library, server) => {
    const arm = { experiment: "twin", arm: "map-reads-on", ci: CI };
    const merges: Merge[] = [
      { number: 4, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 10, total: 370, files: [100, 200] },
      { number: 2, mergedAt: "2026-10-17T10:00:00Z", sha: "bbb", files: [100, 200, 50] },
      { number: 7, mergedAt: "2026-10-17T11:00:00Z", sha: "ccc", passed: 31, total: 370, running: true, files: [100] },
    ];
    const first = await recordPoints(server, library.name, arm, github(merges), NO_STRUCTURE);
    assert.deepEqual(first, {
      written: [
        { merge: 1, pr: 4, mergedAt: "2026-10-17T09:00:00Z", commit: "aaa", passed: 10, total: 370, files: 2, bytes: 300, workflowIntact: true, ...NOTHING_YET },
        { merge: 2, pr: 2, mergedAt: "2026-10-17T10:00:00Z", commit: "bbb", files: 3, bytes: 350, workflowIntact: true, ...NOTHING_YET },
      ],
      waiting: { pr: 7, commit: "ccc" },
    }, "a failed verifier is a point with no counts, and a running one stops the record there");

    delete merges[2]!.running;
    const again = github(merges);
    const second = await recordPoints(server, library.name, arm, again, NO_STRUCTURE);
    assert.deepEqual(second.written.map(({ merge, pr, passed }) => ({ merge, pr, passed })), [{ merge: 3, pr: 7, passed: 31 }]);
    assert.equal(again.logs, 1, "merges already recorded are not read again");
    assert.deepEqual((await curves(server, library.name, "twin"))["map-reads-on"]?.map(({ merge }) => merge), [1, 2, 3], "each merge has one point");
  });
});

test("5.2 · a merge whose arm workflow differs from the one the repository was seeded with is recorded as changed, and its curve flags it", async () => {
  await withLibrary(async (library, server) => {
    const merges: Merge[] = [
      { number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 10, total: 370, files: [1] },
      { number: 2, mergedAt: "2026-10-17T10:00:00Z", sha: "bbb", passed: 370, total: 370, workflow: armWorkflowText({ ...CI, verifier: { ...CI.verifier, command: "echo '{\"passed\":370,\"total\":370}' > $VERIFIER_RESULT" } }), files: [1] },
    ];
    const { written } = await recordPoints(server, library.name, { experiment: "twin", arm: "map-reads-on", ci: CI }, github(merges), NO_STRUCTURE);
    assert.deepEqual(written.map(({ workflowIntact }) => workflowIntact), [true, false]);
    const [family] = EXPERIMENT_FAMILIES;
    const curvesVerb = family!.verbs.find((one) => mounted(one.command) && one.command.name === "curves")!;
    const context: VerbContext = { library, project: library.name, session: "s", folder: process.cwd(), server };
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
    const { text } = await curvesVerb.act({ experiment: "twin", json: false }, context, words);
    const lines = text.split("\n");
    assert.doesNotMatch(lines.find((line) => line.includes("#1 "))!, /WORKFLOW CHANGED/);
    assert.match(lines.find((line) => line.includes("#2 "))!, /WORKFLOW CHANGED/);
  });
});

test("5.3 · experiment curves prints each arm's points as a series, and --json gives them as data per arm", async () => {
  await withLibrary(async (library, server) => {
    for (const [arm, passed] of [["map-reads-on", 40], ["map-reads-off", 25]] as const) {
      await recordPoints(server, library.name, { experiment: "twin", arm, ci: CI }, github([{ number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed, total: 370, files: [5] }], `storytree-ai/x-twin-${arm}`), NO_STRUCTURE);
    }
    const [family] = EXPERIMENT_FAMILIES;
    const curvesVerb = family!.verbs.find((one) => mounted(one.command) && one.command.name === "curves")!;
    const context: VerbContext = { library, project: library.name, session: "s", folder: process.cwd(), server };
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

    const data = await curvesVerb.act({ experiment: "twin", json: true }, context, words);
    assert.equal(data.raw, true);
    const parsed = JSON.parse(data.text) as { experiment: string; arms: Record<string, { merge: number; passed: number; total: number }[]> };
    assert.equal(parsed.experiment, "twin");
    assert.deepEqual(Object.fromEntries(Object.entries(parsed.arms).map(([arm, points]) => [arm, points.map(({ merge, passed, total }) => [merge, passed, total])])), {
      "map-reads-off": [[1, 25, 370]],
      "map-reads-on": [[1, 40, 370]],
    });

    const { text } = await curvesVerb.act({ experiment: "twin", json: false }, context, words);
    assert.match(text, /map-reads-off: 1 merge\n[^\n]*\n\s+1\s+#1\s.*25\/370\s+6\.8%/);
    assert.match(text, /map-reads-on: 1 merge\n[^\n]*\n\s+1\s+#1\s.*40\/370\s+10\.8%/);
    assert.match((await curvesVerb.act({ experiment: "other", json: false }, context, words)).text, /no points yet/);
  });
});

/** An experiment of a test's own, as an arm's project in the shared activity log is named after it. */
const experimentName = () => `t${randomBytes(4).toString("hex")}`;

/** Say what the log holds of `project` was written at `at`: its lines of `kinds` (pull request `pr`'s only, given one) and its stored records from byte `from` on. */
async function writtenAt(server: Storytree, project: string, at: string, { kinds = [], pr, from }: { kinds?: string[]; pr?: number; from?: number }): Promise<void> {
  const pool = await server.ownDatabase(ACTIVITY_DATABASE);
  await pool.query("UPDATE activity SET at = $2 WHERE project = $1 AND kind = ANY($3::text[]) AND ($4::int IS NULL OR (detail->>'pr')::int = $4)", [project, at, kinds, pr ?? null]);
  if (from !== undefined) await pool.query("UPDATE transcript_records SET at = $2 WHERE project = $1 AND start >= $3", [project, at, from]);
}

/** `experiment curves` as the command door answers it, as text or, with `json`, its data per arm. */
async function curvesAnswer(library: Library, server: Storytree, experiment: string, json: boolean): Promise<string> {
  const [family] = EXPERIMENT_FAMILIES;
  const curvesVerb = family!.verbs.find((one) => mounted(one.command) && one.command.name === "curves")!;
  const context: VerbContext = { library, project: library.name, session: "s", folder: process.cwd(), server };
  const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
  return (await curvesVerb.act({ experiment, json }, context, words)).text;
}

/** The value of one column of the curves' table on the line of pull request `pr`. */
function column(text: string, name: string, pr: number): string {
  const lines = text.split("\n");
  const header = lines.find((line) => line.includes(" merge  pr "))!;
  const row = lines.find((line) => line.includes(`#${pr} `))!;
  const start = header.indexOf(name);
  return row.slice(start).split(/\s+/)[0]!;
}

/** One Claude Code request, as its transcript records it. */
const request = (id: string, input: number, output: number) => JSON.stringify({ type: "assistant", requestId: id, message: { model: "claude-opus-5-5", role: "assistant", usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output } } });

test("5.4 · each point carries the tokens the arm's sessions had spent by its merge, read from the arm's own project's stored transcripts, and the curves give them", async () => {
  await withLibrary(async (library, server) => {
    const experiment = experimentName();
    const armProject = `x-${experiment}-map-reads-on`;
    const log = await openActivityLog(server);
    await log.append(armProject, { session: "L1", harness: "claude-code", source: "hook", kind: "session-started", transcript: "/lanes/L1.jsonl" });
    await log.transcripts.store(armProject, "L1", [{ part: "", start: 0, finish: 99, record: request("r1", 1_000, 200) }]);
    const elsewhere = `x-${experimentName()}-map-reads-on`;
    await log.transcripts.store(elsewhere, "L9", [{ part: "", start: 0, finish: 99, record: request("r9", 50_000, 1) }]);
    await log.transcripts.store(armProject, "L1", [{ part: "", start: 100, finish: 199, record: request("r2", 3_000, 300) }]);
    await writtenAt(server, armProject, "2026-10-17T09:00:00Z", { from: 0 });
    await writtenAt(server, elsewhere, "2026-10-17T09:00:00Z", { from: 0 });
    await writtenAt(server, armProject, "2026-10-17T11:00:00Z", { from: 100 });
    const [first, second] = ["2026-10-17T10:00:00Z", "2026-10-17T12:00:00Z"];
    const merges: Merge[] = [
      { number: 1, mergedAt: first, sha: "aaa", passed: 1, total: 370, files: [1] },
      { number: 2, mergedAt: second, sha: "bbb", passed: 2, total: 370, files: [1] },
    ];
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`), NO_STRUCTURE);
    assert.deepEqual(written.map(({ tokens }) => tokens), [1_200, 4_500], "tokens to date, never another project's");

    const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { tokens: number }[]> };
    assert.deepEqual(json.arms["map-reads-on"]!.map(({ tokens }) => tokens), [1_200, 4_500]);
    assert.equal(column(await curvesAnswer(library, server, experiment, false), "tokens", 2), "4500");
  });
});

test("5.5 · each point carries the arm's collisions by its merge: claims refused, pull requests gone red and, of those, conflicts with main, from the arm's own project's lines", async () => {
  await withLibrary(async (library, server) => {
    const experiment = experimentName();
    const armProject = `x-${experiment}-map-reads-on`;
    const log = await openActivityLog(server);
    const lane = { session: "L1", harness: "claude-code", source: "tool" } as const;
    await log.append(armProject, { ...lane, kind: "claim-refused", capability: "capability_a", holder: "L2", reason: "build the router" });
    const elsewhere = `x-${experimentName()}-map-reads-on`;
    await log.append(elsewhere, { ...lane, kind: "claim-refused", capability: "capability_a", holder: "L2", reason: "elsewhere" });
    await log.append(armProject, { ...lane, harness: "watcher", kind: "pr-red", pr: 5, increment: "increment_a", conflict: true, checks: [] });
    await log.append(armProject, { ...lane, harness: "watcher", kind: "pr-red", pr: 6, increment: "increment_b", conflict: false, checks: ["verify"] });
    await log.append(armProject, { ...lane, harness: "watcher", kind: "pr-red", pr: 7, increment: "increment_c", conflict: true, checks: [] });
    for (const project of [armProject, elsewhere]) await writtenAt(server, project, "2026-10-17T09:00:00Z", { kinds: ["claim-refused"] });
    await writtenAt(server, armProject, "2026-10-17T11:00:00Z", { kinds: ["pr-red"] });
    await writtenAt(server, armProject, "2026-10-17T13:00:00Z", { kinds: ["pr-red"], pr: 7 });
    const [first, second] = ["2026-10-17T10:00:00Z", "2026-10-17T12:00:00Z"];
    const merges: Merge[] = [
      { number: 1, mergedAt: first, sha: "aaa", passed: 1, total: 370, files: [1] },
      { number: 2, mergedAt: second, sha: "bbb", passed: 2, total: 370, files: [1] },
    ];
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`), NO_STRUCTURE);
    assert.deepEqual(written.map(({ claimRefusals, reds, conflicts }) => [claimRefusals, reds, conflicts]), [[1, 0, 0], [1, 2, 1]]);

    const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { claimRefusals: number; reds: number; conflicts: number }[]> };
    assert.deepEqual(json.arms["map-reads-on"]!.map(({ claimRefusals, reds, conflicts }) => [claimRefusals, reds, conflicts]), [[1, 0, 0], [1, 2, 1]]);
    const text = await curvesAnswer(library, server, experiment, false);
    assert.deepEqual(["refused", "red", "conflicts"].map((name) => column(text, name, 2)), ["1", "2", "1"]);
  });
});

test("5.6 · each point carries its rework: the lines its merge removed that one of the five merges before it added, matched by file and text, a blank line or an older merge's never counted", async () => {
  await withLibrary(async (library, server) => {
    const experiment = experimentName();
    const armProject = `x-${experiment}-map-reads-on`;
    const merges: Merge[] = [];
    const at = (hour: number) => `2026-10-17T${String(hour).padStart(2, "0")}:00:00Z`;
    // Merge 1 adds `old();`, merge 2 adds `keep();` and `redo();`, merges 3 to 6 touch another file, and merge 7 removes all three.
    merges.push({ number: 1, mergedAt: at(1), sha: "s1", files: [1], changed: [{ filename: "src/a.ts", patch: "@@ -0,0 +1,1 @@\n+old();" }] });
    merges.push({ number: 2, mergedAt: at(2), sha: "s2", files: [1], changed: [{ filename: "src/a.ts", patch: "@@ -1,0 +2,4 @@\n+keep();\n+redo();\n+-- note\n+" }] });
    for (let number = 3; number <= 6; number += 1) merges.push({ number, mergedAt: at(number), sha: `s${number}`, files: [1], changed: [{ filename: "src/b.ts", patch: `@@ -0,0 +1,1 @@\n+b${number}();` }] });
    merges.push({ number: 7, mergedAt: at(7), sha: "s7", files: [1], changed: [
      { filename: "src/a.ts", patch: "@@ -1,5 +1,1 @@\n-old();\n-keep();\n-redo();\n--- note\n-\n+new();" },
      { filename: "src/c.ts", previous_filename: "src/b.ts", patch: "@@ -1,1 +1,1 @@\n-b6();\n+c();" },
    ] });
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`), NO_STRUCTURE);
    assert.deepEqual(written.map(({ rework }) => rework), [0, 0, 0, 0, 0, 0, 4], "redo(), keep(), a line reading `-- note` and b6() are reworked; old() was added six merges back, and a blank line is no line");

    const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { rework: number }[]> };
    assert.equal(json.arms["map-reads-on"]!.at(-1)!.rework, 4);
    assert.equal(column(await curvesAnswer(library, server, experiment, false), "rework", 7), "4");
  });
});

/** Commit `files` to the repository at `folder`, as its next commit, and give that commit. */
function commit(folder: string, files: Record<string, string>): Promise<string> {
  return (async () => {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
      await writeFile(path.join(folder, file), text);
    }
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, encoding: "utf8" }).trim();
    git("add", "-A");
    git("commit", "--quiet", "-m", "next");
    return git("rev-parse", "HEAD");
  })();
}

test("5.7 · each point carries the imports crossing capability lines in the arm's tree at its merge, by the Map's survey against the arm's own library, and the source lines they are counted over", async () => {
  await withLibrary(async (library, server) => {
    // The arm's library is a database of its own here, named so the test databases' drop takes it.
    const experiment = `t-${randomBytes(4).toString("hex")}`;
    const armProject = `x-${experiment}-map-reads-on`;
    const arm = await server.openProject(armProject);
    const repository = await mkdtemp(path.join(tmpdir(), "arm-repository-"));
    try {
      const shop = await arm.addStory({ title: "Shop" });
      await arm.addCapability({ title: "1 · Cart", story: shop.id });
      await arm.addCapability({ title: "2 · Pay", story: shop.id });
      execFileSync("git", ["init", "--quiet", "--initial-branch=main", repository]);
      const shopFiles = {
        "packages/shop/package.json": JSON.stringify({ name: "shop", type: "module" }),
        "packages/shop/src/pay.ts": "// Capability 2 · Pay\nexport const pay = (total: number) => total;\n",
        "packages/shop/src/pay.test.ts": "import { test } from \"node:test\";\nimport { pay } from \"./pay.js\";\ntest(\"2.1 · pays\", () => { pay(1); });\n",
        "packages/shop/src/cart.test.ts": "import { test } from \"node:test\";\nimport { cart } from \"./cart.js\";\ntest(\"1.1 · holds\", () => { cart(); });\n",
      };
      const first = await commit(repository, { ...shopFiles, "packages/shop/src/cart.ts": "// Capability 1 · Cart\nexport const cart = () => [];\n" });
      // The cart now pays: one import across the line between Cart and Pay, made twice over, which is still one.
      const second = await commit(repository, { "packages/shop/src/cart.ts": "// Capability 1 · Cart\nimport { pay } from \"./pay.js\";\nimport type { } from \"./pay.js\";\nexport const cart = () => [pay(0)];\n" });
      const merges: Merge[] = [
        { number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: first, passed: 1, total: 370, files: [1] },
        { number: 2, mergedAt: "2026-10-17T10:00:00Z", sha: second, passed: 2, total: 370, files: [1] },
      ];
      const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`, repository));
      assert.deepEqual(written.map(({ crossImports, lines }) => [crossImports, lines]), [[0, 4], [1, 6]], "the cart's import of pay crosses from Cart into Pay; a test's imports are no crossing");

      const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { crossImports: number; lines: number }[]> };
      assert.deepEqual(json.arms["map-reads-on"]!.map(({ crossImports, lines }) => [crossImports, lines]), [[0, 4], [1, 6]]);
      const text = await curvesAnswer(library, server, experiment, false);
      assert.deepEqual(["crossings", "lines"].map((name) => column(text, name, 2)), ["1", "6"]);
    } finally {
      await arm.close();
      await dropTestDatabases([`storytree_${armProject}`]);
      await removeTemp(repository);
    }
  });
});

test("5.8 · the seed the import pushed is point zero, with the counts its push's hidden-tests run printed against the untouched start, recorded once and before any merge, and the curves show it as the seed", async () => {
  await withLibrary(async (library, server) => {
    const arm = { experiment: "twin", arm: "map-reads-on", ci: CI };
    const merges: Merge[] = [
      { seed: true, number: 0, mergedAt: "2026-10-17T08:00:00Z", sha: "sss", passed: 0, total: 372, running: true, files: [100] },
      { number: 3, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 12, total: 372, files: [100, 50] },
    ];
    assert.deepEqual(await recordPoints(server, library.name, arm, github(merges), NO_STRUCTURE), { written: [], waiting: { pr: 0, commit: "sss" } }, "no merge is recorded before the seed's run finishes");

    delete merges[0]!.running;
    const { written } = await recordPoints(server, library.name, arm, github(merges), NO_STRUCTURE);
    assert.deepEqual(written, [
      { merge: 0, pr: 0, mergedAt: "2026-10-17T08:00:00Z", commit: "sss", passed: 0, total: 372, files: 1, bytes: 100, workflowIntact: true, ...NOTHING_YET },
      { merge: 1, pr: 3, mergedAt: "2026-10-17T09:00:00Z", commit: "aaa", passed: 12, total: 372, files: 2, bytes: 150, workflowIntact: true, ...NOTHING_YET },
    ]);
    const again = github(merges);
    assert.deepEqual((await recordPoints(server, library.name, arm, again, NO_STRUCTURE)).written, []);
    assert.equal(again.logs, 0, "the seed, once recorded, is not read again");

    const text = await curvesAnswer(library, server, "twin", false);
    assert.match(text, /map-reads-on: 2 merges\n[^\n]*\n\s+0\s+seed\s.*0\/372\s+0\.0%[^\n]*\n\s+1\s+#3\s.*12\/372/);
  });
});

test("5.9 · an arm recorded without the CI it was seeded with judges each merge's workflow against the one at its seed commit, still after the seed is recorded, and refuses when it has no seed to judge by", async () => {
  await withLibrary(async (library, server) => {
    const arm = { experiment: "twin", arm: "map-reads-on" };
    const seeded = armWorkflowText({ ...CI, checks: "bash ci/checks.sh" });
    const merges: Merge[] = [
      { seed: true, number: 0, mergedAt: "2026-10-17T08:00:00Z", sha: "sss", passed: 0, total: 372, workflow: seeded, files: [1] },
      { number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 3, total: 372, workflow: seeded, files: [1] },
      { number: 2, mergedAt: "2026-10-17T10:00:00Z", sha: "bbb", passed: 9, total: 372, running: true, workflow: armWorkflowText(CI), files: [1] },
    ];
    const first = await recordPoints(server, library.name, arm, github(merges), NO_STRUCTURE);
    assert.deepEqual(first.written.map(({ merge, workflowIntact }) => [merge, workflowIntact]), [[0, true], [1, true]]);

    delete merges[2]!.running;
    const second = await recordPoints(server, library.name, arm, github(merges), NO_STRUCTURE);
    assert.deepEqual(second.written.map(({ merge, workflowIntact }) => [merge, workflowIntact]), [[2, false]], "the seed recorded earlier is still the reference");

    const unseeded: Merge[] = [{ number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 3, total: 372, files: [1] }];
    const gh = github(unseeded, "storytree-ai/x-twin-map-reads-off");
    const noSeed = ((args: readonly string[]) => (args[0] === "run" && args[1] === "list" && !args.includes("--commit") ? "[]" : gh(args))) as Gh;
    await assert.rejects(recordPoints(server, library.name, { experiment: "twin", arm: "map-reads-off" }, noSeed, NO_STRUCTURE), /no seed commit/);
  });
});

test("5.10 · recording an experiment records each of its arms in turn, an arm that fails said without stopping the others, and says per arm what it wrote and where it waits", async () => {
  await withLibrary(async (library, server) => {
    const on: Merge[] = [
      { seed: true, number: 0, mergedAt: "2026-10-17T08:00:00Z", sha: "sss", passed: 0, total: 372, files: [1] },
      { number: 4, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 12, total: 372, files: [1] },
      { number: 5, mergedAt: "2026-10-17T10:00:00Z", sha: "bbb", passed: 20, total: 372, running: true, files: [1] },
    ];
    const onGh = github(on, "storytree-ai/x-twin-map-reads-on");
    const gh = ((args: readonly string[]) => {
      if (args.includes("storytree-ai/x-twin-map-reads-off") || args.some((arg) => arg.startsWith("repos/storytree-ai/x-twin-map-reads-off/"))) throw new Error("gh: HTTP 404");
      return onGh(args);
    }) as Gh;
    const results = await recordArms(server, library.name, "twin", ["map-reads-off", "map-reads-on"], { gh, structure: () => NO_STRUCTURE });
    assert.deepEqual(results.map(({ arm, recorded, error }) => [arm, recorded?.written.map(({ merge }) => merge), recorded?.waiting?.pr, error === undefined ? undefined : /404/.test(error)]),
      [["map-reads-off", undefined, undefined, true], ["map-reads-on", [0, 1], 5, undefined]]);
    const lines = recordedLines(results);
    assert.match(lines.find((line) => line.startsWith("map-reads-off"))!, /could not be recorded: .*404/);
    assert.match(lines.find((line) => line.startsWith("map-reads-on"))!, /recorded the seed \(0\/372\) and merge 1 \(#4, 12\/372\); waiting for #5's hidden-tests run/);
    const again = recordedLines(await recordArms(server, library.name, "twin", ["map-reads-on"], { gh: github(on.slice(0, 2), "storytree-ai/x-twin-map-reads-on"), structure: () => NO_STRUCTURE }));
    assert.deepEqual(again, ["map-reads-on: nothing new to record"]);
  });
});

test("5.11 · points a run records for its frozen record under the run's short name are read by experiment curves given either the record or the short name, and points recorded before the record was named are tied to it at the next record", async () => {
  await withLibrary(async (library, server) => {
    const on: Merge[] = [
      { seed: true, number: 0, mergedAt: "2026-10-17T08:00:00Z", sha: "sss", passed: 0, total: 372, files: [1] },
      { number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed: 12, total: 372, files: [1] },
    ];
    await recordArms(server, library.name, "twin", ["map-reads-on"], { gh: github(on), structure: () => NO_STRUCTURE });
    on.push({ number: 2, mergedAt: "2026-10-17T10:00:00Z", sha: "bbb", passed: 20, total: 372, files: [1] });
    await recordArms(server, library.name, "twin", ["map-reads-on"], { gh: github(on), structure: () => NO_STRUCTURE, record: "experiment_twin" });
    for (const name of ["experiment_twin", "twin"]) {
      assert.deepEqual((await curves(server, library.name, name))["map-reads-on"]?.map(({ merge, passed }) => [merge, passed]), [[0, 0], [1, 12], [2, 20]], `curves read by ${name}`);
      assert.match(await curvesAnswer(library, server, name, false), /map-reads-on: 3 merges/);
    }
  });
});

test("5.12 · an arm whose tree keeps its code outside its stories' packages, as the twin build's vinext/ does, still counts its source lines at each merge, and its crossings are unmeasured, never zero", async () => {
  await withLibrary(async (library, server) => {
    const experiment = `t-${randomBytes(4).toString("hex")}`;
    const armProject = `x-${experiment}-map-reads-on`;
    const arm = await server.openProject(armProject);
    const repository = await mkdtemp(path.join(tmpdir(), "arm-repository-"));
    try {
      // The arms plan stories titled as sentences, so their packages would be packages/<sentence>/, which no arm tree has.
      const story = await arm.addStory({ title: "A Next.js Pages Router app runs unchanged on vinext" });
      await arm.addCapability({ title: "1 · Pages render", story: story.id });
      execFileSync("git", ["init", "--quiet", "--initial-branch=main", repository]);
      const sha = await commit(repository, {
        "vinext/package.json": JSON.stringify({ name: "vinext", type: "module" }),
        "vinext/src/index.js": "import { route } from \"./router.js\";\n\nexport const serve = (url) => route(url);\n",
        "vinext/src/router.ts": "export const route = (url: string) => url;\n",
        "vinext/test/router.test.js": "import { test } from \"node:test\";\nimport { route } from \"../src/router.js\";\ntest(\"routes\", () => route(\"/\"));\n",
        "vinext/test/helpers.js": "export const page = () => \"/\";\n",
        "vinext/src/testing/stub.js": "export const stub = 1;\n",
        "vinext/src/types.d.ts": "export type Url = string;\n",
        "vinext/dist/index.js": "export const built = 1;\n",
        "apps/basic/pages/index.tsx": "export default function Home() {\n  return null;\n}\n",
        "e2e/pages.spec.ts": "import { test } from \"@playwright/test\";\ntest(\"home\", () => {});\n",
        "node_modules/react/index.js": "module.exports = {};\n",
        "run_tests.sh": "#!/bin/sh\nnpx playwright test\n",
      });
      const merges: Merge[] = [{ number: 1, mergedAt: "2026-10-17T09:00:00Z", sha, passed: 1, total: 372, files: [1] }];
      const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`, repository));
      assert.deepEqual(written.map(({ crossImports, lines }) => [crossImports, lines]), [[undefined, 6]], "vinext/src's two files and apps' page; no test, helper, declaration, build or dependency");

      const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { crossImports?: number; lines: number }[]> };
      assert.deepEqual(json.arms["map-reads-on"]!.map(({ crossImports, lines }) => [crossImports, lines]), [[undefined, 6]]);
      const text = await curvesAnswer(library, server, experiment, false);
      assert.deepEqual(["crossings", "lines"].map((name) => column(text, name, 1)), ["-", "6"]);
    } finally {
      await arm.close();
      await dropTestDatabases([`storytree_${armProject}`]);
      await removeTemp(repository);
    }
  });
});
