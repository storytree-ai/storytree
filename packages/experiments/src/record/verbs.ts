/**
 * Capability 4 · Experiment record and freeze. The `experiment` verbs, declared here (ADR-1033 D3) and named under `verbs`
 * in the package's manifest, so the command line mounts them as its `experiment` family: freezing a record (capability 4), running it (capability 7)
 * and reading its curves (capability 5), with `experiment arm` (capability 2) and `experiment task` (capability 8) within it. No tool serves them yet.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";

import { ARM_FAMILY } from "../arm-verbs.js";
import { TASK_FAMILY } from "../harbor/verbs.js";
import { RUN_VERB } from "../run/verbs.js";

const freezeVerb = verb({
  consumers: ["agent"],
  command: { family: "experiment", name: "freeze", summary: "freeze an experiment before it runs: stamp the time, after which only its outcome may be added (ADR-1064 D5)", usage: "experiment freeze <experiment>" },
  tool: { absent: "an experiment is frozen once, by whoever pre-registers it, at the command line" },
  writes: true,
  inputs: { experiment: { kind: "text", word: 0, describe: "the experiment record to freeze" } },
  async act({ experiment }, context) {
    const { ExperimentRefusal, freeze } = await import("./record.js");
    try {
      const stamp = await freeze(context.library, experiment, context.writer!);
      return { text: `Froze experiment ${experiment} at ${stamp}: from now on only its outcome may be added.`, next: [{ command: `library read ${experiment}`, why: "read the frozen record" }] };
    } catch (error) {
      if (error instanceof ExperimentRefusal) throw new VerbRefusal(error.message);
      throw error;
    }
  },
});

const curvesVerb = verb({
  consumers: ["agent"],
  command: { family: "experiment", name: "curves", summary: "an experiment's points, one per merge on each arm's repository, as a series per arm (ADR-1064 D4)", usage: "experiment curves <experiment> [--json]" },
  tool: { absent: "the curves are read at the command line, by whoever reads the experiment" },
  inputs: {
    experiment: { kind: "text", word: 0, describe: "the experiment's name, as its arms' repositories are named" },
    json: { kind: "switch", describe: "the series as JSON, arm by arm, ready to plot" },
  },
  async act({ experiment, json }, context) {
    if (context.server === undefined) throw new VerbRefusal("an experiment's points are kept on the library server, which this door has not opened");
    const { curves, curvesText } = await import("../points/points.js");
    const series = await curves(context.server, context.library.name, experiment);
    return json ? { text: `${JSON.stringify({ experiment, arms: series }, null, 2)}\n`, raw: true } : { text: curvesText(experiment, series) };
  },
});

/** The `experiment` family. */
export const EXPERIMENT_FAMILIES: readonly VerbFamily[] = [{
  name: "experiment",
  summary: "write an experiment down before it runs, give its arms throwaway libraries, import its task, and read its curves (ADR-1064)",
  order: 27,
  verbs: [freezeVerb, curvesVerb, RUN_VERB],
  families: [ARM_FAMILY, TASK_FAMILY],
}];
