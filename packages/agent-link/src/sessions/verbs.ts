/**
 * Capability 4 · Sessions. The session verbs, declared once (ADR-0969 D2): name a session, close it out, and list the
 * sessions. The command line and the MCP server each mount them; listing the sessions has no tool, and says why.
 */
import path from "node:path";

import { SESSION_NAME_LIMIT } from "./name.js";
import { verb, VerbRefusal, type Verb } from "./verb.js";

export { commandInput, commandUsage, mounted, toolInput, VerbRefusal } from "./verb.js";
export type { DoorWords, InputOf, Step, Verb, VerbAnswer, VerbContext, VerbInput, VerbInputs } from "./verb.js";

const name = verb({
  command: { family: "session", name: "name", summary: `name this session's row in the sessions list, in ${SESSION_NAME_LIMIT} characters or fewer; again when the work shifts` },
  tool: {
    name: "name_session",
    description: `Name your session's row in the sessions list: what you are doing, in ${SESSION_NAME_LIMIT} characters or fewer. Name it once you know what you are doing, and again when your work shifts: the latest name shows.`,
  },
  inputs: { title: { kind: "text", word: 0, describe: `what you are doing, in ${SESSION_NAME_LIMIT} characters or fewer` } },
  agentOnly: "it names the agent session that runs it",
  async act({ title }, context) {
    const { nameRefusal, nameSession } = await import("./name.js");
    const answer = await nameSession(context, title);
    if (!answer.ok) throw new VerbRefusal(nameRefusal(answer), { misuse: true });
    return { text: `Named this session "${answer.line.kind === "session-named" ? answer.line.title : title}" in the sessions list.` };
  },
});

const closeOut = verb({
  command: { family: "session", name: "close-out", summary: "say whether this session is safe to close, and why: the sessions list checks a yes" },
  tool: {
    name: "close_out",
    description: "Close out your session when its work is done: release all your claims and say whether it is safe to close (safe) and why. The reply lists released claims. The sessions list checks a yes against your branches and your own running work: a yes it bears out leaves the list; anything else stays there, marked as needing the owner.",
  },
  inputs: {
    safe: { kind: "yes-no", describe: "yes: every pull request merged, the working tree clean, nothing of yours left running" },
    why: { kind: "text", describe: "why, in a few words" },
  },
  agentOnly: "it closes out the agent session that runs it",
  async act({ safe, why }, context, words) {
    const { closeOut: close } = await import("./close-out.js");
    const { running, released } = await close(context, { safe, why }, { look: {}, ...(context.home === undefined ? {} : { home: path.join(context.home, "own") }) });
    const stop = words.say({ tool: "stop_own_run", command: "processes stop" });
    const counted = running === undefined ? "Your own running work could not be counted, so a yes will show as needing the owner."
      : running === 0 ? "Nothing of yours is running here."
      : `${running} run${running === 1 ? "" : "s"} of yours still ${running === 1 ? "runs" : "run"} here: stop ${running === 1 ? "it" : "them"} (${stop}) and close out again.`;
    const claims = released.length === 0 ? "No claims to release." : `Released claims: ${released.join(", ")}.`;
    return {
      text: `Closed out: ${safe ? "safe to close" : "not safe to close"} (${why}). ${counted} ${claims}`,
      data: { safe, released, ...(running === undefined ? {} : { running }) },
    };
  },
});

const list = verb({
  command: { family: "session", name: "list", summary: "the running sessions, as the app's list shows them: --all adds the hidden ones" },
  tool: { absent: "an agent reads who is on what from show_plan; the sessions list is the owner's view of every session" },
  inputs: {
    all: { kind: "switch", describe: "the hidden sessions too" },
    json: { kind: "switch", describe: "as JSON" },
  },
  async act({ all, json }, { log, project, folder, session, harness }) {
    // Merges are asked about now, as the board asks about claims: the list never waits on a hook's look.
    const look = { context: { log, project, folder, session, ...(harness === undefined ? {} : { harness }), source: "tool" } } as const;
    const { sessionsListing } = await import("./listing.js");
    const text = await sessionsListing(log, project, { all, json, look });
    return json ? { text } : { text, next: [{ command: "session list --all", why: "the hidden sessions too" }] };
  },
});

/** The session verbs, in the order the command line lists them. */
export const SESSION_VERBS: readonly Verb[] = [list, name, closeOut];
