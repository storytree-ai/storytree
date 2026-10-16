/** Capability 7 · Experiment dispatcher: `experiment run` at the door, in a fresh project's library on the Postgres `pnpm test` provides. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { freeze } from "../record/record.js";
import { withLibrary } from "../testing/pg.js";
import { RUN_VERB } from "./verbs.js";

const RECORD = {
  title: "Twin build",
  description: "Does the Map help agents?",
  arms: [
    { name: "map-reads-on", description: "on" },
    { name: "map-reads-off", description: "off", denies: { tools: ["focus"], commands: ["storytree map"] } },
  ],
  hypotheses: ["h"],
  measures: ["m"],
  criteria: { helps: "x", noHelp: "y", inconclusive: "z" },
  budget: "the subscription",
  stopRules: ["Stop an arm when its verifier share has not risen for 10 consecutive merges."],
};

test("7.6 · `experiment run` refuses, at the door, an unfrozen record and a frozen one whose stop rules it cannot read", async () => {
  await withLibrary(async (library, server) => {
    const writer = { actor: "session:s" };
    const context: VerbContext = { library, server, project: library.name, session: "s", folder: process.cwd(), writer };
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
    const run = (experiment: string) => RUN_VERB.act({ experiment, as: "twin", rules: "rules.md" }, context, words);
    const experiment = await library.writeKnowledge("experiment", RECORD);

    await assert.rejects(run(experiment.id), (error: unknown) => error instanceof VerbRefusal && /not frozen/.test(error.message));
    await freeze(library, experiment.id, writer);
    await assert.rejects(run(experiment.id), (error: unknown) => error instanceof VerbRefusal && /no wall-clock limit/.test(error.message));
  });
});
