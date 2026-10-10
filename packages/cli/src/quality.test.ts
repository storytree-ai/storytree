/**
 * Quality assurance's contracts 1.2 and 3.4, at this front door: the real, built `storytree quality checks`
 * and `storytree quality ledger` print the checks and ledger readings through quality assurance's public API,
 * the same readings its tools on the MCP server give. Its contracts 2.1, 2.2 and 4.1 at this front door: the
 * change-reviewer's loop, `quality brief`, `take`, `answer` and `standing`, run through the same API; and its 5.1:
 * `quality graduate`.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { connect } from "@storytree/library";
import { checks, checksText, ledgerText, openLedger, openReviews } from "@storytree/quality-assurance";

import { BuiltCommand, inWorld, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("(quality assurance's 1.2) `quality checks` prints the package's checks reading", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const reading = await checks(library);
    assert.equal(reading.length, 1);

    const ran = await world.run(["quality", "checks"]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(ran.stdout.startsWith(checksText(reading)), ran.stdout);
  });
});

test("(quality assurance's 3.4) `quality ledger` prints the package's ledger reading for the folder's project", async () => {
  await inWorld(command, async (world) => {
    const storytree = await connect({ url: testServerUrl() });
    try {
      const ledger = await openLedger(storytree);
      await ledger.record({ project: world.project, review: "r1", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "a.ts", line: 1 }] }, { check: "check_b", hits: [] }] });
      const reading = await ledger.reading(world.project);
      assert.equal(reading.length, 2);

      const ran = await world.run(["quality", "ledger"]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.ok(ran.stdout.startsWith(ledgerText(reading)), ran.stdout);
    } finally {
      await storytree.close();
    }
  });
});

test("(quality assurance's 2.1, 2.2 and 4.1) `quality brief`, `take`, `answer` and `standing` run one review of an increment's change through the package", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "Red then green", capabilities: [capability.id] });
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    writeFileSync(path.join(world.folder, "change.diff"), "diff --git a/packages/forms/src/email.test.ts b/packages/forms/src/email.test.ts\n+  assert.equal(valid(x), valid(x));\n");

    const brief = await world.run(["quality", "brief", increment.id, "--diff", "@change.diff"]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, new RegExp(`Review 1 of change ${increment.id}`));
    assert.match(brief.stdout, new RegExp(`${check.id}[\\s\\S]*${contract.id}[\\s\\S]*valid\\(x\\), valid\\(x\\)`));

    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ checks: [{ check: check.id, tripped: true, hits: [{ file: "packages/forms/src/email.test.ts", line: 2, found: "compares the code with itself" }] }], contracts: [] }));
    const refused = await world.run(["quality", "take", increment.id, "--return", "@return.json"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(contract.id));

    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ checks: [{ check: check.id, tripped: true, hits: [{ file: "packages/forms/src/email.test.ts", line: 2, found: "compares the code with itself" }] }], contracts: [{ contract: contract.id, met: true }] }));
    const taken = await world.run(["quality", "take", increment.id, "--return", "@return.json"]);
    assert.equal(taken.code, 0, taken.stderr);
    assert.match(taken.stdout, /Guardrails' graduated checks did not run, so nothing of theirs is recorded/);
    const storytree = await connect({ url: testServerUrl() });
    try {
      const [hit] = await (await openReviews(storytree)).standing(world.project, increment.id);
      assert.match(taken.stdout, new RegExp(`hit ${hit!.id} +${check.id} +packages/forms/src/email.test.ts:2`));

      const answered = await world.run(["quality", "answer", String(hit!.id), "fixed"]);
      assert.equal(answered.code, 0, answered.stderr);
      const standing = await world.run(["quality", "standing", increment.id]);
      assert.equal(standing.code, 0, standing.stderr);
      assert.ok(standing.stdout.startsWith("No finding stands: the change is ready for the gate."), standing.stdout);
    } finally {
      await storytree.close();
    }
  });
});

test("(quality assurance's 5.1) `quality graduate` writes the part and the Guardrails check that enforces it on the check, and the checks reading shows both; an unknown Guardrails check is refused, writing nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });

    const refused = await world.run(["quality", "graduate", check.id, "--part", "the same call twice", "--enforced-by", "no-such-check"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /no-such-check/);
    assert.equal((await checks(library))[0]!.graduated, undefined);

    const ran = await world.run(["quality", "graduate", check.id, "--part", "the same call on both sides of an equality", "--enforced-by", "self-equal-assertion"]);
    assert.equal(ran.code, 0, ran.stderr);
    const [read] = await checks(library);
    assert.deepEqual(read!.graduated, [{ part: "the same call on both sides of an equality", enforcedBy: "self-equal-assertion" }]);
    assert.ok(ran.stdout.includes(checksText([read!])), ran.stdout);
  });
});
