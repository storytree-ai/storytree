/**
 * Quality assurance's contract 1.2, at this front door: the real, built `storytree quality checks` prints
 * the checks reading through quality assurance's public API, the same reading its tool on the MCP server gives.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { checks, checksText } from "@storytree/quality-assurance";

import { BuiltCommand, inWorld } from "./testing/cli.js";

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
