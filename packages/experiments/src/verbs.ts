/**
 * Capability 2 · Arm workspaces. The `experiment` verbs, declared here (ADR-1033 D3) and named under `verbs` in the
 * package's manifest, so the command line mounts them as its `experiment` family: `experiment arm make` and `drop`. They
 * act as the caller's own library role on the cluster that holds its library, signed in with its `postgres` key, and open
 * no project: the real one is never read or written. The cluster is reached only on this machine (ADR-1064 D3 puts the
 * arms on the Mint box's), so the role's password never leaves it. They are no tools: an arm is made by whoever runs the
 * experiment, not by a lane.
 */
import path from "node:path";

import { resolveKey } from "@storytree/keys";
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";
import { readLibrary, storytreeHome } from "@storytree/project-and-caller";

const NO_TOOL = { absent: "an arm is made by whoever runs the experiment, never by a lane" };

const ARM_INPUTS = {
  experiment: { kind: "text", word: 0, describe: "the experiment, in lower-case words joined by hyphens" },
  arm: { kind: "text", word: 1, describe: "the arm, one the experiment kit holds" },
  home: { kind: "text", optional: true, describe: "the arm's storytree home; by default experiments/x-<experiment>-<arm> in this storytree home" },
} as const;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The cluster that holds this caller's library, signed in as its role, with its address; refused when it is not one here. */
async function cluster<T>(body: (admin: import("pg").Client, server: string) => Promise<T>): Promise<T> {
  const library = readLibrary();
  if (library.location !== "postgres" || !LOOPBACK.has(new URL(library.address).hostname)) {
    throw new VerbRefusal("An experiment's arms are made on the Postgres cluster that holds your library, on this machine: run this where the library setting is a postgres address on 127.0.0.1 (the Mint box).");
  }
  const password = resolveKey("postgres");
  if (password === undefined) throw new VerbRefusal("There is no password saved for your library: save it with `storytree auth set postgres`, then try again.");
  const signedIn = new URL(library.address);
  signedIn.password = password;
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: signedIn.href });
  await admin.connect();
  try {
    return await body(admin, library.address);
  } finally {
    await admin.end();
  }
}

function homeOf(experiment: string, arm: string, home: string | undefined): string {
  return home ?? path.join(storytreeHome(), "experiments", `x-${experiment}-${arm}`);
}

const makeVerb = verb({
  consumers: ["user"],
  command: { family: "experiment arm", name: "make", summary: "make an arm's throwaway library (a role and database named x-<experiment>-<arm>) and the storytree home that points at it", usage: "experiment arm make <experiment> <arm> [--home <folder>]" },
  tool: NO_TOOL,
  callerless: true,
  inputs: ARM_INPUTS,
  async act({ experiment, arm, home }: { experiment: string; arm: string; home: string | undefined }) {
    const { makeArm } = await import("./workspaces.js");
    const made = await cluster((admin, server) => makeArm(admin, server, experiment, arm, homeOf(experiment, arm, home)));
    return {
      text: `Made arm "${arm}" of experiment "${experiment}": role and project ${made.project}, database ${made.database}, home ${made.home}. A lane run with STORYTREE_HOME=${made.home} works in that library alone.`,
      data: { ...made },
    };
  },
});

const dropVerb = verb({
  consumers: ["user"],
  command: { family: "experiment arm", name: "drop", summary: "drop an arm's throwaway database, role and home; the real library is left as it is", usage: "experiment arm drop <experiment> <arm> [--home <folder>]" },
  tool: NO_TOOL,
  callerless: true,
  inputs: ARM_INPUTS,
  async act({ experiment, arm, home }: { experiment: string; arm: string; home: string | undefined }) {
    const { dropArm } = await import("./workspaces.js");
    const folder = homeOf(experiment, arm, home);
    await cluster((admin) => dropArm(admin, experiment, arm, folder));
    return { text: `Dropped arm "${arm}" of experiment "${experiment}": its database, role and home ${folder}.` };
  },
});

/** The command line's `experiment` family, 34th among `storytree`'s families, with `experiment arm` within it. */
export const EXPERIMENT_FAMILIES: readonly VerbFamily<VerbPlace>[] = [{
  name: "experiment",
  summary: "experiments that test the factory: each arm's throwaway library and home",
  order: 34,
  verbs: [],
  families: [{ name: "arm", summary: "make or drop an arm's throwaway library and home", verbs: [makeVerb, dropVerb] }],
}];
