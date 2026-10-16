/**
 * Capability 7 · Experiment dispatcher. `experiment run` (ADR-1033 D3), a verb the `experiment` family in record/verbs.ts
 * mounts. It runs for as long as the experiment does, on the Mint box, where the real pool and the arms' libraries are.
 * No tool serves it: an experiment is run by whoever runs it, never by a lane.
 */
import path from "node:path";

import { verb, VerbRefusal } from "@storytree/library/verbs";

export const RUN_VERB = verb({
  consumers: ["user"],
  command: {
    family: "experiment", name: "run",
    summary: "dispatch a frozen experiment's arm lanes into the capacity the real pool leaves idle, alternating arms, until each arm's stop rules end it (ADR-1064 D3, D6)",
    usage: "experiment run <experiment> --as <name> --rules <file>",
  },
  tool: { absent: "an experiment is run on the Mint box by whoever runs it, never by a lane" },
  inputs: {
    experiment: { kind: "text", word: 0, describe: "the frozen experiment record to run" },
    as: { kind: "text", describe: "the experiment's short name, as its arms were made with `experiment arm make`" },
    rules: { kind: "text", describe: "the file of rules every arm lane's brief ends with" },
  },
  async act({ experiment, as, rules }: { experiment: string; as: string; rules: string }, context) {
    if (context.server === undefined) throw new VerbRefusal("an experiment's points are kept on the library server, which this door has not opened");
    const { ExperimentRefusal } = await import("../record/record.js");
    const { runRecorded } = await import("./dispatcher.js");
    try {
      const state = await runRecorded({ library: context.library, server: context.server, record: experiment, name: as, rulesFile: path.resolve(rules) });
      return { text: `Experiment ${experiment} (${as}) ended; its arms' lanes, first lanes and stop reasons are in ${state}.`, next: [{ command: `experiment curves ${as}`, why: "read each arm's curve" }] };
    } catch (error) {
      if (error instanceof ExperimentRefusal) throw new VerbRefusal(error.message);
      throw error;
    }
  },
});
