/**
 * Capability 4 · Sessions. The session verbs, declared once (ADR-0969 D2): name a session, close it out, and list the
 * sessions. The command line and the MCP server each mount them; listing the sessions has no tool, and says why.
 * Machines' verbs are mounted from here too (MACHINE_VERBS), as this is the verbs' one entry. SESSION_FAMILIES, which the
 * package's manifest names under `verbs` (ADR-1033), gives the command line them as its `session` and `machine` families,
 * with the noticeboard's (NOTICEBOARD_VERBS) and the context reading (CONTEXT_READING) as its `noticeboard` and `context`.
 */
import path from "node:path";

import { verb, VerbRefusal, type Verb, type VerbContext, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { ActivityLog } from "../activity/index.js";
import { SESSION_NAME_LIMIT } from "./name.js";

import { NOTICEBOARD_BOARD, NOTICEBOARD_VERBS } from "../claims/board-verbs.js";
import { CONTEXT_READING } from "../context/verbs.js";
import { MACHINE_VERBS } from "../machines/verbs.js";

export { MACHINE_VERBS };

/** What a session verb's work needs beyond the caller: the activity log it reads and writes, which the doors hand. */
export interface SessionVerbContext extends VerbContext {
  readonly log: ActivityLog;
}

const name = verb({
  command: { family: "session", name: "name", summary: `name this session's row in the sessions list, in ${SESSION_NAME_LIMIT} characters or fewer; again when the work shifts` },
  tool: {
    name: "name_session",
    description: `Name your session's row in the sessions list: what you are doing, in ${SESSION_NAME_LIMIT} characters or fewer. Name it once you know what you are doing, and again when your work shifts: the latest name shows.`,
  },
  inputs: { title: { kind: "text", word: 0, describe: `what you are doing, in ${SESSION_NAME_LIMIT} characters or fewer` } },
  agentOnly: "it names the agent session that runs it",
  async act({ title }, context: SessionVerbContext) {
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
  async act({ safe, why }, context: SessionVerbContext, words) {
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
  async act({ all, json }, { log, server, project, folder, session, harness }: SessionVerbContext) {
    // Merges are asked about now, as the board asks about claims: the list never waits on a hook's look.
    const look = { context: { log, project, folder, session, ...(harness === undefined ? {} : { harness }), source: "tool" } } as const;
    const { sessionsListing } = await import("./listing.js");
    const { machineNames } = await import("../machines/machines.js");
    // Each session's machine is shown by its short name (Machines, 11.3); unreadable names leave the hostnames.
    const names = server === undefined ? undefined : await machineNames(server).catch(() => undefined);
    const text = await sessionsListing(log, project, { all, json, look, ...(names === undefined ? {} : { names }) });
    return json ? { text } : { text, next: [{ command: "session list --all", why: "the hidden sessions too" }] };
  },
});

/** The session verbs, in the order the command line lists them. */
export const SESSION_VERBS: readonly Verb<VerbInputs, SessionVerbContext>[] = [list, name, closeOut];

/** The command line's families of these verbs, each at its place among `storytree`'s families. */
export const SESSION_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [
  { name: "noticeboard", summary: "who is on what right now (read only)", order: 5, verbs: NOTICEBOARD_VERBS, bare: NOTICEBOARD_BOARD },
  { name: "context", summary: "how full this session's context is (Session management's)", order: 31, verbs: [], bare: CONTEXT_READING },
  { name: "session", summary: "list the running sessions, name this one, or close it out (Session management's)", order: 32, verbs: SESSION_VERBS },
  { name: "machine", summary: "the computers that work on this project, and this one's short name (Session management's)", order: 33, verbs: MACHINE_VERBS },
];
