/**
 * Capability 5 · Graduation: contracts 5.1 to 5.3 in a fresh project's library on the real Postgres `pnpm test`
 * provides, through the package's public entry; 5.3 against a real git checkout whose branch is the change.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { briefText, checks, checksText, graduate, graduatedFindings, openLedger, openReviews, takenText } from "../index.js";

test("5.1 · graduating a check in part writes the part and the Guardrails check that enforces it, and the checks reading shows both; an unknown Guardrails check or check is refused, writing nothing", async () => {
  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });

    await assert.rejects(graduate(library, check.id, { part: "a constant asserted equal to itself", enforcedBy: "no-such-check" }), /no-such-check/);
    await assert.rejects(graduate(library, principle.id, { part: "a constant asserted equal to itself", enforcedBy: "self-equal-assertion" }), /is not a live quality control check/);
    assert.equal((await checks(library))[0]!.graduated, undefined);

    await graduate(library, check.id, { part: "a constant asserted equal to itself, or the same call on both sides", enforcedBy: "self-equal-assertion" });

    const [read] = await checks(library);
    assert.deepEqual(read!.graduated, [{ part: "a constant asserted equal to itself, or the same call on both sides", enforcedBy: "self-equal-assertion" }]);
    assert.match(checksText([read!]), /graduated to Guardrails' self-equal-assertion: a constant asserted equal to itself, or the same call on both sides/);
  });
});

/** A plan with one increment, a check graduated in part to self-equal-assertion, and one that has not graduated. */
async function graduatedPlan(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
  const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
  const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "The breakdown.", capabilities: [capability.id] });
  const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
  const tautology = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
  const skips = await library.writeKnowledge("check", { title: "Silent skip", description: "Tests that skip without saying so.", question: "Does any test skip silently?", enforces: [principle.id] });
  await graduate(library, tautology.id, { part: "the same call on both sides of an equality", enforcedBy: "self-equal-assertion" });
  return { increment: increment.id, contract: contract.id, principle: principle.id, tautology: tautology.id, skips: skips.id };
}

/** A git checkout whose branch, against its origin/main, adds `files`; removed after `body`, pass or fail. */
async function withCheckout(files: Record<string, string>, body: (checkout: string, diff: string) => Promise<void>): Promise<void> {
  const checkout = mkdtempSync(path.join(tmpdir(), "graduated-"));
  try {
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: checkout, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(path.join(checkout, "README.md"), "base\n");
    git("add", "."), git("commit", "-qm", "base"), git("update-ref", "refs/remotes/origin/main", "HEAD");
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
      writeFileSync(path.join(checkout, file), text);
    }
    git("add", "."), git("commit", "-qm", "change");
    await body(checkout, git("diff", "origin/main...HEAD"));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

test("5.2 · a check graduated in part stays in the review brief with the part Guardrails now enforces named, so the reviewer judges only the rest", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, tautology, skips } = await graduatedPlan(library);
    const brief = await (await openReviews(storytree)).brief(library, increment, "diff --git a/packages/forms/src/a.ts b/packages/forms/src/a.ts\n+export const a = 1;\n");

    assert.deepEqual(brief.checks.map(({ id, graduated }) => ({ id, graduated })).sort((a, b) => a.id.localeCompare(b.id)), [
      { id: tautology, graduated: [{ part: "the same call on both sides of an equality", enforcedBy: "self-equal-assertion" }] },
      { id: skips, graduated: undefined },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    assert.match(briefText(brief), new RegExp(`${tautology}  Tautological expected value\\n.*\\n    Not yours to judge: Guardrails' self-equal-assertion checks the same call on both sides of an equality\\.`));
    assert.doesNotMatch(briefText(brief), new RegExp(`${skips}  Silent skip\\n.*\\n    Not yours`));
  });
});

test("5.2 · a check graduated whole is no longer in the review brief, so the return need not answer it and no reviewer run of it is recorded, while what its Guardrails check finds is still recorded under it", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contract, principle, tautology, skips } = await graduatedPlan(library);
    const whole = await library.writeKnowledge("check", { title: "Self-equal assertion", description: "An assertion that compares a value with itself.", question: "Does any assertion compare a value with itself?", enforces: [principle] });
    await graduate(library, whole.id, { part: "an assertion comparing a value with itself", enforcedBy: "self-equal-assertion", whole: true });
    assert.deepEqual((await checks(library)).find(({ id }) => id === whole.id)!.graduated, [{ part: "an assertion comparing a value with itself", enforcedBy: "self-equal-assertion", whole: true }]);
    assert.match(checksText(await checks(library)), /graduated whole to Guardrails' self-equal-assertion: an assertion comparing a value with itself/);

    const reviews = await openReviews(storytree);
    await withCheckout({ "packages/forms/src/email.test.ts": "assert.equal(valid(x), valid(x));\n" }, async (checkout, diff) => {
      const brief = await reviews.brief(library, increment, diff);
      assert.deepEqual(brief.checks.map(({ id }) => id).sort(), [tautology, skips].sort());
      assert.doesNotMatch(briefText(brief), new RegExp(whole.id));

      const taken = await reviews.take(library.name, increment, {
        checks: [{ check: tautology, tripped: false }, { check: skips, tripped: false }],
        contracts: [{ contract, met: true }],
      }, await graduatedFindings(library, checkout));
      const { runs } = await (await openLedger(storytree)).rows(library.name);
      assert.deepEqual(runs.filter(({ check }) => check === whole.id).map(({ foundBy }) => foundBy), ["graduated"]);
      assert.deepEqual(taken.hits.filter(({ check }) => check === whole.id).map(({ line, foundBy }) => ({ line, foundBy })), [{ line: 1, foundBy: "graduated" }]);
    });
  });
});

test("5.3 · taking a review records what Guardrails' graduated checks find on the change, under the check each graduated from and marked as theirs, and the reading counts them there; not run, nothing of theirs is recorded and the taking says so", async () => {
  await withLibrary(async (library, storytree) => {
    const { increment, contract, tautology, skips } = await graduatedPlan(library);
    const reviews = await openReviews(storytree);
    const file = "packages/forms/src/email.test.ts";
    await withCheckout({ [file]: "import assert from \"node:assert/strict\";\n\nassert.equal(valid(x), valid(x));\n" }, async (checkout, diff) => {
      await reviews.brief(library, increment, diff);
      const taken = await reviews.take(library.name, increment, {
        checks: [{ check: tautology, tripped: false }, { check: skips, tripped: false }],
        contracts: [{ contract, met: true }],
      }, await graduatedFindings(library, checkout));

      const { runs, hits } = await (await openLedger(storytree)).rows(library.name);
      assert.deepEqual(runs.map(({ check, package: pkg, foundBy }) => ({ check, package: pkg, foundBy })).sort((a, b) => `${a.check}${a.foundBy}`.localeCompare(`${b.check}${b.foundBy}`)), [
        { check: tautology, package: "forms", foundBy: "graduated" },
        { check: tautology, package: "forms", foundBy: "reviewer" },
        { check: skips, package: "forms", foundBy: "reviewer" },
      ].sort((a, b) => `${a.check}${a.foundBy}`.localeCompare(`${b.check}${b.foundBy}`)));
      assert.deepEqual(hits.map(({ check, package: pkg, file: where, line, foundBy, found }) => ({ check, package: pkg, file: where, line, foundBy, found })), [
        { check: tautology, package: "forms", file, line: 3, foundBy: "graduated", found: "Guardrails' self-equal-assertion: the same call on both sides of an equality" },
      ]);
      assert.deepEqual(taken.hits.map(({ id }) => id), [hits[0]!.id]);
      assert.deepEqual(taken.standing.map(({ id }) => id), [hits[0]!.id]);
      assert.deepEqual((await (await openLedger(storytree)).reading(library.name)).find(({ check }) => check === tautology),
        { check: tautology, package: "forms", reviews: 1, hits: 1, fixed: 0, rejected: 0, unanswered: 1, graduated: 1 });
    });

    const notACheckout = mkdtempSync(path.join(tmpdir(), "not-a-checkout-"));
    try {
      await reviews.brief(library, increment, "diff --git a/packages/forms/src/b.ts b/packages/forms/src/b.ts\n+export const b = 2;\n");
      const taken = await reviews.take(library.name, increment, {
        checks: [{ check: tautology, tripped: false }, { check: skips, tripped: false }],
        contracts: [{ contract, met: true }],
        rejections: [],
      }, await graduatedFindings(library, notACheckout));
      assert.equal(taken.hits.length, 0);
      assert.match(takenText(taken), /Guardrails' graduated checks did not run, so nothing of theirs is recorded: origin\/main is not in this checkout/);
      const runs = (await (await openLedger(storytree)).rows(library.name)).runs.filter(({ review }) => review === taken.review);
      assert.deepEqual(runs.map(({ foundBy }) => foundBy), ["reviewer", "reviewer"]);
    } finally {
      rmSync(notACheckout, { recursive: true, force: true });
    }
  });
});
