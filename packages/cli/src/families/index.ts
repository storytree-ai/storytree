/**
 * Capability 1 · Front door. The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story.
 */
import type { Family } from "../door.js";
import { decisions } from "./adr.js";
import { appFamily } from "./app.js";
import { auth } from "./auth.js";
import { arcs } from "./arc.js";
import { capabilities } from "./capability.js";
import { friction, resteer } from "./capture.js";
import { contextFamily } from "./context.js";
import { doctorFamily, setupFamily } from "./doctor.js";
import { accountStatus, signIn, signOut } from "./identity.js";
import { library } from "./library.js";
import { journeyFamily } from "./journey.js";
import { questions } from "./question.js";
import { noticeboard } from "./noticeboard.js";
import { projectFamily } from "./project.js";
import { health, plan } from "./tree.js";
import { workspace } from "./workspace.js";
import { processes } from "./processes.js";
import { session } from "./session.js";
import { settings } from "./settings.js";
import { mapFamily } from "./map.js";
import { affectedFamily } from "./affected.js";
import { releaseFamily } from "./release.js";
import { checkFamily } from "./guardrails.js";

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
  checkFamily,
  appFamily,
  releaseFamily,
  friction,
  resteer,
  plan,
  mapFamily,
  affectedFamily,
  health,
  capabilities,
  setupFamily,
  projectFamily,
  workspace,
  processes,
  settings,
  journeyFamily,
  auth,
  signIn,
  accountStatus,
  signOut,
  contextFamily,
  session,
];
