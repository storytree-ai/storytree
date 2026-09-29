/**
 * Capability 7 · Board, read only (the command line story): who is on what right now, each claim on an
 * increment or a capability with its agent's harness, window and reason, and whether it is live or
 * idle; or who holds one piece of work. Claiming and releasing stay with the agents' tools.
 *
 * One reading: the agent link's `readClaims` over its activity log, which judges live and idle.
 * `noticeboard log` shows the log's latest lines as the agent link writes them out, each with the
 * line that caused it or "cause not recorded" (ADR-0746 D2).
 */
import { lineText, type Claim } from "@storytree/agent-link";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

/** What a claim holds: "increment <id>" or "capability <id>". */
function partOf(claim: Claim): string {
  return claim.increment !== undefined ? `increment ${claim.increment}` : `capability ${claim.capability}`;
}

/** Who holds it: the harness, its session (the window), whether it is live, and since when. */
function holderOf(claim: Claim): string {
  return `${claim.label} ${claim.session} (${claim.holder}${claim.branch === undefined ? "" : `, on ${claim.branch}`}), since ${claim.since}`;
}

const board: Verb = {
  name: "noticeboard",
  usage: "noticeboard [<increment|capability>]",
  summary: "every claim now, or who holds one piece of work",
  async act(args, context) {
    const id = args.words[0];
    const claims = await context.claims();
    if (id !== undefined) {
      const held = claims.find((claim) => claim.increment === id || claim.capability === id);
      return { text: held === undefined ? `${id}: nobody holds it.` : `${id}: held by ${holderOf(held)}: ${held.reason}` };
    }
    if (claims.length === 0) return { text: "Nobody holds anything right now." };
    const lines = claims.map((claim) => `  - ${partOf(claim)}  ${holderOf(claim)}: ${claim.reason}`);
    return { text: [`${claims.length} claim${claims.length === 1 ? "" : "s"} now:`, ...lines].join("\n") };
  },
};

/** How many of the latest lines `noticeboard log` shows unless told. */
const LOG_LINES = 20;

const log: Verb = {
  name: "log",
  usage: "noticeboard log [--session <id>] [--limit <n>]",
  summary: "the activity log's latest lines, each with the line that caused it",
  async act(args, context) {
    const session = args.text("session");
    const limit = Number(args.text("limit") ?? LOG_LINES);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Refusal(`--limit takes a whole number, 1 or more\nusage: storytree noticeboard log [--session <id>] [--limit <n>]`, { code: 2 });
    const { log: activity, project } = await context.activityContext();
    const lines = (await activity.since(project, 0)).lines.filter((line) => session === undefined || line.session === session).slice(-limit);
    if (lines.length === 0) return { text: session === undefined ? "The activity log has no lines yet." : `The activity log has no lines for ${session}.` };
    return { text: lines.map(lineText).join("\n") };
  },
};

export const noticeboard: Family = {
  name: "noticeboard",
  summary: "who is on what right now (read only)",
  verbs: [log],
  bare: board,
};
