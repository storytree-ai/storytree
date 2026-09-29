/**
 * `storytree session list [--all] [--json]`: the running sessions, as the app's list shows them.
 * `storytree session close-out --safe yes|no --why <text>` (ADR-0758 D2): the calling agent session
 * records whether it is safe to close, and why. A front door only: the agent link reads the
 * sessions, writes the line and counts the session's own running work.
 */
import { closeOut, sessionsListing } from "@storytree/agent-link";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";
import { commandSession } from "../writer.js";

const USAGE = "session close-out --safe yes|no --why <text>";

const close: Verb = {
  name: "close-out",
  usage: USAGE,
  summary: "say whether this session is safe to close, and why: the sessions list checks a yes",
  async act(args, context) {
    const safe = args.need("safe", USAGE);
    if (safe !== "yes" && safe !== "no") throw new Refusal(`--safe is yes or no, not ${JSON.stringify(safe)}\nusage: storytree ${USAGE}`, { code: 2 });
    const why = args.need("why", USAGE).trim();
    if (why === "") throw new Refusal(`--why says why, in a few words\nusage: storytree ${USAGE}`, { code: 2 });
    if (commandSession() === undefined) throw new Refusal("Run close-out from the agent's shell: it closes out the agent session that runs it.");
    const caller = await context.claimContext();
    const { running } = await closeOut(caller, { safe: safe === "yes", why });
    const counted = running === undefined ? "Your own running work could not be counted, so a yes will show as needing the owner." : running === 0 ? "Nothing of yours is running here." : `${running} run${running === 1 ? "" : "s"} of yours still ${running === 1 ? "runs" : "run"} here: stop ${running === 1 ? "it" : "them"} (storytree processes) and close out again.`;
    return {
      text: `Closed out: ${safe === "yes" ? "safe to close" : "not safe to close"} (${why}). ${counted}`,
      next: [{ command: "storytree processes", why: "what of yours still runs here" }],
    };
  },
};

const list: Verb = {
  name: "list",
  usage: "session list [--all] [--json]",
  summary: "the running sessions, as the app's list shows them: --all adds the hidden ones",
  switches: ["all", "json"],
  async act(args, context) {
    const { log, project } = await context.activityContext();
    const json = args.has("json");
    const text = await sessionsListing(log, project, { all: args.has("all"), json });
    return json ? { text } : { text, next: [{ command: "storytree session list --all", why: "the hidden sessions too" }] };
  },
};

export const session: Family = {
  name: "session",
  summary: "list the running sessions, or close out this one (the agent link's)",
  verbs: [list, close],
};
