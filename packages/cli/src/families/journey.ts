/** Capability 1 · Front door. Consent and deletion controls delegate entirely to the journey events story. */
import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

export const journeyFamily: Family = {
  name: "journey",
  summary: "show or change your journey sharing choice",
  verbs: [
    ...(["status", "on", "off"] as const).map((name) => ({
      name,
      usage: `journey ${name}`,
      summary: name === "status" ? "show your journey sharing choice" : name === "on" ? "choose to share permitted journey events" : "stop sharing journey events",
      async act(args, context) {
        if (args.words.length || args.names.length) throw new Refusal(`usage: storytree journey ${name}`, { code: 2 });
        const runtime = await context.journey();
        const state = name === "status" ? await runtime.readJourney() : await runtime.chooseJourney(name === "on");
        const { formatJourneyState } = await import("@storytree/journey-events/runtime");
        return { text: formatJourneyState(state) };
      },
    } satisfies Family["verbs"][number])),
    {
      name: "delete-request",
      usage: "journey delete-request",
      summary: "stop sharing and prepare a request to delete your journey events",
      async act(args, context) {
        if (args.words.length || args.names.length) throw new Refusal("usage: storytree journey delete-request", { code: 2 });
        const request = await (await context.journey()).prepareJourneyDeletion();
        const { formatDeletionRequest } = await import("@storytree/journey-events/runtime");
        return { text: formatDeletionRequest(request) };
      },
    },
  ],
};
