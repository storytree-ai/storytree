/**
 * Capability 2 · Change review and capability 4 · Review loop bound: contracts 2.1, 2.2 and 4.1 to 4.4 on the
 * real Postgres `pnpm test` provides, through the package's public entry, against a library holding an
 * increment, the contracts of the capabilities it names, and live checks. Contract 4.4 is also proved at the
 * two front doors, beside the command line's tests and the MCP server's, because this package cannot depend
 * back on either.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { openLedger, openReviews, qualityTools, REVIEW_LIMIT, standingText, type ReviewReturn } from "../index.js";

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
    assert.deepEqual(await tools.quality_standing!({ increment }, call), { text: standingText(standing), data: { standing } });
  });
});
