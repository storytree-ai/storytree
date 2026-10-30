/**
 * Capability 2 · Change review and capability 4 · Review loop bound: contracts 2.1 to 2.3 and 4.1 to 4.7 on the
 * real Postgres `pnpm test` provides, through the package's public entry, against a library holding an
 * increment, the contracts of the capabilities it names, and live checks. Contract 4.4 is also proved at the
 * two front doors, beside the command line's tests and the MCP server's, because this package cannot depend
 * back on either.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { Library } from "@storytree/library";
import { PLUGIN_INTERFACE } from "@storytree/plugin-loader/factory";

import { withLibrary } from "../testing/pg.js";
import { RED_RUN } from "./review.js";
import { branchDiff, briefText, changeFolder, COVERING_TEST, factoryPlugins, openLedger, openReviews, qualityTools, REVIEW_LIMIT, standingText, takenText, worktreeChange, type ReviewReturn } from "../index.js";

const DIFF = [
  "diff --git a/packages/forest-world/src/camera.test.ts b/packages/forest-world/src/camera.test.ts",
  "+  assert.equal(zoom(2), 2 * BASE);",
  "diff --git a/packages/library/src/a.ts b/packages/library/src/a.ts",
  "+export const a = 1;",
].join("\n");

/** A plan with one increment naming one capability (two contracts), a capability it does not name, and two live checks. */
async function plan(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const named = await library.addCapability({ title: "1 · Email form", story: story.id });
  const other = await library.addCapability({ title: "2 · Password reset", story: story.id });
  const first = await library.addContract({ capability: named.id, title: "1.1 · A bad email is refused", description: "No @, no account." });
  const second = await library.addContract({ capability: named.id, title: "1.2 · A good email is kept" });
  await library.addContract({ capability: other.id, title: "2.1 · A reset link expires" });
  const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "SECRET BREAKDOWN of how to build it", capabilities: [named.id] });
  const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
  const tautology = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
  const skips = await library.writeKnowledge("check", { title: "Silent skip", description: "Tests that skip without saying so.", question: "Does any test skip silently?", enforces: [principle.id] });
  const retired = await library.writeKnowledge("check", { title: "Retired check", description: "Gone.", question: "Gone?", enforces: [principle.id] });
  await library.retire(retired.id, "no longer asked");
  return { arc: arc.id, increment: increment.id, capability: named.id, contracts: [first.id, second.id], checks: [tautology.id, skips.id].sort() };
}

/** Review `review`'s return that answers every check (none tripped unless given) and every contract (met). */
function clean(checks: readonly string[], contracts: readonly string[], tripped: Record<string, { file: string; line: number; found: string }[]> = {}, review = 1): ReviewReturn {
  return {
    review,
    checks: checks.map((check) => ({ check, tripped: (tripped[check] ?? []).length > 0, hits: tripped[check] ?? [] })),
    contracts: contracts.map((contract) => ({ contract, met: true, touched: true, test: `${COVERING} › the contract's test` })),
  };
}

/** The test file a clean return names as each touched contract's covering test (contract 2.13). */
const COVERING = "packages/forest-world/src/camera.test.ts";

test("2.1 · the first brief holds the branch's diff, every contract of the capabilities the increment names and every live check with its question, and not the increment's body", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const brief = await (await openReviews(storytree)).brief(library, increment, DIFF);

    assert.equal(brief.iteration, 1);
    assert.equal(brief.diff, DIFF);
    assert.deepEqual(brief.packages, ["forest-world", "library"]);
    assert.deepEqual(brief.contracts.map(({ id, title }) => ({ id, title })), [
      { id: contracts[0], title: "1.1 · A bad email is refused" },
      { id: contracts[1], title: "1.2 · A good email is kept" },
    ]);
    assert.deepEqual(brief.checks.map(({ id }) => id), checks);
    assert.ok(brief.checks.some(({ question }) => question === "Is any expected value computed the way the code computes it?"));
    assert.deepEqual(brief.earlier, []);
    assert.doesNotMatch(JSON.stringify(brief), /SECRET BREAKDOWN|Build the email form|reset link/);
  });
});

test("2.17 · a check naming the projects it applies to is briefed only in those projects; one naming none is briefed in every project", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, checks } = await plan(library);
    const principle = (await library.list("principle"))[0]!.id;
    const ours = await library.writeKnowledge("check", { title: "Here only", description: "Ours.", question: "Ours?", enforces: [principle], projects: [library.name] });
    await library.writeKnowledge("check", { title: "Elsewhere only", description: "Theirs.", question: "Theirs?", enforces: [principle], projects: [`not-${library.name}`] });
    const brief = await (await openReviews(storytree)).brief(library, increment, DIFF);

    assert.deepEqual(brief.checks.map(({ id }) => id), [...checks, ours.id].sort());
  });
});

test("2.1 · the branch's diff is read against the default branch origin names, as in a user's project whose origin calls it master", async () => {
  const dir = branchCheckout("master");
  try {
    const changed = branchDiff(dir).split("\n").filter((line) => /^[+-](?![+-])/.test(line));
    assert.deepEqual(changed, ["+export const b = 2;"]);
  } finally {
    await removeTemp(dir);
  }
});

test("2.4 · a contract the increment rewords pending its merge is briefed once, in its pending text, and one it retires pending its merge is listed once, as retired and not answered", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    await library.advanceIncrement(increment, "active");
    await library.pendChange(increment, { record: contracts[0]!, fields: { title: "1.1 · A bad email is refused, saying why", description: null } });
    await library.pendChange(increment, { record: contracts[1]!, retire: "overtaken by 1.1" });
    const reviews = await openReviews(storytree);
    const brief = await reviews.brief(library, increment, DIFF);

    assert.deepEqual(brief.contracts.map(({ capability: _, ...contract }) => contract), [{ id: contracts[0], title: "1.1 · A bad email is refused, saying why", pending: true }]);
    assert.deepEqual(brief.retired, [{ id: contracts[1], title: "1.2 · A good email is kept", reason: "overtaken by 1.1" }]);
    const text = briefText(brief);
    assert.match(text, /1\.1 · A bad email is refused, saying why/);
    assert.doesNotMatch(text, /No @, no account\./);
    assert.match(text, new RegExp(`${contracts[1]}  1\\.2 · A good email is kept\\n    retired by this change, pending its merge: overtaken by 1\\.1`));
    assert.equal(text.split(contracts[0]!).length - 1, 1, "a reworded contract appears once, by its pending wording");
    assert.equal(text.split(contracts[1]!).length - 1, 1, "a retired contract appears once, as retired");
    assert.doesNotMatch(text, /1\.1 · A bad email is refused\n/);

    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), new RegExp(`contract ${contracts[1]} is not in the brief`));
    await reviews.take(library.name, increment, clean(checks, [contracts[0]!]));
  });
});

test("2.10 · a plan-only change, whose diff touches no file, gets a brief listing its pending plan changes, and its return is taken; one with neither a diff nor a pending change is refused", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, capability, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    await assert.rejects(reviews.brief(library, increment, ""), /The diff touches no file/);

    await library.advanceIncrement(increment, "active");
    await library.pendChange(increment, { record: capability, fields: { description: "Refuses a bad email, saying why." } });
    await library.pendChange(increment, { record: contracts[0]!, fields: { title: "1.1 · A bad email is refused, saying why" } });
    await library.pendChange(increment, { record: contracts[1]!, retire: "overtaken by 1.1" });
    const brief = await reviews.brief(library, increment, "");

    assert.deepEqual(brief.packages, ["plan"]);
    assert.deepEqual(brief.plan, [
      { record: capability, type: "capability", title: "1 · Email form", after: { description: "Refuses a bad email, saying why." } },
      { record: contracts[0], type: "contract", title: "1.1 · A bad email is refused", after: { title: "1.1 · A bad email is refused, saying why" } },
      { record: contracts[1], type: "contract", title: "1.2 · A good email is kept", retire: "overtaken by 1.1" },
    ]);
    const text = briefText(brief);
    assert.match(text, new RegExp(`Pending plan changes \\(1\\)[^]*${capability}  capability  1 · Email form\\n    becomes: \\{"description":"Refuses a bad email, saying why\\."\\}`));
    assert.match(text, new RegExp(`${contracts[0]}  1\\.1 · A bad email is refused, saying why  \\(as this change rewords it, pending its merge\\)`));
    assert.match(text, new RegExp(`${contracts[1]}  1\\.2 · A good email is kept\\n    retired by this change, pending its merge: overtaken by 1\\.1`));
    assert.match(text, /The diff touches no file: the change under review is its pending plan changes\./);

    const taken = await reviews.take(library.name, increment, clean(checks, [contracts[0]!], { [checks[0]!]: [{ file: contracts[1]!, line: 1, found: "retired while its test still runs" }] }));
    assert.deepEqual(taken.hits.map(({ check, file }) => ({ check, file })), [{ check: checks[0], file: contracts[1] }]);
  });
});

test("2.5 · the brief lists each contract under its story and capability, so two stories' contracts sharing a number both appear, each with its story, and a named capability with no contracts still shows", async () => {
  await withLibrary(async (library, storytree) => {
    const forest = await library.addStory({ title: "The world" });
    const website = await library.addStory({ title: "The website" });
    const drawing = await library.addCapability({ title: "3 · Drawing", story: forest.id });
    const pages = await library.addCapability({ title: "3 · Pages", story: website.id });
    const empty = await library.addCapability({ title: "4 · Search", story: website.id });
    const tree = await library.addContract({ capability: drawing.id, title: "3.4 · A tree is drawn" });
    const page = await library.addContract({ capability: pages.id, title: "3.4 · A page is served" });
    const arc = await library.createArc({ title: "Both", intent: "Both", endState: "Both", stories: [forest.id, website.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Both", objective: "Both", body: "Both", capabilities: [pages.id, drawing.id, empty.id] });
    const brief = await (await openReviews(storytree)).brief(library, increment.id, DIFF);

    assert.deepEqual(brief.contracts.map(({ id, capability }) => ({ id, capability })), [
      { id: page.id, capability: pages.id },
      { id: tree.id, capability: drawing.id },
    ]);
    const text = briefText(brief);
    const section = text.slice(text.indexOf("Contracts ("), text.indexOf("The diff against"));
    assert.match(section, new RegExp(`The world › 3 · Drawing  \\(${drawing.id}\\)\\n    ${tree.id}  3\\.4 · A tree is drawn`));
    assert.match(section, new RegExp(`The website › 3 · Pages  \\(${pages.id}\\)\\n    ${page.id}  3\\.4 · A page is served`));
    assert.match(section, new RegExp(`The website › 4 · Search  \\(${empty.id}\\)\\n    no contracts`));
  });
});

test("2.2 · a return answering every check and contract is taken and its hits recorded; one that leaves one out, or answers one the brief did not hold, is refused naming it and nothing is recorded", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    await reviews.brief(library, increment, DIFF);

    const missing = clean(checks, contracts);
    await assert.rejects(reviews.take(library.name, increment, { ...missing, checks: missing.checks.slice(1) }), new RegExp(checks[0]!));
    await assert.rejects(reviews.take(library.name, increment, { ...missing, contracts: missing.contracts.slice(1) }), new RegExp(contracts[0]!));
    await assert.rejects(reviews.take(library.name, increment, { ...missing, contracts: [...missing.contracts, { contract: "contract_000000000000", met: true }] }), /contract_000000000000/);
    await assert.rejects(reviews.take(library.name, increment, { ...missing, contracts: [{ contract: contracts[0]!, met: false }, ...missing.contracts.slice(1)] }), new RegExp(`${contracts[0]}.*why`));
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file: "packages/forest-world/src/camera.test.ts", line: 0, found: "x" }] })), /line/);
    assert.deepEqual(await ledger.rows(library.name), { runs: [], hits: [] });

    const taken = await reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file: "packages/forest-world/src/camera.test.ts", line: 2, found: "2 * BASE is the code's own formula" }] }));
    assert.equal(taken.review, `${increment}#1`);
    assert.deepEqual(taken.hits.map(({ check, package: pkg, file, line, found }) => ({ check, package: pkg, file, line, found })), [
      { check: checks[0], package: "forest-world", file: "packages/forest-world/src/camera.test.ts", line: 2, found: "2 * BASE is the code's own formula" },
    ]);
    const rows = await ledger.rows(library.name);
    assert.equal(rows.runs.length, 6, "two checks and the covering-test check, in each of the two packages");
    assert.equal(rows.hits.length, 1);
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), /no brief/);
  });
});

test("2.9 · a return names the review it answers, and take refuses one naming another review, such as a return left from an earlier review, recording nothing", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    const file = "packages/forest-world/src/camera.test.ts";
    assert.match(briefText(await reviews.brief(library, increment, DIFF)), /"review": 1/);
    const first = { ...clean(checks, contracts, {}, 1), contracts: [{ contract: contracts[0]!, met: false, why: "a bad email is kept" }, { contract: contracts[1]!, met: true, touched: false }] };
    await reviews.take(library.name, increment, first);

    const second = await reviews.brief(library, increment, DIFF);
    assert.match(briefText(second), /"review": 2/);
    const before = await ledger.rows(library.name);
    await assert.rejects(reviews.take(library.name, increment, first), /review 1.*review 2/);
    const { review: _unnamed, ...unnamed } = clean(checks, contracts, {}, 2);
    await assert.rejects(reviews.take(library.name, increment, unnamed as ReviewReturn), /names no review.*review 2/);
    assert.deepEqual(await ledger.rows(library.name), before);
    assert.deepEqual(await reviews.unmet(library, increment), [{ contract: contracts[0], why: "a bad email is kept" }]);

    const taken = await reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file, line: 2, found: "a" }] }, 2));
    assert.equal(taken.review, `${increment}#2`);
    assert.deepEqual(await reviews.unmet(library, increment), []);
  });
});

/** The tools this package registers, by name, as the MCP server would call them. */
function registeredTools() {
  type Call = { library: Library; storytree: unknown; project: string };
  const tools: Record<string, (args: object, call: Call) => Promise<{ text: string; data?: Record<string, unknown> }>> = {};
  qualityTools().registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  return tools;
}

/** A git checkout whose branch adds one line to a library file on top of its origin/main, or of the default branch `trunk` origin names. */
function branchCheckout(trunk?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-review-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
  git("init", "-q");
  mkdirSync(join(dir, "packages/library/src"), { recursive: true });
  writeFileSync(join(dir, "packages/library/src/a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("update-ref", `refs/remotes/origin/${trunk ?? "main"}`, "HEAD");
  if (trunk !== undefined) git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${trunk}`);
  writeFileSync(join(dir, "packages/library/src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
  git("commit", "-qam", "change");
  return dir;
}

test("2.6 · the diff read from a worktree holds its uncommitted work too, edits and new files Git does not ignore; a folder with no default branch is read against its commit", async () => {
  for (const origin of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "qa-uncommitted-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
      git("init", "-q");
      mkdirSync(join(dir, "src/pages"), { recursive: true });
      writeFileSync(join(dir, "src/app.ts"), "export const app = 1;\n");
      writeFileSync(join(dir, ".gitignore"), "*.log\n");
      git("add", ".");
      git("commit", "-qm", "imported");
      if (origin) git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeFileSync(join(dir, "src/app.ts"), "export const app = 2;\n");
      writeFileSync(join(dir, "src/pages/new.ts"), "export const page = 1;\n");
      writeFileSync(join(dir, "debug.log"), "noise\n");

      const diff = branchDiff(dir);
      const changed = diff.split("\n").filter((line) => /^[+-](?![+-])/.test(line)).sort();
      assert.deepEqual(changed, ["+export const app = 2;", "+export const page = 1;", "-export const app = 1;"], origin ? "against origin/main" : "against the folder's commit");
      assert.match(diff, /^diff --git a\/src\/pages\/new\.ts b\/src\/pages\/new\.ts$/m, "a new file is named as the brief's packages read it");
    } finally {
      await removeTemp(dir);
    }
  }
});

/** A checkout with no origin at all whose branch `feature` adds one line on top of its local default branch `trunk`, made by `git init`. */
function localCheckout(trunk: string, configured: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-local-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
  git("init", "-q", "-b", trunk);
  if (configured) git("config", "init.defaultBranch", trunk);
  mkdirSync(join(dir, "packages/library/src"), { recursive: true });
  writeFileSync(join(dir, "packages/library/src/a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(dir, "packages/library/src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
  git("commit", "-qam", "change");
  return dir;
}

test("2.7 · in a repository with no origin/main the brief's diff is read against the local default branch (init.defaultBranch, else main, else master), and the brief says so", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment } = await plan(library);
    const tools = registeredTools();
    const call = { library, storytree, project: library.name };
    for (const [trunk, configured] of [["trunk", true], ["master", false]] as const) {
      const dir = localCheckout(trunk, configured);
      try {
        const changed = branchDiff(dir).split("\n").filter((line) => /^[+-](?![+-])/.test(line));
        assert.deepEqual(changed, ["+export const b = 2;"], `the branch's commit is in the diff against ${trunk}`);
        const read = await tools.quality_brief!({ increment, worktree: dir }, call);
        assert.deepEqual((read.data!.brief as { base?: unknown }).base, { ref: trunk, local: true });
        assert.match(read.text, new RegExp(`^The diff against ${trunk}, this repository's own default branch: it has no origin/main\\.$`, "m"));
      } finally {
        await removeTemp(dir);
      }
    }
  });
});

test("2.8 · the change is read from the worktree on the increment's claimed branch wherever the brief runs, and a brief is refused naming the branch when no worktree is on it", async () => {
  const dir = branchCheckout();
  const worktree = join(mkdtempSync(join(tmpdir(), "qa-claimed-")), "wt");
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
    git(dir, "worktree", "add", "-q", "-b", "feature", worktree, "origin/main");
    writeFileSync(join(worktree, "packages/library/src/a.ts"), "export const a = 1;\nexport const c = 3;\n");
    git(worktree, "commit", "-qam", "the increment's change");
    mkdirSync(join(dir, "tmp"));
    writeFileSync(join(dir, "tmp/stray.txt"), "not the change\n");

    const folder = changeFolder(dir, "feature");
    assert.equal(realpathSync.native(folder), realpathSync.native(worktree));
    const changed = branchDiff(folder).split("\n").filter((line) => /^[+-](?![+-])/.test(line));
    assert.deepEqual(changed, ["+export const c = 3;"]);
    assert.equal(realpathSync.native(changeFolder(worktree, "feature")), realpathSync.native(worktree));
    assert.equal(changeFolder(dir, undefined), dir, "with no claimed branch the folder it runs in is read");
    assert.throws(() => changeFolder(dir, "gone"), /branch gone/);
  } finally {
    await removeTemp(dir);
    await removeTemp(join(worktree, ".."));
  }
});

test("2.8 · a brief run from a worktree on another of the increment's branches reads that worktree, and one on another increment's branch is still refused", async () => {
  const dir = branchCheckout();
  const worktree = join(mkdtempSync(join(tmpdir(), "qa-second-")), "wt");
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
    git(dir, "worktree", "add", "-q", "-b", "claude/increment-6fe6450f6609-arcs", worktree, "origin/main");

    assert.equal(realpathSync.native(changeFolder(worktree, "claude/increment-6fe6450f6609-23254a")), realpathSync.native(worktree));
    assert.throws(() => changeFolder(worktree, "claude/increment-0123456789ab-23254a"), /branch claude\/increment-0123456789ab-23254a/);
  } finally {
    await removeTemp(dir);
    await removeTemp(join(worktree, ".."));
  }
});

test("2.3 · the brief's tool issues the brief given the diff, or reads it from the worktree given, and refuses neither; the take tool takes the same return the loop takes", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const tools = registeredTools();
    const call = { library, storytree, project: library.name };

    await assert.rejects(tools.quality_brief!({ increment }, call), /diff.*worktree/);
    const given = await tools.quality_brief!({ increment, diff: DIFF }, call);
    const brief = given.data!.brief as { iteration: number; diff: string; packages: string[]; contracts: { id: string }[] };
    assert.equal(brief.iteration, 1);
    assert.equal(brief.diff, DIFF);
    assert.deepEqual(brief.contracts.map(({ id }) => id), contracts);
    assert.match(given.text, /^Review 1 of change /);
    assert.match(given.text, /1\.1 · A bad email is refused/);

    const dir = branchCheckout();
    try {
      const read = await tools.quality_brief!({ increment, worktree: dir }, call);
      const fromWorktree = read.data!.brief as { diff: string; packages: string[] };
      assert.match(fromWorktree.diff, /^\+export const b = 2;$/m);
      assert.doesNotMatch(fromWorktree.diff, /forest-world/);
      assert.deepEqual(fromWorktree.packages, ["library"]);
    } finally {
      await removeTemp(dir);
    }

    const taken = await tools.quality_take!({ increment, return: clean(checks, contracts, { [checks[0]!]: [{ file: "packages/library/src/a.ts", line: 2, found: "b is new" }] }) }, call);
    assert.match(taken.text, /^Recorded review .*#1: 1 hit\./);
    assert.deepEqual((await (await openLedger(storytree)).rows(library.name)).hits.map(({ check, file, line }) => ({ check, file, line })), [
      { check: checks[0], file: "packages/library/src/a.ts", line: 2 },
    ]);
  });
});

test("2.11 · a change read from its worktree takes its own risk tier: a low-tier change gets a light pass and a medium one the full brief; a diff given by hand takes the increment's written risk line, and with none the full brief", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment } = await plan(library);
    const reviews = await openReviews(storytree);
    const dir = branchCheckout();
    try {
      const low = await reviews.brief(library, increment, worktreeChange(dir));
      assert.deepEqual({ tier: low.risk?.tier, rating: low.risk?.rating, pass: low.pass }, { tier: "low", rating: 3, pass: "light" });
      assert.match(briefText(low), /^Light pass: this change reads low 3\b.*judge every check and contract from the diff below alone/m);

      mkdirSync(join(dir, "packages/dev-loop/src"), { recursive: true });
      writeFileSync(join(dir, "packages/dev-loop/src/gate.mjs"), "export const gate = 1;\n");
      const medium = await reviews.brief(library, increment, worktreeChange(dir));
      assert.deepEqual({ tier: medium.risk?.tier, flags: medium.risk?.flags, pass: medium.pass }, { tier: "medium", flags: ["fix loop"], pass: "full" });
      assert.match(briefText(medium), /^Full review: this change reads medium 5\b/m);
      assert.doesNotMatch(briefText(medium), /Light pass/);
    } finally {
      await removeTemp(dir);
    }

    const unread = await reviews.brief(library, increment, DIFF);
    assert.deepEqual({ risk: unread.risk, pass: unread.pass }, { risk: undefined, pass: "full" });
    assert.match(briefText(unread), /^Full review: no risk line was read for this change\./m);
    await library.editIncrement(increment, { risk: { tier: "low", rating: 4, depth: 1, radius: 2, flags: [], stories: [], read: "2026-10-24" } });
    const written = await reviews.brief(library, increment, DIFF);
    assert.deepEqual({ tier: written.risk?.tier, pass: written.pass }, { tier: "low", pass: "light" });
  });
});

test("4.1 · a change's standing findings are its unanswered hits and unaccepted rejections; a hit answered fixed does not stand, and with none the change reads ready", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    await reviews.brief(library, increment, DIFF);
    const file = "packages/forest-world/src/camera.test.ts";
    const { hits: [fixed, rejected] } = await reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file, line: 2, found: "a" }, { file, line: 3, found: "b" }] }));

    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [fixed!.id, rejected!.id]);
    await ledger.answer(library.name, fixed!.id, { answer: "fixed" });
    await ledger.answer(library.name, rejected!.id, { answer: "rejected", reason: "BASE is a worked number" });
    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [rejected!.id]);

    const second = await reviews.brief(library, increment, DIFF);
    await reviews.take(library.name, increment, { ...clean(checks, contracts, {}, 2), rejections: second.judge.map((hit) => ({ hit, accepted: true })) });
    assert.deepEqual(await reviews.standing(library.name, increment), []);
  });
});

test("4.1 · a contract the latest review found not met stands, and take and standing do not read ready, until a later review finds it met", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    await reviews.brief(library, increment, DIFF);
    const taken = await reviews.take(library.name, increment, { ...clean(checks, contracts), contracts: [{ contract: contracts[0]!, met: false, why: "a bad email is kept" }, { contract: contracts[1]!, met: true, touched: false }] });

    assert.deepEqual(taken.standing, []);
    assert.doesNotMatch(takenText(taken), /ready for the gate/);
    assert.deepEqual(await reviews.unmet(library, increment), [{ contract: contracts[0], why: "a bad email is kept" }]);
    assert.doesNotMatch(standingText(await reviews.standing(library.name, increment), await reviews.unmet(library, increment)), /ready for the gate/);
    assert.match(standingText([], await reviews.unmet(library, increment)), new RegExp(`contract ${contracts[0]} not met: a bad email is kept`));

    await reviews.brief(library, increment, DIFF);
    const met = await reviews.take(library.name, increment, clean(checks, contracts, {}, 2));
    assert.deepEqual(await reviews.unmet(library, increment), []);
    assert.match(takenText(met), /ready for the gate/);
  });
});

test("4.7 · a contract found not met stops standing, and stops counting toward the review limit, once the increment no longer names its capability", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, capability, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    for (let iteration = 1; iteration <= REVIEW_LIMIT; iteration += 1) {
      await reviews.brief(library, increment, DIFF);
      await reviews.take(library.name, increment, { ...clean(checks, contracts, {}, iteration), contracts: [{ contract: contracts[0]!, met: false, why: "a bad email is kept" }, { contract: contracts[1]!, met: true, touched: false }] });
    }
    assert.deepEqual(await reviews.unmet(library, increment), [{ contract: contracts[0], why: "a bad email is kept" }]);
    await assert.rejects(reviews.brief(library, increment, DIFF), new RegExp(`contract ${contracts[0]} not met`));

    const story = (await library.get(capability))!.fields as { story: string };
    const kept = await library.addCapability({ title: "3 · Welcome page", story: story.story });
    await library.editIncrement(increment, { capabilities: [kept.id] });
    assert.deepEqual(await reviews.unmet(library, increment), []);
    assert.match(standingText(await reviews.standing(library.name, increment), await reviews.unmet(library, increment)), /ready for the gate/);
    assert.equal((await reviews.brief(library, increment, DIFF)).iteration, REVIEW_LIMIT + 1);
  });
});

test("4.2 · the second brief holds each earlier hit with its answer, and a return that leaves a rejection unjudged is refused naming it, recording nothing", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    await reviews.brief(library, increment, DIFF);
    const file = "packages/forest-world/src/camera.test.ts";
    const { hits: [fixed, rejected] } = await reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file, line: 2, found: "a" }, { file, line: 3, found: "b" }] }));
    await ledger.answer(library.name, fixed!.id, { answer: "fixed" });
    await ledger.answer(library.name, rejected!.id, { answer: "rejected", reason: "BASE is a worked number" });

    const second = await reviews.brief(library, increment, DIFF);
    assert.equal(second.iteration, 2);
    assert.deepEqual(second.earlier.map(({ id, answer, reason }) => ({ id, answer, reason })), [
      { id: fixed!.id, answer: "fixed", reason: undefined },
      { id: rejected!.id, answer: "rejected", reason: "BASE is a worked number" },
    ]);
    assert.deepEqual(second.judge, [rejected!.id]);

    const before = await ledger.rows(library.name);
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts, {}, 2)), new RegExp(`${rejected!.id}`));
    await assert.rejects(reviews.take(library.name, increment, { ...clean(checks, contracts, {}, 2), rejections: [{ hit: rejected!.id, accepted: true }, { hit: fixed!.id, accepted: true }] }), new RegExp(`${fixed!.id}`));
    assert.deepEqual(await ledger.rows(library.name), before);

    await reviews.take(library.name, increment, { ...clean(checks, contracts, {}, 2), rejections: [{ hit: rejected!.id, accepted: false, why: "BASE is imported from the code" }] });
    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [rejected!.id]);
  });
});

test("4.8 · a finding a later review returns again whose earlier rejection was accepted, a covering-test hit for the same contract or a check's hit at the same file with the same words, is not taken as a new hit", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    const file = "packages/forest-world/src/camera.test.ts";
    const returned = (review: number, line: number, rejections?: ReviewReturn["rejections"]): ReviewReturn => ({
      ...clean(checks, [], { [checks[0]!]: [{ file, line, found: "BASE is computed as zoom computes it" }] }, review),
      contracts: [{ contract: contracts[0]!, met: true, touched: true, at: { file: "packages/library/src/a.ts", line } }, { contract: contracts[1]!, met: true, touched: false }],
      ...(rejections === undefined ? {} : { rejections }),
    });
    await reviews.brief(library, increment, DIFF);
    const first = await reviews.take(library.name, increment, returned(1, 1));
    assert.deepEqual(first.hits.map(({ check }) => check).sort(), [checks[0], COVERING_TEST].sort());
    for (const { id } of first.hits) await ledger.answer(library.name, id, { answer: "rejected", reason: "a root-only script: no test can reach it" });

    const second = await reviews.brief(library, increment, DIFF);
    const accepted = await reviews.take(library.name, increment, returned(2, 2, second.judge.map((hit) => ({ hit, accepted: true }))));
    assert.deepEqual(accepted.hits, []);
    assert.deepEqual(accepted.standing, []);

    await reviews.brief(library, increment, DIFF);
    const again = await reviews.take(library.name, increment, returned(3, 3));
    assert.deepEqual(again.hits, []);
    assert.deepEqual(await reviews.standing(library.name, increment), []);
    assert.equal((await reviews.brief(library, increment, DIFF)).iteration, REVIEW_LIMIT + 1);

    // Another contract's covering-test hit, or the check's hit in other words, is a new finding and is taken.
    const other = await reviews.take(library.name, increment, {
      ...clean(checks, [], { [checks[0]!]: [{ file, line: 4, found: "BASE is computed as zoom computes it" }, { file, line: 4, found: "a test skips silently" }] }, REVIEW_LIMIT + 1),
      contracts: [{ contract: contracts[0]!, met: true, touched: true, at: { file: "packages/library/src/a.ts", line: 4 } }, { contract: contracts[1]!, met: true, touched: true, at: { file: "packages/library/src/a.ts", line: 4 } }],
    });
    assert.deepEqual(other.hits.map(({ check, found }) => ({ check, found })).sort((a, b) => a.check.localeCompare(b.check)), [
      { check: checks[0], found: "a test skips silently" },
      { check: COVERING_TEST, found: `contract ${contracts[1]} (1.2 · A good email is kept): the change touches it and no test covers the changed behaviour; add one` },
    ].sort((a, b) => a.check!.localeCompare(b.check!)));
  });
});

test("4.3 · with a finding standing after the third review a fourth brief is refused naming the arc and the findings; with none standing it is not", async () => {
  await withLibrary(async (library, storytree) => {
    const { arc, increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const file = "packages/forest-world/src/camera.test.ts";
    let open: number | undefined;
    for (let iteration = 1; iteration <= REVIEW_LIMIT; iteration += 1) {
      const brief = await reviews.brief(library, increment, DIFF);
      assert.equal(brief.iteration, iteration);
      const { hits } = await reviews.take(library.name, increment, clean(checks, contracts, iteration === 1 ? { [checks[0]!]: [{ file, line: 2, found: "a" }] } : {}, iteration));
      open ??= hits[0]!.id;
    }
    assert.equal(REVIEW_LIMIT, 3);
    await assert.rejects(reviews.brief(library, increment, DIFF), (error: Error) => error.message.includes(arc) && error.message.includes(`${open}`));
    assert.equal((await library.questions(arc)).length, 0);

    await (await openLedger(storytree)).answer(library.name, open!, { answer: "fixed" });
    assert.equal((await reviews.brief(library, increment, DIFF)).iteration, 4);
  });
});

test("4.5 · from the second review on, a brief read from the worktree holds only what changed since the last review taken, naming it; after the branch takes in its default branch it holds the whole diff again", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const dir = branchCheckout();
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
      const changed = (diff: string) => diff.split("\n").filter((line) => /^[+-](?![+-])/.test(line));
      const first = await reviews.brief(library, increment, worktreeChange(dir));
      assert.deepEqual(changed(first.diff), ["+export const b = 2;"]);
      assert.equal(first.since, undefined);
      await reviews.take(library.name, increment, clean(checks, contracts, {}, 1));

      const reviewed = git("rev-parse", "HEAD").trim();
      writeFileSync(join(dir, "packages/library/src/a.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
      git("commit", "-qam", "answer the review");
      writeFileSync(join(dir, "packages/library/src/new.ts"), "export const d = 4;\n");
      const second = await reviews.brief(library, increment, worktreeChange(dir));
      assert.deepEqual(changed(second.diff), ["+export const c = 3;", "+export const d = 4;"]);
      assert.deepEqual(second.since, { review: 1, head: reviewed });
      assert.deepEqual(second.packages, ["library"]);
      assert.match(briefText(second), new RegExp(`^The diff of what changed since review 1 \\(commit ${reviewed.slice(0, 12)}\\)`, "m"));
      await reviews.take(library.name, increment, clean(checks, contracts, {}, 2));

      rmSync(join(dir, "packages/library/src/new.ts"));
      git("checkout", "-q", "-b", "upstream", "origin/main");
      writeFileSync(join(dir, "packages/library/src/z.ts"), "export const z = 26;\n");
      git("add", ".");
      git("commit", "-qm", "main moves on");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "-q", "-");
      git("merge", "-q", "--no-edit", "origin/main");
      const third = await reviews.brief(library, increment, worktreeChange(dir));
      assert.equal(third.since, undefined);
      assert.deepEqual(changed(third.diff), ["+export const b = 2;", "+export const c = 3;"]);
    } finally {
      await removeTemp(dir);
    }
  });
});

test("4.6 · reviews whose commit the default branch has taken in, an earlier merged pull request's, do not count toward the next branch's three; one branch still stops at three", async () => {
  await withLibrary(async (library, storytree) => {
    const { arc, increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const dir = branchCheckout();
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
      const file = "packages/library/src/a.ts";
      for (let iteration = 1; iteration <= REVIEW_LIMIT; iteration += 1) {
        await reviews.brief(library, increment, worktreeChange(dir));
        await reviews.take(library.name, increment, clean(checks, contracts, iteration === 1 ? { [checks[0]!]: [{ file, line: 2, found: "a" }] } : {}, iteration));
      }
      await assert.rejects(reviews.brief(library, increment, worktreeChange(dir)), (error: Error) => error.message.includes(arc));

      // The first pull request merges, with its finding still standing; the next branch is cut from the default branch.
      git("checkout", "-q", "-b", "next", "origin/main");
      git("merge", "-q", "--no-ff", "--no-edit", "-");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeFileSync(join(dir, "packages/library/src/next.ts"), "export const n = 1;\n");
      git("add", ".");
      git("commit", "-qm", "the second pull request");
      for (let iteration = REVIEW_LIMIT + 1; iteration <= 2 * REVIEW_LIMIT; iteration += 1) {
        assert.equal((await reviews.brief(library, increment, worktreeChange(dir))).iteration, iteration);
        await reviews.take(library.name, increment, clean(checks, contracts, {}, iteration));
      }
      await assert.rejects(reviews.brief(library, increment, worktreeChange(dir)), (error: Error) => error.message.includes(arc));
    } finally {
      await removeTemp(dir);
    }
  });
});

test("4.6 · reviews whose commit the repository does not hold at all, another repository's, do not count toward the branch's three", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const old = branchCheckout();
    const dir = branchCheckout();
    try {
      const commit = (cwd: string, file: string, message: string) => {
        const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
        writeFileSync(join(cwd, "packages/library/src", file), `export const ${message} = 1;\n`);
        git("add", ".");
        git("commit", "-qm", message);
      };
      // Each repository's branch has a commit of its own, so their histories never share a commit by chance.
      commit(old, "old.ts", "old");
      for (let iteration = 1; iteration <= REVIEW_LIMIT; iteration += 1) {
        await reviews.brief(library, increment, worktreeChange(old));
        await reviews.take(library.name, increment, clean(checks, contracts, iteration === 1 ? { [checks[0]!]: [{ file: "packages/library/src/a.ts", line: 2, found: "a" }] } : {}, iteration));
      }
      // The branch is rebuilt in a fresh repository, whose history holds none of the old one's commits.
      commit(dir, "fresh.ts", "fresh");
      assert.equal((await reviews.brief(library, increment, worktreeChange(dir))).iteration, REVIEW_LIMIT + 1);
    } finally {
      await removeTemp(old);
      await removeTemp(dir);
    }
  });
});

test("4.4 · the tools this package registers record the same answer to a hit and give the same standing findings as the package's API the command line calls", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    await reviews.brief(library, increment, DIFF);
    const file = "packages/forest-world/src/camera.test.ts";
    const { hits: [byTool, byApi] } = await reviews.take(library.name, increment, clean(checks, contracts, { [checks[0]!]: [{ file, line: 2, found: "a" }, { file, line: 3, found: "b" }] }));

    const tools: Record<string, (args: object, call: { library: Library; storytree: typeof storytree; project: string }) => Promise<{ text: string; data?: Record<string, unknown> }>> = {};
    qualityTools().registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
    const call = { library, storytree, project: library.name };

    await assert.rejects(tools.quality_answer!({ hit: byTool!.id, answer: "rejected" }, call), /reason/);
    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [byTool!.id, byApi!.id]);
    assert.deepEqual(await tools.quality_answer!({ hit: byTool!.id, answer: "fixed" }, call), { text: `Answered hit ${byTool!.id}: fixed.`, data: { hit: byTool!.id, answer: "fixed" } });
    await ledger.answer(library.name, byApi!.id, { answer: "rejected", reason: "BASE is a worked number" });

    const standing = await reviews.standing(library.name, increment);
    assert.deepEqual(standing.map(({ id, answer, reason }) => ({ id, answer, reason })), [{ id: byApi!.id, answer: "rejected", reason: "BASE is a worked number" }]);
    assert.deepEqual(await tools.quality_standing!({ increment }, call), { text: standingText(standing), data: { standing, unmet: [], failed: [] } });
  });
});

test("2.12 · the brief lists each change-triggered guardrail of the capabilities the increment names and of their story, the story's once, and not a release-triggered one or another story's", async () => {
  await withLibrary(async (library, storytree) => {
    const story = await library.addStory({ title: "Desktop app", guardrails: [{ check: "Drive the real app from seeded fixtures", trigger: "change" }, { check: "Fresh-install sweep", trigger: "release" }] });
    const screen = await library.addCapability({ title: "1 · Story panel", story: story.id, guardrails: [{ check: "Open the panel on a seeded story", trigger: "change" }] });
    const menu = await library.addCapability({ title: "2 · Menu", story: story.id });
    const other = await library.addStory({ title: "Website", guardrails: [{ check: "Drive the built website", trigger: "change" }] });
    const arc = await library.createArc({ title: "Panel", intent: "Show the panel", endState: "It shows", stories: [story.id, other.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Panel", objective: "Build it", body: "Build it", capabilities: [screen.id, menu.id] });

    const brief = await (await openReviews(storytree)).brief(library, increment.id, DIFF);

    assert.deepEqual(brief.guardrails, [
      { id: `${story.id}#1`, on: { id: story.id, title: "Desktop app" }, check: "Drive the real app from seeded fixtures" },
      { id: `${screen.id}#1`, on: { id: screen.id, title: "1 · Story panel" }, check: "Open the panel on a seeded story" },
    ]);
    assert.match(briefText(brief), new RegExp(`Guardrails \\(2\\)[^]*${story.id}#1  Desktop app\\n    Drive the real app from seeded fixtures`));
  });
});

test("2.12 · a return must answer each guardrail once, with a picture, and why when it failed; a failed one stands, blocks the gate and counts toward the loop's bound, until a later review passes it", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, capability, contracts, checks } = await plan(library);
    const story = (await library.get(capability))!.fields as { story: string };
    await library.editStory(story.story, { guardrails: [{ check: "Drive the real app", trigger: "change" }] });
    const guardrail = `${story.story}#1`;
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);

    await reviews.brief(library, increment, DIFF);
    const before = await ledger.rows(library.name);
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), new RegExp(`guardrail ${guardrail} is in the brief and the return does not answer it`));
    await assert.rejects(reviews.take(library.name, increment, { ...clean(checks, contracts), guardrails: [{ guardrail, passed: true, pictures: [] }] }), new RegExp(`guardrail ${guardrail} names no picture`));
    await assert.rejects(reviews.take(library.name, increment, { ...clean(checks, contracts), guardrails: [{ guardrail, passed: false, pictures: ["a.png"] }] }), new RegExp(`guardrail ${guardrail} failed and the return does not say why`));
    assert.deepEqual(await ledger.rows(library.name), before);

    const taken = await reviews.take(library.name, increment, { ...clean(checks, contracts), guardrails: [{ guardrail, passed: false, why: "the panel stays blank", pictures: ["a.png"] }] });
    assert.deepEqual(taken.failed, [{ guardrail, why: "the panel stays blank" }]);
    assert.deepEqual(await reviews.failed(library.name, increment), [{ guardrail, why: "the panel stays blank" }]);
    assert.doesNotMatch(standingText([], [], await reviews.failed(library.name, increment)), /ready for the gate/);
    assert.match(takenText(taken), new RegExp(`guardrail ${guardrail} failed: the panel stays blank`));

    for (let review = 2; review <= REVIEW_LIMIT; review++) {
      await reviews.brief(library, increment, DIFF);
      await reviews.take(library.name, increment, { ...clean(checks, contracts, {}, review), guardrails: [{ guardrail, passed: false, why: "still blank", pictures: ["b.png"] }] });
    }
    await assert.rejects(reviews.brief(library, increment, DIFF), new RegExp(`guardrail ${guardrail} failed: still blank`));
  });
});

test("2.12 · a later review that passes the guardrail clears it", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, capability, contracts, checks } = await plan(library);
    const story = (await library.get(capability))!.fields as { story: string };
    await library.editStory(story.story, { guardrails: [{ check: "Drive the real app", trigger: "change" }] });
    const guardrail = `${story.story}#1`;
    const reviews = await openReviews(storytree);
    await reviews.brief(library, increment, DIFF);
    await reviews.take(library.name, increment, { ...clean(checks, contracts), guardrails: [{ guardrail, passed: false, why: "blank", pictures: ["a.png"] }] });
    await reviews.brief(library, increment, DIFF);
    const taken = await reviews.take(library.name, increment, { ...clean(checks, contracts, {}, 2), guardrails: [{ guardrail, passed: true, pictures: ["b.png"] }] });
    assert.deepEqual(taken.failed, []);
    assert.match(standingText(taken.standing, taken.unmet, await reviews.failed(library.name, increment)), /ready for the gate/);
  });
});

test("2.13 · a return says of each contract whether the change touches it; a touched one answered met names its covering test, or is taken as a hit at the changed line asking for one, and one the change rewords cannot be answered untouched", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    await library.advanceIncrement(increment, "active");
    await library.pendChange(increment, { record: contracts[0]!, fields: { title: "1.1 · A bad email is refused, saying why" } });
    const reviews = await openReviews(storytree);
    const ledger = await openLedger(storytree);
    await reviews.brief(library, increment, DIFF);
    const base = clean(checks, []);
    const answer = (...given: ReviewReturn["contracts"]) => ({ ...base, contracts: given });

    const before = await ledger.rows(library.name);
    await assert.rejects(reviews.take(library.name, increment, answer({ contract: contracts[0]!, met: true, touched: true, test: "a › b" }, { contract: contracts[1]!, met: true })), new RegExp(`contract ${contracts[1]} is met and does not say whether the change touches it`));
    await assert.rejects(reviews.take(library.name, increment, answer({ contract: contracts[0]!, met: true, touched: true, test: "a › b" }, { contract: contracts[1]!, met: true, touched: true })), new RegExp(`contract ${contracts[1]} is touched by the change and met, and names no covering test`));
    await assert.rejects(reviews.take(library.name, increment, answer({ contract: contracts[0]!, met: true, touched: false }, { contract: contracts[1]!, met: true, touched: false })), new RegExp(`contract ${contracts[0]} is reworded by this change, so the change touches it`));
    await assert.rejects(reviews.take(library.name, increment, answer({ contract: contracts[0]!, met: true, touched: true, test: "a › b" }, { contract: contracts[1]!, met: true, touched: true, at: { file: "packages/website/src/x.ts", line: 3 } })), /package website, which the diff does not touch/);
    assert.deepEqual(await ledger.rows(library.name), before);

    const taken = await reviews.take(library.name, increment, answer(
      { contract: contracts[0]!, met: true, touched: true, test: `${COVERING} › 1.1 · a bad email is refused` },
      { contract: contracts[1]!, met: true, touched: true, at: { file: "packages/library/src/a.ts", line: 1 } },
    ));
    assert.deepEqual(taken.hits.map(({ check, package: pkg, file, line, found }) => ({ check, package: pkg, file, line, found })), [
      { check: COVERING_TEST, package: "library", file: "packages/library/src/a.ts", line: 1, found: `contract ${contracts[1]} (1.2 · A good email is kept): the change touches it and no test covers the changed behaviour; add one` },
    ]);
    assert.deepEqual(taken.standing.map(({ check }) => check), [COVERING_TEST]);
  });
});

test("2.15 · a red run saved in another worktree of the clone counts in a worktree whose history holds the commit it was saved at, and one saved at a commit outside that history does not", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment } = await plan(library);
    const reviews = await openReviews(storytree);
    const dir = branchCheckout();
    const resumed = `${dir}-resumed`;
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
    try {
      writeFileSync(join(dir, "packages/library/src/a.test.ts"), [
        'import { test } from "node:test";',
        'test("1.1 · red on the branch", () => {});',
        'test("1.2 · red off its history", () => {});',
        "",
      ].join("\n"));
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "tests");
      const head = git(dir, "rev-parse", "HEAD");
      const elsewhere = git(dir, "commit-tree", "HEAD^{tree}", "-m", "another branch");
      mkdirSync(join(dir, ".git/storytree"), { recursive: true });
      writeFileSync(join(dir, ".git/storytree/red-runs.jsonl"), [
        { at: "2026-10-26T10:00:00.000Z", head, file: "packages/library/src/a.test.ts", test: "1.1 · red on the branch" },
        { at: "2026-10-26T10:00:00.000Z", head: elsewhere, file: "packages/library/src/a.test.ts", test: "1.2 · red off its history" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n");
      const branch = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
      git(dir, "worktree", "add", "-q", "-b", "resume", resumed, "origin/main");
      git(resumed, "merge", "-q", "--no-edit", branch);

      const brief = await reviews.brief(library, increment, worktreeChange(resumed));
      assert.deepEqual(brief.reds, [
        { file: "packages/library/src/a.test.ts", line: 2, test: "1.1 · red on the branch", red: true },
        { file: "packages/library/src/a.test.ts", line: 3, test: "1.2 · red off its history", red: false },
      ]);
    } finally {
      await removeTemp(resumed);
      await removeTemp(dir);
    }
  });
});

test("2.14 · a test the change adds that no saved red run names failing is taken as a hit at its line asking for the red; one whose run failed, by name or its file failing to load, is not, nor is a test written inside a fixture's text", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const dir = branchCheckout();
    try {
      writeFileSync(join(dir, ".gitignore"), ".pgtest/\n");
      writeFileSync(join(dir, "packages/library/src/a.test.ts"), [
        'import { describe, test } from "node:test";',
        'describe("a", () => {',
        '  test("1.1 · seen red", () => {});',
        '  test("1.2 · never red", () => {});',
        '  test.todo("1.3 · not yet");',
        "});",
        "const fixture = `test(\"1.5 · inside a fixture's text\", () => {});`;",
        "",
      ].join("\n"));
      writeFileSync(join(dir, "packages/library/src/b.test.ts"), 'import { test } from "node:test";\ntest("1.4 · its file failed to load", () => {});\n');
      mkdirSync(join(dir, ".pgtest"));
      writeFileSync(join(dir, ".pgtest/red-runs.jsonl"), [
        { at: "2026-10-24T10:00:00.000Z", head: "abc", file: "packages/library/src/a.test.ts", test: "a › 1.1 · seen red" },
        { at: "2026-10-24T10:00:00.000Z", head: "abc", file: "packages/library/src/a.test.ts", test: "a › 1.9 · another test" },
        { at: "2026-10-24T10:00:00.000Z", head: "abc", file: "packages/library/src/b.test.ts", test: null },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n");

      const brief = await reviews.brief(library, increment, worktreeChange(dir));
      assert.deepEqual(brief.reds, [
        { file: "packages/library/src/a.test.ts", line: 3, test: "1.1 · seen red", red: true },
        { file: "packages/library/src/a.test.ts", line: 4, test: "1.2 · never red", red: false },
        { file: "packages/library/src/b.test.ts", line: 2, test: "1.4 · its file failed to load", red: true },
      ]);
      assert.match(briefText(brief), /^ {2}packages\/library\/src\/a\.test\.ts:4 {2}1\.2 · never red {2}no saved red run$/m);

      const taken = await reviews.take(library.name, increment, clean(checks, contracts));
      assert.deepEqual(taken.hits.map(({ check, package: pkg, file, line, found }) => ({ check, package: pkg, file, line, found })), [
        { check: RED_RUN, package: "library", file: "packages/library/src/a.test.ts", line: 4, found: "new test 1.2 · never red: no saved red run names it failing; run it red against the code without the change, or say why it could not fail first" },
      ]);
    } finally {
      await removeTemp(dir);
    }
  });
});

test("2.18 · a change to a factory plugin's story is briefed with the factory worktree on the increment's branch, its diff and the plugin plan's contracts there; with no such worktree the brief says so and a return answering those contracts met is refused", async () => {
  const factory = mkdtempSync(join(tmpdir(), "qa-factory-"));
  const worktree = join(mkdtempSync(join(tmpdir(), "qa-factory-wt-")), "wt");
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
    const plan = (folder: string, contracts: { title: string }[]) => writeFileSync(join(folder, "plugins/voice/plan.json"), JSON.stringify({ story: { title: "Talk by voice" }, capabilities: [{ title: "1 · Connector", proposed: false, contracts }] }));
    mkdirSync(join(factory, "plugins/voice"), { recursive: true });
    writeFileSync(join(factory, "plugins/voice/package.json"), JSON.stringify({ name: "voice", storytree: { interface: PLUGIN_INTERFACE, plan: "./plan.json" } }));
    plan(factory, [{ title: "1.1 · A wrong secret is answered 404" }, { title: "1.2 · A flood is cut off" }]);
    git(factory, "init", "-q", "-b", "main");
    git(factory, "add", ".");
    git(factory, "commit", "-qm", "first");
    git(factory, "update-ref", "refs/remotes/origin/main", "HEAD");
    await withLibrary(async (library, storytree) => {
      const imported = await library.importPluginPlan("voice", JSON.parse(readFileSync(join(factory, "plugins/voice/plan.json"), "utf8")));
      const capability = (await library.list("capability")).find(({ fields }) => fields.story === imported.story)!;
      const [kept, dropped] = (await library.list("contract")).filter(({ fields }) => fields.capability === capability.id).sort((a, b) => a.fields.title.localeCompare(b.fields.title)).map(({ id }) => id);
      const arc = await library.createArc({ title: "Voice grows", intent: "Voice does more", endState: "Voice does more", stories: [imported.story] });
      const increment = await library.addIncrement({ arc: arc.id, title: "Voice grows", objective: "Voice does more", body: "Red then green", capabilities: [capability.id] });
      const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
      await library.writeKnowledge("check", { title: "Silent skip", description: "Tests that skip without saying so.", question: "Does any test skip silently?", enforces: [principle.id] });
      const reviews = await openReviews(storytree);

      const unread = await reviews.brief(library, increment.id, DIFF, undefined, factoryPlugins(factory, increment.id));
      assert.match(unread.factory?.unread ?? "", /no worktree/);
      assert.deepEqual(unread.contracts.map(({ id }) => id), [kept, dropped]);
      assert.match(briefText(unread), /voice's change was not read/);
      await assert.rejects(reviews.take(library.name, increment.id, clean(unread.checks.map(({ id }) => id), [kept!, dropped!])), /voice's change was not read/);

      git(factory, "worktree", "add", "-q", "-b", `claude/increment-${increment.id.slice("increment_".length)}-a1b2c3`, worktree, "main");
      plan(worktree, [{ title: "1.1 · A wrong secret is answered 404" }, { title: "1.3 · A slow caller is timed out" }]);
      mkdirSync(join(worktree, "plugins/voice/src"));
      writeFileSync(join(worktree, "plugins/voice/src/door.ts"), "export const timeout = 30;\n");
      const read = await reviews.brief(library, increment.id, DIFF, undefined, factoryPlugins(factory, increment.id));
      assert.equal(realpathSync.native(read.factory!.folder!), realpathSync.native(worktree));
      assert.match(read.factory!.diff!, /\+export const timeout = 30;/);
      assert.match(briefText(read), /\+export const timeout = 30;/);
      assert.ok(read.packages.includes("voice"), read.packages.join(", "));
      assert.deepEqual(read.contracts.map(({ id, title }) => ({ id, title })), [
        { id: kept, title: "1.1 · A wrong secret is answered 404" },
        { id: "voice:1.3", title: "1.3 · A slow caller is timed out" },
      ]);
      assert.deepEqual(read.retired?.map(({ id }) => id), [dropped]);
      const answered = clean(read.checks.map(({ id }) => id), [kept!]);
      await reviews.take(library.name, increment.id, { ...answered, contracts: [...answered.contracts, { contract: "voice:1.3", met: false, why: "no timeout is set" }] });
      assert.deepEqual(await reviews.unmet(library, increment.id), [{ contract: "voice:1.3", why: "no timeout is set" }], "a contract only the plan holds stands when found not met");
    });
  } finally {
    await removeTemp(factory);
    await removeTemp(join(worktree, ".."));
  }
});
