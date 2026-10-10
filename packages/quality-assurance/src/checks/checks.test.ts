/**
 * Capability 1 · Quality control checks: contract 1.1 in a fresh project's library on the real Postgres
 * `pnpm test` provides, through the package's public entry. Contract 1.2 is also proved at the two front
 * doors, beside the command line's tests and the MCP server's, because this package cannot depend back on either.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withLibrary } from "../testing/pg.js";
import { checks, checksText, qualityTools } from "../index.js";

test("1.1 · the checks reading gives every live check with its question and the id, kind and title of each note it enforces; a retired check is not in it", async () => {
  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const guardrail = await library.writeKnowledge("guardrail", { title: "No proxy assertions", description: "Assert the behaviour, not a stand-in.", statement: "Never assert a proxy.", rule: "Assert the observable behaviour.", enforcedBy: "review", failureMode: "A test passes while the behaviour is broken." });
    const tautology = await library.writeKnowledge("check", {
      title: "Tautological expected value",
      description: "A test whose expected value is computed the way the code computes it.",
      question: "Is any expected value computed the way the code computes it?",
      enforces: [principle.id, guardrail.id],
    });
    const skips = await library.writeKnowledge("check", {
      title: "Visible skips",
      description: "A skipped test says so.",
      question: "Does any test skip without saying why?",
      enforces: [principle.id],
    });
    await library.retire(skips.id, "folded into another check");

    assert.deepEqual(await checks(library), [{
      id: tautology.id,
      title: "Tautological expected value",
      question: "Is any expected value computed the way the code computes it?",
      enforces: [
        { id: principle.id, kind: "principle", title: "Test creation principles" },
        { id: guardrail.id, kind: "guardrail", title: "No proxy assertions" },
      ],
    }]);
    assert.equal(checksText([]), "No quality control checks are in this library.");
  });
});

test("1.2 · the tool this package registers answers the checks reading as data and as the text the command line prints", async () => {
  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const gone = await library.writeKnowledge("principle", { title: "Old rule", description: "Retired.", statement: "Old.", why: "Old.", howToApply: "Old." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id, gone.id] });
    await library.retire(gone.id, "overtaken");

    const tools: Record<string, (args: object, call: { library: typeof library }) => Promise<{ text: string; data?: Record<string, unknown> }>> = {};
    qualityTools().registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
    assert.deepEqual(Object.keys(tools), ["quality_checks", "quality_ledger"]);
    const answer = await tools.quality_checks!({}, { library });

    assert.equal(answer.text, [
      "1 quality control check:",
      `  ${check.id}  Tautological expected value`,
      "    Is any expected value computed the way the code computes it?",
      `    enforces ${principle.id}  [principle]  Test creation principles`,
      `    enforces ${gone.id}  (no longer live)`,
    ].join("\n"));
    assert.deepEqual(answer.data, { checks: [{
      id: check.id,
      title: "Tautological expected value",
      question: "Is any expected value computed the way the code computes it?",
      enforces: [{ id: principle.id, kind: "principle", title: "Test creation principles" }, { id: gone.id }],
    }] });
  });
});
