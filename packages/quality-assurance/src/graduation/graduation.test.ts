/**
 * Capability 5 · Graduation: contract 5.1 in a fresh project's library on the real Postgres `pnpm test`
 * provides, through the package's public entry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withLibrary } from "../testing/pg.js";
import { checks, checksText, graduate } from "../index.js";

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
