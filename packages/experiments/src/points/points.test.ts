/**
 * Capability 5 · Per-merge points and curves, against a stand-in for GitHub (the injected `gh`) and the real Postgres
 * `pnpm test` provides. Each test works in a project of its own, as the points' one database is shared by every project.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import type { Library, Storytree } from "@storytree/library";
import { ACTIVITY_DATABASE, openActivityLog } from "@storytree/session-management";

import { mounted, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { EXPERIMENT_FAMILIES } from "../record/verbs.js";
import { armWorkflowText, type ArmCi, type Gh } from "../repositories.js";
import { withLibrary } from "../testing/pg.js";
import { curves, recordPoints } from "./points.js";

/** The measures of a point in an arm whose lanes have spent, run into and reworked nothing. */
const NOTHING_YET = { tokens: 0, claimRefusals: 0, reds: 0, conflicts: 0, rework: 0 };

const CI: ArmCi = { checks: "npm test", verifier: { testsRepository: "storytree-ai/hidden", command: "./verify.sh" } };

interface Merge {
  number: number; mergedAt: string; sha: string; passed?: number; total?: number; running?: true; workflow?: string; files: number[];
  /** The pull request's changed files as GitHub lists them, with their patches. */
  changed?: { filename: string; previous_filename?: string; patch?: string }[];
}

/** GitHub as `gh` answers for one arm's repository holding `merges`; it counts the job logs it is asked for. */
function github(merges: Merge[], repository = "storytree-ai/x-twin-map-reads-on"): Gh & { logs: number } {
  const of = (sha: string) => merges.find((merge) => merge.sha === sha)!;
  const gh = ((args: readonly string[]) => {
    const [first, second] = args;
    if (first === "pr" && second === "list") {
      assert.ok(args.includes(repository), `the arm's own repository is read: ${args.join(" ")}`);
      return JSON.stringify(merges.map((merge) => ({ number: merge.number, mergedAt: merge.mergedAt, mergeCommit: { oid: merge.sha } })).reverse());
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
    const first = await recordPoints(server, library.name, arm, github(merges));
    assert.deepEqual(first, {
      written: [
        { merge: 1, pr: 4, mergedAt: "2026-10-17T09:00:00Z", commit: "aaa", passed: 10, total: 370, files: 2, bytes: 300, workflowIntact: true, ...NOTHING_YET },
        { merge: 2, pr: 2, mergedAt: "2026-10-17T10:00:00Z", commit: "bbb", files: 3, bytes: 350, workflowIntact: true, ...NOTHING_YET },
      ],
      waiting: { pr: 7, commit: "ccc" },
    }, "a failed verifier is a point with no counts, and a running one stops the record there");

    delete merges[2]!.running;
    const again = github(merges);
    const second = await recordPoints(server, library.name, arm, again);
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
    const { written } = await recordPoints(server, library.name, { experiment: "twin", arm: "map-reads-on", ci: CI }, github(merges));
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
      await recordPoints(server, library.name, { experiment: "twin", arm, ci: CI }, github([{ number: 1, mergedAt: "2026-10-17T09:00:00Z", sha: "aaa", passed, total: 370, files: [5] }], `storytree-ai/x-twin-${arm}`));
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
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`));
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
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`));
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
    const { written } = await recordPoints(server, library.name, { experiment, arm: "map-reads-on", ci: CI }, github(merges, `storytree-ai/${armProject}`));
    assert.deepEqual(written.map(({ rework }) => rework), [0, 0, 0, 0, 0, 0, 4], "redo(), keep(), a line reading `-- note` and b6() are reworked; old() was added six merges back, and a blank line is no line");

    const json = JSON.parse(await curvesAnswer(library, server, experiment, true)) as { arms: Record<string, { rework: number }[]> };
    assert.equal(json.arms["map-reads-on"]!.at(-1)!.rework, 4);
    assert.equal(column(await curvesAnswer(library, server, experiment, false), "rework", 7), "4");
  });
});
