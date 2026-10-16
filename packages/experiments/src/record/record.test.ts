/** Capability 4 · Experiment record and freeze, in a fresh project's library on the Postgres `pnpm test` provides. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withLibrary } from "../testing/pg.js";
import { frozenExperiment } from "../index.js";
import { EXPERIMENT_FAMILIES } from "./verbs.js";

const TWIN_BUILD = {
  title: "Twin build of nextjs-vite-rewrite",
  description: "Does the Map help agents on a long multi-agent build?",
  arms: [
    { name: "map-reads-on", description: "The factory as it runs" },
    { name: "map-reads-off", description: "The factory with Map reads denied", denies: { tools: ["focus"], commands: ["storytree map"] } },
  ],
  hypotheses: ["Lanes with Map reads spend fewer tokens before their first edit"],
  measures: ["Share of the 370 tests passing after each merge"],
  criteria: { helps: "The on arm's pass share rises faster", noHelp: "The curves stay within 5 points", inconclusive: "Either arm stops before 20 merges" },
  budget: "The owner's subscription",
  stopRules: ["Stop an arm when its pass share has not risen for 10 merges"],
};

test("4.1 · freezing an experiment stamps the time once, and a run reads only a frozen one", async () => {
  await withLibrary(async (library) => {
    const [family] = EXPERIMENT_FAMILIES;
    const freeze = family!.verbs.find((one) => one.command !== undefined && "name" in one.command && one.command.name === "freeze")!;
    const context = { library, project: "storytree", session: "s", folder: process.cwd(), writer: { actor: "session:s" } } as never;
    const words = { door: "command" as const, say: (step: { command?: string }) => `storytree ${step.command}` };
    const experiment = await library.writeKnowledge("experiment", TWIN_BUILD);

    await assert.rejects(frozenExperiment(library, experiment.id), (error: unknown) => error instanceof Error && error.message.includes(experiment.id) && /not frozen/.test(error.message), "a run refuses an unfrozen record");

    const before = Date.now();
    const answer = await freeze.act({ experiment: experiment.id }, context, words);
    const stamp = ((await library.get(experiment.id))?.fields as { frozen?: string }).frozen;
    assert.ok(stamp !== undefined && Date.parse(stamp) >= before - 1000 && Date.parse(stamp) <= Date.now(), `freezing stamps the time now: ${stamp}`);
    assert.match(answer.text, new RegExp(`Froze experiment ${experiment.id} at ${stamp}`));
    assert.deepEqual(await frozenExperiment(library, experiment.id), { ...TWIN_BUILD, frozen: stamp }, "a run reads the frozen record");

    await assert.rejects(freeze.act({ experiment: experiment.id }, context, words), (error: unknown) => error instanceof VerbRefusal && error.message.includes(`already frozen at ${stamp}`), "a second freeze is refused, keeping the first time");
    const principle = await library.writeKnowledge("principle", { title: "Small", description: "Small", statement: "Small", why: "Small", howToApply: "Small" });
    for (const id of [principle.id, "experiment_000000000000"]) {
      await assert.rejects(freeze.act({ experiment: id }, context, words), (error: unknown) => error instanceof VerbRefusal && error.message.includes(id), `${id} is no experiment to freeze`);
      await assert.rejects(frozenExperiment(library, id), (error: unknown) => error instanceof Error && error.message.includes(id), `${id} is no experiment to run`);
    }
  });
});
