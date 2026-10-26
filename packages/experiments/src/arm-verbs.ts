/**
 * Capability 2 · Arm workspaces. The `experiment arm` verbs (ADR-1033 D3), an inner family the `experiment` family in
 * record/verbs.ts mounts: `experiment arm make`, `grant` and `drop`. They
 * act on the cluster that holds the caller's library as this machine's own user, signed in over the cluster's local socket
 * as its local admin, never as the library's role, and open no project: the real one is never read or written. The
 * cluster is reached only on this machine (ADR-1064 D3 puts the arms on the Mint box's), so the library's role needs no
 * right to make roles. They are no tools: an arm is made by whoever runs the experiment, not by a lane.
 */
import { userInfo } from "node:os";
import path from "node:path";

import type { ClientConfig } from "pg";

import { verb, VerbRefusal, type VerbFamilies, type VerbPlace } from "@storytree/library/verbs";
import { readLibrary, storytreeHome } from "@storytree/project-and-caller";

import type { OnDatabase, SharedOptions } from "./workspaces.js";

const NO_TOOL = { absent: "an arm is made by whoever runs the experiment, never by a lane" };

const ARM_INPUTS = {
  experiment: { kind: "text", word: 0, describe: "the experiment, in lower-case words joined by hyphens" },
  arm: { kind: "text", word: 1, describe: "the arm, one the experiment kit holds" },
  home: { kind: "text", optional: true, describe: "the arm's storytree home; by default experiments/x-<experiment>-<arm> in this storytree home" },
} as const;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Where the cluster's local socket is, as Debian's and Ubuntu's Postgres packages put it (the Mint box's). */
const SOCKET_FOLDER = "/var/run/postgresql";

/**
 * The cluster's local admin on `database`: this machine's own user, signed in over the socket of the cluster at `address`
 * (its port), which the cluster lets in as the role of that name without a password.
 */
export function localAdmin(address: string, database: string): ClientConfig {
  const port = new URL(address).port;
  return { host: SOCKET_FOLDER, port: port === "" ? 5432 : Number(port), user: userInfo().username, database };
}

/**
 * The cluster that holds this caller's library, signed in as its local admin, with the library's address and the way to
 * its other databases as that admin; refused when it is not one here.
 */
async function cluster<T>(body: (admin: import("pg").Client, server: string, shared: SharedOptions) => Promise<T>): Promise<T> {
  const library = readLibrary();
  if (library.location !== "postgres" || !LOOPBACK.has(new URL(library.address).hostname)) {
    throw new VerbRefusal("An experiment's arms are made on the Postgres cluster that holds your library, on this machine: run this where the library setting is a postgres address on 127.0.0.1 (the Mint box).");
  }
  const pg = (await import("pg")).default;
  const admin = new pg.Client(localAdmin(library.address, "postgres"));
  const onDatabase: OnDatabase = async (database, inside) => {
    const client = new pg.Client(localAdmin(library.address, database));
    await client.connect();
    try {
      return await inside(client);
    } finally {
      await client.end();
    }
  };
  await admin.connect();
  try {
    return await body(admin, library.address, { onDatabase });
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
    const made = await cluster((admin, server, shared) => makeArm(admin, server, experiment, arm, homeOf(experiment, arm, home), shared));
    return {
      text: `Made arm "${arm}" of experiment "${experiment}": role and project ${made.project}, database ${made.database}, home ${made.home}. A lane run with STORYTREE_HOME=${made.home} works in that library alone, and in the shared ${granted(made.granted)}.`,
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
    await cluster((admin, _server, shared) => dropArm(admin, experiment, arm, folder, shared));
    return { text: `Dropped arm "${arm}" of experiment "${experiment}": its database, role and home ${folder}.` };
  },
});

const grantVerb = verb({
  consumers: ["user"],
  command: { family: "experiment arm", name: "grant", summary: "grant an arm already made what its lanes use in the server's shared activity, QA, routing and points databases, as make does", usage: "experiment arm grant <experiment> <arm>" },
  tool: NO_TOOL,
  callerless: true,
  inputs: { experiment: ARM_INPUTS.experiment, arm: ARM_INPUTS.arm },
  async act({ experiment, arm }: { experiment: string; arm: string }) {
    const { grantArm } = await import("./workspaces.js");
    const done = await cluster((admin, _server, shared) => grantArm(admin, experiment, arm, shared));
    return { text: `Granted arm "${arm}" of experiment "${experiment}" the shared ${granted(done)}.`, data: { granted: [...done] } };
  },
});

function granted(databases: readonly string[]): string {
  return databases.length === 0 ? "databases: none, as the server holds none of them yet" : `databases ${databases.join(", ")}`;
}

/** `experiment arm`, the inner family of the command line's `experiment` family. */
export const ARM_FAMILY: VerbFamilies<VerbPlace> = { name: "arm", summary: "make, grant or drop an arm's throwaway library and home", verbs: [makeVerb, grantVerb, dropVerb] };
