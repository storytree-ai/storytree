/**
 * Capability 1 · Front door. A thin front door onto the identity story's sign-in (its capability 2): `storytree sign-in`,
 * `storytree status` and `storytree sign-out` parse nothing and hand the command to identityCommand, which owns the flow
 * and its words. The deployment names its public WorkOS client ID and its HTTPS identity endpoint in
 * STORYTREE_WORKOS_CLIENT_ID and STORYTREE_IDENTITY_URL; without them sign-in is not configured, and every command
 * still answers, signed out, and exits cleanly. The session is kept privately under the storytree home.
 */
import path from "node:path";

import { Refusal } from "../answer.js";
import type { Context, Family } from "../door.js";

const NOT_CONFIGURED = "Sign-in is not configured in this storytree (it needs STORYTREE_WORKOS_CLIENT_ID and STORYTREE_IDENTITY_URL). Storytree works without an account.";

function identityFamily(command: "sign-in" | "status" | "sign-out", summary: string): Family {
  return {
    name: command,
    summary,
    verbs: [],
    bare: {
      name: command,
      usage: command,
      summary,
      async act(args, context) {
        if (args.words.length || args.names.length) throw new Refusal(`usage: storytree ${command}`, { code: 2 });
        return { text: await identity(command, context) };
      },
    },
  };
}

async function identity(command: "sign-in" | "status" | "sign-out", context: Context): Promise<string> {
  const clientId = process.env.STORYTREE_WORKOS_CLIENT_ID ?? "";
  const identityUrl = process.env.STORYTREE_IDENTITY_URL ?? "";
  if (clientId === "" || identityUrl === "") return command === "sign-in" ? NOT_CONFIGURED : `Signed out. ${NOT_CONFIGURED}`;
  const [{ identityCommand }, { storytreeHome }] = await Promise.all([import("@storytree/identity/command"), import("@storytree/agent-link/routing")]);
  // Ctrl-C cancels a waiting sign-in through identity, which releases its lock and saves nothing.
  const cancel = new AbortController();
  const interrupted = () => cancel.abort();
  process.once("SIGINT", interrupted);
  try {
    return await identityCommand(command, { clientId, identityUrl, directory: path.join(storytreeHome(), "identity"), signal: cancel.signal, out: context.out });
  } finally {
    process.off("SIGINT", interrupted);
  }
}

export const signIn = identityFamily("sign-in", "sign in to a Storytree account in your browser (optional)");
export const accountStatus = identityFamily("status", "say which Storytree account this computer is signed in as, if any");
export const signOut = identityFamily("sign-out", "sign this computer out of its Storytree account");
