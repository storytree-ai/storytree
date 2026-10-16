/**
 * Capability 8 · Harbor task adapter. The `experiment task` verbs (ADR-1033 D3), an inner family the `experiment` family in
 * record/verbs.ts mounts: `experiment task import`. It acts on GitHub under the caller's `gh` sign-in and on each arm's
 * throwaway library through the arm's own home, and opens no project: the real one is never read or written. The two
 * tokens CI holds are keys the caller saves once, so neither is typed on a command line. No tool serves it: a task is
 * imported by whoever runs the experiment, not by a lane.
 */
import path from "node:path";

import { resolveKey } from "@storytree/keys";
import { verb, VerbRefusal, type VerbFamilies, type VerbPlace } from "@storytree/library/verbs";
import { storytreeHome } from "@storytree/project-and-caller";

import { ARMS } from "../arms.js";

/** The keys the import reads: the hidden tests' reader, and the merge queue's enqueuer. */
export const TESTS_TOKEN_KEY = "experiment-tests-token";
export const MERGE_QUEUE_TOKEN_KEY = "experiment-merge-queue-token";

const importVerb = verb({
  consumers: ["user"],
  command: {
    family: "experiment task",
    name: "import",
    summary: "import a Harbor task as an experiment's work: a private repository for its hidden tests, each arm's repository seeded from it with its verifier in CI, and its instruction as each arm's one arc (ADR-1064 D7)",
    usage: "experiment task import <harbor-task-dir> --experiment <name> [--arms a,b] [--checks <command>] [--starting-tree <folder>] [--workdir <path>]",
  },
  tool: { absent: "a task is imported by whoever runs the experiment, never by a lane" },
  callerless: true,
  inputs: {
    task: { kind: "text", word: 0, describe: "the Harbor task's folder: task.toml, instruction.md, environment/ and tests/" },
    experiment: { kind: "text", describe: "the experiment, in lower-case words joined by hyphens, whose arms are made" },
    arms: { kind: "text", optional: true, describe: "the arms to import into, comma-separated; every arm the kit holds by default" },
    checks: { kind: "text", optional: true, describe: "the shell command every arm pull request must pass; ci/checks.sh, which the arm's lanes keep, by default" },
    "starting-tree": { kind: "text", optional: true, describe: "the folder the arms start from; the task's environment/ without its Dockerfile by default" },
    workdir: { kind: "text", optional: true, describe: "where the merged tree sits in the task image when the verifier runs; /app by default" },
  },
  async act({ task, experiment, arms, checks, "starting-tree": startingTree, workdir }: {
    task: string; experiment: string; arms: string | undefined; checks: string | undefined; "starting-tree": string | undefined; workdir: string | undefined;
  }) {
    const testsToken = resolveKey(TESTS_TOKEN_KEY);
    const mergeQueueToken = resolveKey(MERGE_QUEUE_TOKEN_KEY);
    const unsaved = [[TESTS_TOKEN_KEY, testsToken, "a fine-grained token that reads only the tests repository"], [MERGE_QUEUE_TOKEN_KEY, mergeQueueToken, "one that may enqueue pull requests on the arm repositories only"]]
      .filter(([, value]) => value === undefined)
      .map(([name, , what]) => `${name} (${what}): save it with \`storytree auth set ${name}\``);
    if (unsaved.length > 0) throw new VerbRefusal(`The import needs two keys CI will hold, and ${unsaved.length === 2 ? "neither is" : "one is not"} saved: ${unsaved.join("; ")}.`);
    const names = arms === undefined ? Object.keys(ARMS) : arms.split(",").map((arm) => arm.trim()).filter((arm) => arm !== "");
    const { importHarborTask } = await import("./harbor.js");
    let imported;
    try {
      imported = await importHarborTask({
        task: path.resolve(task),
        experiment,
        arms: names.map((arm) => ({ arm, home: path.join(storytreeHome(), "experiments", `x-${experiment}-${arm}`) })),
        secrets: { testsToken: testsToken!, mergeQueueToken: mergeQueueToken! },
        ...(checks === undefined ? {} : { checks }),
        ...(startingTree === undefined ? {} : { startingTree: path.resolve(startingTree) }),
        ...(workdir === undefined ? {} : { workdir }),
      });
    } catch (error) {
      throw new VerbRefusal((error as Error).message);
    }
    const lines = [`Imported Harbor task ${imported.task} into experiment "${experiment}". Its hidden tests are in ${imported.testsRepository}, private.`];
    for (const arm of imported.arms) lines.push(`  ${arm.arm}: repository ${arm.repository}, arc ${arm.arc} in its library.`);
    return { text: lines.join("\n"), data: { ...imported } };
  },
});

/** `experiment task`, an inner family of the command line's `experiment` family. */
export const TASK_FAMILY: VerbFamilies<VerbPlace> = { name: "task", summary: "import a Harbor task as an experiment's work", verbs: [importVerb] };
