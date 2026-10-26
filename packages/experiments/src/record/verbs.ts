/**
 * Capability 4 · Experiment record and freeze. The `experiment` verbs, declared here (ADR-1033 D3) and named under `verbs`
 * in the package's manifest, so the command line mounts them as its `experiment` family: freezing a record (capability 4), running it (capability 7)
 * and recording and reading its curves (capability 5), with `experiment arm` (capability 2) and `experiment task` (capability 8) within it. No tool serves them yet.
 */
import type { Storytree } from "@storytree/library";
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "@storytree/library/verbs";

import { ARM_FAMILY } from "../arm-verbs.js";
import { madeArms, TASK_FAMILY } from "../harbor/verbs.js";
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
    experiment: { kind: "text", word: 0, describe: "the experiment's name, as its arms' repositories are named, or its record's id" },
    json: { kind: "switch", describe: "the series as JSON, arm by arm, ready to plot" },
  },
  async act({ experiment, json }, context) {
    if (context.server === undefined) throw new VerbRefusal("an experiment's points are kept on the library server, which this door has not opened");
    const { curves, curvesText } = await import("../points/points.js");
    const series = await curves(context.server, context.library.name, experiment);
    return json ? { text: `${JSON.stringify({ experiment, arms: series }, null, 2)}\n`, raw: true } : { text: curvesText(experiment, series) };
  },
});

const pointsVerb = verb({
  consumers: ["user"],
  command: { family: "experiment", name: "points", summary: "record each arm's new merges, and the seed, as points: what `experiment run` does at every look (ADR-1064 D4)", usage: "experiment points <experiment> [--arms a,b] [--record <record>]" },
  tool: { absent: "points are recorded on the Mint box by whoever runs the experiment, never by a lane" },
  inputs: {
    experiment: { kind: "text", word: 0, describe: "the experiment's name, as its arms' repositories are named" },
    arms: { kind: "text", optional: true, describe: "the arms to record, comma-separated; every arm made for the experiment in this storytree home by default" },
    record: { kind: "text", optional: true, describe: "the experiment record the points are for, by its id, so `experiment curves` reads them by it too; the arms' points recorded without it are tied to it" },
  },
  // The door hands the whole library server: recording reads the arms' own projects and the activity log beside them.
  async act({ experiment, arms, record }: { experiment: string; arms: string | undefined; record: string | undefined }, context: VerbContext & { readonly server?: Storytree }) {
    if (context.server === undefined) throw new VerbRefusal("an experiment's points are kept on the library server, which this door has not opened");
    const names = arms === undefined ? madeArms(experiment) : arms.split(",").map((arm) => arm.trim()).filter((arm) => arm !== "");
    if (names.length === 0) throw new VerbRefusal(`experiment ${experiment} has no arms made in this storytree home: name them with --arms, or record on the machine that made them`);
    const { recordArms, recordedLines } = await import("../points/points.js");
    const lines = recordedLines(await recordArms(context.server, context.library.name, experiment, names, record === undefined ? {} : { record }));
    return { text: lines.join("\n"), next: [{ command: `experiment curves ${experiment}`, why: "read each arm's curve" }] };
  },
});

/** The `experiment` family. */
export const EXPERIMENT_FAMILIES: readonly VerbFamily[] = [{
  name: "experiment",
  summary: "write an experiment down before it runs, give its arms throwaway libraries, import its task, and read its curves (ADR-1064)",
  order: 27,
  verbs: [freezeVerb, curvesVerb, pointsVerb, RUN_VERB],
  families: [ARM_FAMILY, TASK_FAMILY],
}];
