/**
 * Capability 1 · Quality control checks: the `quality` family this package declares for the command line to mount
 * (ADR-1033 D3), acted in a fresh project's library on the real Postgres `pnpm test` provides, as a door hands it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { withLibrary } from "../testing/pg.js";
import { QUALITY_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("1.3 · Quality assurance declares the `quality` verbs the command line mounts: `quality checks` answers with the checks reading, and a verb that needs the ledger is refused when the door hands no server", async () => {
  const [family] = QUALITY_FAMILIES;
  assert.equal(family!.name, "quality");
  assert.equal(family!.order, 10);
  const verbs = new Map(family!.verbs.map((one) => [(one.command as { name: string }).name, one]));
  assert.deepEqual([...verbs.keys()], ["checks", "ledger", "brief", "take", "answer", "standing", "graduate"]);

  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    // No server and no activity log: the door hands the caller without them.
    const context = { folder: process.cwd(), library, project: library.name, session: "person:test" } as unknown as SessionVerbContext;

    const answered = await verbs.get("checks")!.act({}, context, WORDS);
    assert.equal(answered.text, [
      "1 quality control check:",
      `  ${check.id}  Tautological expected value`,
      "    Is any expected value computed the way the code computes it?",
      `    enforces ${principle.id}  [principle]  Test creation principles`,
    ].join("\n"));

    await assert.rejects(
      verbs.get("ledger")!.act({}, context, WORDS),
      (error: unknown) => error instanceof VerbRefusal && !error.misuse && /QA ledger .*library server/.test(error.message),
    );
  });
});
