/**
 * Capability 1 · Front door. `storytree machine list`, `storytree machine this` and `storytree machine name <name>`
 * (ADR-0982): the computers that work on this project, which one this is, and giving it a short name. A front door
 * only: each is a machine verb Session management declares once (its capability 11 · Machines), mounted here.
 */
import { MACHINE_VERBS } from "@storytree/session-management/verbs";

import type { Family } from "../door.js";
import { command } from "../mount.js";

export const machine: Family = {
  name: "machine",
  summary: "the computers that work on this project, and this one's short name (Session management's)",
  verbs: MACHINE_VERBS.map(command),
};
