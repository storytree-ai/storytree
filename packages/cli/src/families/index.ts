/**
 * Capability 1 · Front door. The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story. A family its owning story declares in its manifest
 * (`#parts/verbs`, ADR-1033) is mounted from there, at the place it declares among those still kept here.
 */
import declared from "#parts/verbs";

import type { Family } from "../door.js";
import { family as mounted } from "../mount.js";
import { auth } from "./auth.js";
import { capabilities } from "./capability.js";
import { commandsOf, doors } from "./doors.js";
import { learning, twinsOf } from "./drain.js";
import { plan } from "./tree.js";
import { mapFamily } from "./map.js";
import { affectedFamily } from "./affected.js";

/** Words agents try for a family storytree does not have, each with the command for that job. */
export const GUESSES: Readonly<Record<string, string>> = {
  claim: "workspace <increment|capability> --reason <text>",
  board: "noticeboard",
  plan: "library new <story|capability|contract> --<field> <value|@file> …",
  contract: "library new contract --capability <capability> --title <t>",
  story: "tree [<story>]",
};

/**
 * Words agents guess for a job a command already does, keyed by the words after `storytree`, each with that command:
 * the door runs it with the words after them and says so (ADR-1090 D1, the hand-written ADR-1045 D4 pointer).
 */
export const POINTERS: Readonly<Record<string, string>> = {
  "adr show": "adr pull",
  wait: "arc increment wait",
  "friction list": "library list friction",
  "library open": "library read",
  "capability show": "library read",
};

/** The families still kept here, in their order once the declared ones take their places. */
const KEPT: readonly Family[] = [
  doors,
  plan,
  mapFamily,
  affectedFamily,
  capabilities,
  auth,
];

export const FAMILIES: readonly Family[] = [...declared].sort((a, b) => a.order - b.order).reduce(
  (families, family) => families.toSpliced(family.order - 1, 0, learning(mounted(family), surfaces)),
  KEPT,
);

/** The surfaces the doors learner judges in the friction drain: every command, every tool served in `cwd`, and the verbs both mount. */
async function surfaces(cwd: string) {
  const { servedTools } = await import("@storytree/mcp-server");
  const tools = (await servedTools(cwd)).map(({ name, consumers }) => ({ verb: name, consumers }));
  return { commands: commandsOf(FAMILIES), tools, twins: twinsOf(declared) };
}
