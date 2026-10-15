/**
 * Capability 2 · Change review and capability 4 · Review loop bound: contracts 2.1 to 2.3 and 4.1 to 4.4 on the
 * real Postgres `pnpm test` provides, through the package's public entry, against a library holding an
 * increment, the contracts of the capabilities it names, and live checks. Contract 4.4 is also proved at the
 * two front doors, beside the command line's tests and the MCP server's, because this package cannot depend
 * back on either.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { branchDiff, briefText, changeFolder, openLedger, openReviews, qualityTools, REVIEW_LIMIT, standingText, takenText, type ReviewReturn } from "../index.js";

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
  return { arc: arc.id, increment: increment.id, contracts: [first.id, second.id], checks: [tautology.id, skips.id].sort() };
}

/** A return that answers every check (none tripped unless given) and every contract (met). */
function clean(checks: readonly string[], contracts: readonly string[], tripped: Record<string, { file: string; line: number; found: string }[]> = {}): ReviewReturn {
  return {
    checks: checks.map((check) => ({ check, tripped: (tripped[check] ?? []).length > 0, hits: tripped[check] ?? [] })),
    contracts: contracts.map((contract) => ({ contract, met: true })),
  };
}

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

test("2.1 · the branch's diff is read against the default branch origin names, as in a user's project whose origin calls it master", () => {
  const dir = branchCheckout("master");
  try {
    const changed = branchDiff(dir).split("\n").filter((line) => /^[+-](?![+-])/.test(line));
    assert.deepEqual(changed, ["+export const b = 2;"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("2.4 · a contract the increment rewords pending its merge is briefed in its pending text, and one it retires pending its merge is listed as retired and not answered", async () => {
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

    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), new RegExp(`contract ${contracts[1]} is not in the brief`));
    await reviews.take(library.name, increment, clean(checks, [contracts[0]!]));
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
    assert.equal(rows.runs.length, 4);
    assert.equal(rows.hits.length, 1);
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), /no brief/);
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

test("2.6 · the diff read from a worktree holds its uncommitted work too, edits and new files Git does not ignore; a folder with no default branch is read against its commit", () => {
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
      rmSync(dir, { recursive: true, force: true });
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
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

test("2.8 · the change is read from the worktree on the increment's claimed branch wherever the brief runs, and a brief is refused naming the branch when no worktree is on it", () => {
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
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(worktree, ".."), { recursive: true, force: true });
  }
});

test("2.8 · a brief run from a worktree on another of the increment's branches reads that worktree, and one on another increment's branch is still refused", () => {
  const dir = branchCheckout();
  const worktree = join(mkdtempSync(join(tmpdir(), "qa-second-")), "wt");
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
    git(dir, "worktree", "add", "-q", "-b", "claude/increment-6fe6450f6609-arcs", worktree, "origin/main");

    assert.equal(realpathSync.native(changeFolder(worktree, "claude/increment-6fe6450f6609-23254a")), realpathSync.native(worktree));
    assert.throws(() => changeFolder(worktree, "claude/increment-0123456789ab-23254a"), /branch claude\/increment-0123456789ab-23254a/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(worktree, ".."), { recursive: true, force: true });
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
      rmSync(dir, { recursive: true, force: true });
    }

    const taken = await tools.quality_take!({ increment, return: clean(checks, contracts, { [checks[0]!]: [{ file: "packages/library/src/a.ts", line: 2, found: "b is new" }] }) }, call);
    assert.match(taken.text, /^Recorded review .*#1: 1 hit\./);
    assert.deepEqual((await (await openLedger(storytree)).rows(library.name)).hits.map(({ check, file, line }) => ({ check, file, line })), [
      { check: checks[0], file: "packages/library/src/a.ts", line: 2 },
    ]);
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
    await reviews.take(library.name, increment, { ...clean(checks, contracts), rejections: second.judge.map((hit) => ({ hit, accepted: true })) });
    assert.deepEqual(await reviews.standing(library.name, increment), []);
  });
});

test("4.1 · a contract the latest review found not met stands, and take and standing do not read ready, until a later review finds it met", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    await reviews.brief(library, increment, DIFF);
    const taken = await reviews.take(library.name, increment, { ...clean(checks, contracts), contracts: [{ contract: contracts[0]!, met: false, why: "a bad email is kept" }, { contract: contracts[1]!, met: true }] });

    assert.deepEqual(taken.standing, []);
    assert.doesNotMatch(takenText(taken), /ready for the gate/);
    assert.deepEqual(await reviews.unmet(library.name, increment), [{ contract: contracts[0], why: "a bad email is kept" }]);
    assert.doesNotMatch(standingText(await reviews.standing(library.name, increment), await reviews.unmet(library.name, increment)), /ready for the gate/);
    assert.match(standingText([], await reviews.unmet(library.name, increment)), new RegExp(`contract ${contracts[0]} not met: a bad email is kept`));

    await reviews.brief(library, increment, DIFF);
    const met = await reviews.take(library.name, increment, clean(checks, contracts));
    assert.deepEqual(await reviews.unmet(library.name, increment), []);
    assert.match(takenText(met), /ready for the gate/);
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
    await assert.rejects(reviews.take(library.name, increment, clean(checks, contracts)), new RegExp(`${rejected!.id}`));
    await assert.rejects(reviews.take(library.name, increment, { ...clean(checks, contracts), rejections: [{ hit: rejected!.id, accepted: true }, { hit: fixed!.id, accepted: true }] }), new RegExp(`${fixed!.id}`));
    assert.deepEqual(await ledger.rows(library.name), before);

    await reviews.take(library.name, increment, { ...clean(checks, contracts), rejections: [{ hit: rejected!.id, accepted: false, why: "BASE is imported from the code" }] });
    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [rejected!.id]);
  });
});

test("4.3 · with a finding standing after the tenth review an eleventh brief is refused naming the arc and the findings; with none standing it is not", async () => {
  await withLibrary(async (library, storytree) => {
    const { arc, increment, contracts, checks } = await plan(library);
    const reviews = await openReviews(storytree);
    const file = "packages/forest-world/src/camera.test.ts";
    let open: number | undefined;
    for (let iteration = 1; iteration <= REVIEW_LIMIT; iteration += 1) {
      const brief = await reviews.brief(library, increment, DIFF);
      assert.equal(brief.iteration, iteration);
      const { hits } = await reviews.take(library.name, increment, iteration === 1 ? clean(checks, contracts, { [checks[0]!]: [{ file, line: 2, found: "a" }] }) : clean(checks, contracts));
      open ??= hits[0]!.id;
    }
    assert.equal(REVIEW_LIMIT, 10);
    await assert.rejects(reviews.brief(library, increment, DIFF), (error: Error) => error.message.includes(arc) && error.message.includes(`${open}`));
    assert.equal((await library.questions(arc)).length, 0);

    await (await openLedger(storytree)).answer(library.name, open!, { answer: "fixed" });
    assert.equal((await reviews.brief(library, increment, DIFF)).iteration, 11);
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

    const tools: Record<string, (args: object, call: { storytree: typeof storytree; project: string }) => Promise<{ text: string; data?: Record<string, unknown> }>> = {};
    qualityTools().registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
    const call = { storytree, project: library.name };

    await assert.rejects(tools.quality_answer!({ hit: byTool!.id, answer: "rejected" }, call), /reason/);
    assert.deepEqual((await reviews.standing(library.name, increment)).map(({ id }) => id), [byTool!.id, byApi!.id]);
    assert.deepEqual(await tools.quality_answer!({ hit: byTool!.id, answer: "fixed" }, call), { text: `Answered hit ${byTool!.id}: fixed.`, data: { hit: byTool!.id, answer: "fixed" } });
    await ledger.answer(library.name, byApi!.id, { answer: "rejected", reason: "BASE is a worked number" });

    const standing = await reviews.standing(library.name, increment);
    assert.deepEqual(standing.map(({ id, answer, reason }) => ({ id, answer, reason })), [{ id: byApi!.id, answer: "rejected", reason: "BASE is a worked number" }]);
    assert.deepEqual(await tools.quality_standing!({ increment }, call), { text: standingText(standing), data: { standing, unmet: [] } });
  });
});
