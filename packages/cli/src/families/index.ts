/**
 * The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story.
 */
import type { Family } from "../door.js";
import { decisions } from "./adr.js";
import { appFamily } from "./app.js";
import { arcs } from "./arc.js";
import { friction, resteer } from "./capture.js";
import { doctorFamily, setupFamily } from "./doctor.js";
import { library } from "./library.js";
import { questions } from "./question.js";
import { noticeboard } from "./noticeboard.js";
import { plan } from "./tree.js";
import { workspace } from "./workspace.js";
import { own } from "./own.js";
import { settings } from "./settings.js";

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
  setupFamily,
  workspace,
  own,
  settings,
];
