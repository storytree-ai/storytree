/**
 * Capability 2 · Social sign-in and session. `storytree sign-in`, `status` and `sign-out`, declared once (ADR-0969 D2,
 * ADR-1033), each the bare verb of its own family, handing the command to identityCommand, which owns the flow and its
 * words (2.4). The deployment names its public WorkOS client ID in STORYTREE_WORKOS_CLIENT_ID; without it sign-in is not
 * configured, and every command still answers, signed out. They need no caller; sign-in prints its code on the door's
 * `out` while it waits. The command line mounts them (IDENTITY_FAMILIES); they have no tool.
 */
import path from "node:path";

import { verb, type Verb, type VerbFamily, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

/** Where an identity verb was called: the place, and where the door prints a line before the answer. */
export interface IdentityPlace extends VerbPlace {
  out(text: string): void;
}

type Command = "sign-in" | "status" | "sign-out";

const NOT_CONFIGURED = "Sign-in is not configured in this storytree (it needs STORYTREE_WORKOS_CLIENT_ID). Storytree works without an account.";

function bare(command: Command, summary: string): Verb<VerbInputs, IdentityPlace> {
  return verb({
    command: { family: command, name: command, summary },
    tool: { absent: "signing in is the person's own, in their browser from a terminal" },
    inputs: {},
    callerless: true,
    async act(_input, { out }: IdentityPlace) {
      return { text: await identity(command, out) };
    },
  });
}

async function identity(command: Command, out: (text: string) => void): Promise<string> {
  const clientId = process.env.STORYTREE_WORKOS_CLIENT_ID ?? "";
  if (clientId === "") return command === "sign-in" ? NOT_CONFIGURED : `Signed out. ${NOT_CONFIGURED}`;
  const [{ identityCommand }, { storytreeHome }] = await Promise.all([import("./command.js"), import("@storytree/project-and-caller/routing")]);
  // Ctrl-C cancels a waiting sign-in through identity, which releases its lock and saves nothing.
  const cancel = new AbortController();
  const interrupted = () => cancel.abort();
  process.once("SIGINT", interrupted);
  try {
    return await identityCommand(command, { clientId, directory: path.join(storytreeHome(), "identity"), signal: cancel.signal, out });
  } finally {
    process.off("SIGINT", interrupted);
  }
}

function family(command: Command, summary: string, order: number): VerbFamily<IdentityPlace> {
  return { name: command, summary, order, verbs: [], bare: bare(command, summary) };
}

/** The command line's `sign-in`, `status` and `sign-out` families, each at its place among `storytree`'s families. */
export const IDENTITY_FAMILIES: readonly VerbFamily<IdentityPlace>[] = [
  family("sign-in", "sign in to a Storytree account in your browser (optional)", 28),
  family("status", "say which Storytree account this computer is signed in as, if any", 29),
  family("sign-out", "sign this computer out of its Storytree account", 30),
];
