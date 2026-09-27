/**
 * The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story.
 */
import type { Family } from "../door.js";
import { decisions } from "./adr.js";
import { arcs } from "./arc.js";
import { doctorFamily, setupFamily } from "./doctor.js";
import { library } from "./library.js";
import { questions } from "./question.js";
import { noticeboard } from "./noticeboard.js";
import { plan } from "./tree.js";

export const FAMILIES: readonly Family[] = [
  library,
  arcs,
  questions,
  decisions,
  noticeboard,
  doctorFamily,
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
  setupFamily,
];
