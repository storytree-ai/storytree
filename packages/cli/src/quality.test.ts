/**
 * Quality assurance's contracts 1.2 and 3.4, at this front door: the real, built `storytree quality checks`
 * and `storytree quality ledger` print the checks and ledger readings through quality assurance's public API,
 * the same readings its tools on the MCP server give.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { connect } from "@storytree/library";
import { checks, checksText, ledgerText, openLedger } from "@storytree/quality-assurance";

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
