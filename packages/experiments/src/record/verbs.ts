/**
 * Capability 4 · Experiment record and freeze. The `experiment` verbs, declared here (ADR-1033 D3) and named under `verbs`
 * in the package's manifest, so the command line mounts them as its `experiment` family. No tool serves them yet.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";

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

/** The `experiment` family. */
export const EXPERIMENT_FAMILIES: readonly VerbFamily[] = [{
  name: "experiment",
  summary: "write an experiment down before it runs (ADR-1064)",
  order: 27,
  verbs: [freezeVerb],
}];
