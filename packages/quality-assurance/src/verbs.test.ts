/**
 * Capability 1 · Quality control checks: the `quality` verbs this package declares for the command line to mount, run
 * as the command line hands them a caller, in a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { VerbRefusal, type DoorWords } from "@storytree/project-and-caller/verbs";

import { withLibrary } from "./testing/pg.js";
import { checks, checksText } from "./index.js";
import { QUALITY_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("1.3 · Quality assurance declares the `quality` verbs the command line mounts: `quality checks` answers with the checks reading, and a verb that needs the ledger is refused when the door hands no server", async () => {
  await withLibrary(async (library) => {
    const [quality] = QUALITY_FAMILIES;
    assert.equal(quality!.name, "quality");
    const named = (name: string) => quality!.verbs.find((one) => "family" in one.command && one.command.name === name)!;
    assert.deepEqual(quality!.verbs.map((one) => "family" in one.command ? one.command.name : undefined), ["checks", "ledger", "brief", "take", "answer", "standing", "graduate"]);

    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const caller = { library, project: library.name, session: "test", folder: process.cwd() };
    const answer = await named("checks").act({}, caller as never, WORDS);
    assert.equal(answer.text, checksText(await checks(library)));

    await assert.rejects(named("ledger").act({}, caller as never, WORDS), (error: unknown) => error instanceof VerbRefusal && /library server/.test(error.message));
  });
});
