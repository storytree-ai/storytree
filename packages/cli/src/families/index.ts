/**
 * The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * stories/cli.md, each a front door onto its owning story.
 */
import type { Family } from "../door.js";
import { arcs } from "./arc.js";
import { library } from "./library.js";
import { plan } from "./tree.js";

/** Not built yet: this increment builds it next. */
const BEING_BUILT = "it is being built (0-3-cli-build)";

export const FAMILIES: readonly Family[] = [
  library,
  arcs,
  { name: "question", summary: "the owner's questions: raise, settle, retire, list", verbs: [], waitsOn: BEING_BUILT },
  { name: "adr", summary: "the decision log: list, new, pull, push, compose", verbs: [], waitsOn: BEING_BUILT },
  { name: "noticeboard", summary: "who is on what right now (read only)", verbs: [], waitsOn: BEING_BUILT },
  { name: "doctor", summary: "storytree's setup check, from a terminal", verbs: [], waitsOn: BEING_BUILT },
  {
    name: "friction",
    summary: "file friction with its evidence, or add a recurrence",
    verbs: [],
    waitsOn: "it waits on the agent link's capture functions and `reinforce` (0-3-agent-link-cli-seams)",
  },
  {
    name: "resteer",
    summary: "file a re-steer, with the owner's own words",
    verbs: [],
    waitsOn: "it waits on the agent link's capture functions (0-3-agent-link-cli-seams)",
  },
  plan,
];
