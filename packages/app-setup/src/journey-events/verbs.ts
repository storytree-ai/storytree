// Capability 15 · Sharing controls.
import { verb, type Verb, type VerbFamily, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

import type { JourneyBridge } from "./bridge.js";

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

export const JOURNEY_FAMILIES: readonly VerbFamily<JourneyPlace>[] = [
  { name: "journey", summary: "show or change your journey sharing choice", order: 26, verbs: [...choices, deletion] },
];
