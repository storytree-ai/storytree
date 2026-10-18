/**
 * Capability 15 · Sharing controls. The `journey` verbs, declared here (ADR-0969 D2) and named under `verbs` in the package's
 * manifest (ADR-1033), so the command line mounts them as its `journey` family: show or change this computer's journey
 * sharing choice, or stop sharing and prepare a deletion request. Each needs no caller; the door hands the per-process
 * runtime, which it finishes after the answer. None is a tool: the desktop app's settings carry the same controls.
 */
import { verb, type Verb, type VerbFamily, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

import type { JourneyBridge } from "./bridge.js";

/** What a door hands the journey verbs: its folder and the journey runtime it opens on first use. */
export interface JourneyPlace extends VerbPlace {
  journey(): Promise<JourneyBridge>;
}

const ABSENT = { absent: "the desktop app's settings carry the journey sharing controls" };

const choices: Verb<VerbInputs, JourneyPlace>[] = (["status", "on", "off"] as const).map((name) => verb({
  command: { family: "journey", name, summary: name === "status" ? "show your journey sharing choice" : name === "on" ? "choose to share permitted journey events" : "stop sharing journey events" },
  tool: ABSENT,
  inputs: {},
  callerless: true,
  async act(_input, { journey }: JourneyPlace) {
    const runtime = await journey();
    const state = name === "status" ? await runtime.readJourney() : await runtime.chooseJourney(name === "on");
    const { formatJourneyState } = await import("./runtime.js");
    return { text: formatJourneyState(state) };
  },
}));

const deletion = verb({
  command: { family: "journey", name: "delete-request", summary: "stop sharing and prepare a request to delete your journey events" },
  tool: ABSENT,
  inputs: {},
  callerless: true,
  async act(_input, { journey }: JourneyPlace) {
    const request = await (await journey()).prepareJourneyDeletion();
    const { formatDeletionRequest } = await import("./runtime.js");
    return { text: formatDeletionRequest(request) };
  },
});

/** The command line's `journey` family, 26th among `storytree`'s families. */
export const JOURNEY_FAMILIES: readonly VerbFamily<JourneyPlace>[] = [
  { name: "journey", summary: "show or change your journey sharing choice", order: 26, verbs: [...choices, deletion] },
];
