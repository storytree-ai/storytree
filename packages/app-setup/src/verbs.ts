/**
 * Capability 8 · Setup check, 2 · Connect an agent, 3 · First-run guide and 12 · Import an existing project. The app setup's
 * command families, which the package's manifest names under `verbs` (ADR-1033), each at its place among `storytree`'s
 * families: `doctor` 8th, `setup` 20th, `project` 21st and `import` 22nd.
 */
import type { Library, Storytree } from "@storytree/library";
import type { VerbContext, VerbFamily, VerbPlace } from "@storytree/library/verbs";

import { CONNECTION_VERBS } from "./connect/verbs.js";
import { IMPORT, PROJECT_VERBS } from "./project/verbs.js";
import { DOCTOR, SETUP } from "./setup/verbs.js";

/** The journey events the setup verbs record, when the door keeps a journey. */
export interface SetupJourney {
  projectCreated(): void;
  agentConnected(): void;
}

/**
 * What the command line hands the setup verbs besides the folder: its own script, beside which an installed storytree
 * keeps its hook, setup and delivery scripts, and the journey's events.
 */
export interface SetupVerbContext extends VerbPlace {
  readonly script?: string;
  readonly journey?: () => Promise<SetupJourney>;
}

/** What `import` is handed: the caller's library and the whole library server, where imports are recorded. */
export interface ImportVerbContext extends VerbContext, Pick<SetupVerbContext, "script" | "journey"> {
  readonly library: Library;
  readonly server: Storytree;
}

export const SETUP_FAMILIES: readonly VerbFamily<SetupVerbContext>[] = [
  { name: "doctor", summary: "storytree's setup check, from a terminal", order: 8, verbs: [], bare: DOCTOR },
  { name: "setup", summary: "connect or disconnect agents; install or remove storytree's hooks", order: 20, verbs: CONNECTION_VERBS, bare: SETUP },
  { name: "project", summary: "take a project off this computer's list, or delete its records", order: 21, verbs: PROJECT_VERBS },
  { name: "import", summary: "import an existing JavaScript or TypeScript project into this one: one mapped story per package it declares", order: 22, verbs: [], bare: IMPORT },
];
