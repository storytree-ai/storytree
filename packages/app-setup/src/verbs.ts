// Capability 8 · Setup check, 2 · Connect an agent, 3 · First-run guide and 12 · Import an existing project.
import type { Library, Storytree } from "@storytree/library";
import type { VerbContext, VerbFamily, VerbPlace } from "@storytree/library/verbs";

import { CONNECTION_VERBS } from "./connect/verbs.js";
import { IMPORT, PROJECT_VERBS } from "./project/verbs.js";
import { DOCTOR, SETUP } from "./setup/verbs.js";

export interface SetupJourney {
  projectCreated(): void;
  agentConnected(): void;
}

export interface SetupVerbContext extends VerbPlace {
  readonly script?: string;
  readonly journey?: () => Promise<SetupJourney>;
}

export interface ImportVerbContext extends VerbContext, Pick<SetupVerbContext, "script" | "journey"> {
  readonly library: Library;
  readonly server: Storytree;
}

export const SETUP_FAMILIES: readonly VerbFamily<SetupVerbContext>[] = [
  { name: "doctor", summary: "storytree's setup check, from a terminal", order: 8, verbs: [], bare: DOCTOR },
  { name: "setup", summary: "connect or disconnect agents; install or remove storytree's hooks", order: 20, verbs: CONNECTION_VERBS, bare: SETUP },
  { name: "project", summary: "take a project off this computer's list, or delete its records", order: 21, verbs: PROJECT_VERBS },
  { name: "import", summary: "import an existing JavaScript, TypeScript or Python project into this one: one imported story per package it declares", order: 22, verbs: [], bare: IMPORT },
];
