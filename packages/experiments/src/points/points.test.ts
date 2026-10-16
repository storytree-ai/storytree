/**
 * Capability 5 · Per-merge points and curves, against a stand-in for GitHub (the injected `gh`) and the real Postgres
 * `pnpm test` provides. Each test works in a project of its own, as the points' one database is shared by every project.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { mounted, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { EXPERIMENT_FAMILIES } from "../record/verbs.js";
import { armWorkflowText, type ArmCi, type Gh } from "../repositories.js";
import { withLibrary } from "../testing/pg.js";
import { curves, recordPoints } from "./points.js";

const CI: ArmCi = { checks: "npm test", verifier: { testsRepository: "storytree-ai/hidden", command: "./verify.sh" } };

interface Merge { number: number; mergedAt: string; sha: string; passed?: number; total?: number; running?: true; workflow?: string; files: number[] }

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
        { merge: 1, pr: 4, mergedAt: "2026-10-17T09:00:00Z", commit: "aaa", passed: 10, total: 370, files: 2, bytes: 300, workflowIntact: true },
        { merge: 2, pr: 2, mergedAt: "2026-10-17T10:00:00Z", commit: "bbb", files: 3, bytes: 350, workflowIntact: true },
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
