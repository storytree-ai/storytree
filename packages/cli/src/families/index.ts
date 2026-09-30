/**
 * The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story.
 */
import type { Family } from "../door.js";
import { decisions } from "./adr.js";
import { appFamily } from "./app.js";
import { arcs } from "./arc.js";
import { capabilities } from "./capability.js";
import { friction, resteer } from "./capture.js";
import { contextFamily } from "./context.js";
import { doctorFamily, setupFamily } from "./doctor.js";
import { library } from "./library.js";
import { questions } from "./question.js";
import { noticeboard } from "./noticeboard.js";
import { projectFamily } from "./project.js";
import { plan } from "./tree.js";
import { workspace } from "./workspace.js";
import { processes } from "./processes.js";
import { session } from "./session.js";
import { settings } from "./settings.js";

/** Words agents try for a family storytree does not have, each with the command for that job. */
export const GUESSES: Readonly<Record<string, string>> = {
  claim: "workspace <increment|capability> --reason <text>",
  board: "noticeboard",
};

export const FAMILIES: readonly Family[] = [
  library,
  arcs,
  questions,
  decisions,
  noticeboard,
  doctorFamily,
  appFamily,
  friction,
  resteer,
  plan,
  capabilities,
  setupFamily,
  projectFamily,
  workspace,
  processes,
  settings,
  contextFamily,
  session,
];
