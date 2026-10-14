/**
 * Capability 1 · Front door. The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story. A family its owning story declares in its manifest
 * (`#parts/verbs`, ADR-1033) is mounted from there, at the place it declares among those still kept here.
 */
import declared from "#parts/verbs";

import type { Family } from "../door.js";
import { command } from "../mount.js";
import { decisions } from "./adr.js";
import { appFamily } from "./app.js";
import { auth } from "./auth.js";
import { arcs } from "./arc.js";
import { capabilities } from "./capability.js";
import { friction, resteer } from "./capture.js";
import { contextFamily } from "./context.js";
import { doctorFamily, setupFamily } from "./doctor.js";
import { doors } from "./doors.js";
import { accountStatus, signIn, signOut } from "./identity.js";
import { library } from "./library.js";
import { journeyFamily } from "./journey.js";
import { lag } from "./lag.js";
import { questions } from "./question.js";
import { noticeboard } from "./noticeboard.js";
import { importFamily, projectFamily } from "./project.js";
import { health, plan } from "./tree.js";
import { workspace } from "./workspace.js";
import { processes } from "./processes.js";
import { settings } from "./settings.js";
import { mapFamily } from "./map.js";
import { affectedFamily } from "./affected.js";
import { releaseFamily } from "./release.js";
import { checkFamily } from "./guardrails.js";
import { quality } from "./quality.js";

/** Words agents try for a family storytree does not have, each with the command for that job. */
export const GUESSES: Readonly<Record<string, string>> = {
  claim: "workspace <increment|capability> --reason <text>",
  board: "noticeboard",
};

/** The families still kept here, in their order once the declared ones take their places. */
const KEPT: readonly Family[] = [
  library,
  arcs,
  questions,
  decisions,
  noticeboard,
  doors,
  lag,
  doctorFamily,
  checkFamily,
  quality,
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
  importFamily,
  workspace,
  processes,
  settings,
  journeyFamily,
  auth,
  signIn,
  accountStatus,
  signOut,
  contextFamily,
];

export const FAMILIES: readonly Family[] = [...declared].sort((a, b) => a.order - b.order).reduce(
  (families, family) => families.toSpliced(family.order - 1, 0, { name: family.name, summary: family.summary, verbs: family.verbs.map(command) }),
  KEPT,
);
