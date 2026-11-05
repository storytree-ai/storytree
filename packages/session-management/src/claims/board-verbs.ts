/**
 * Capability 5 · Claims. The noticeboard's verbs, declared once (ADR-0969 D2, ADR-1033): who is on what right now, each
 * claim on an increment or a capability with its agent's harness, window and reason, and whether it is live or idle; or
 * who holds one piece of work; and the activity log's latest lines, each with the line that caused it or "cause not
 * recorded" (ADR-0746 D2). Both read only. The command line mounts them as its `noticeboard` family (SESSION_FAMILIES);
 * the MCP server has no tool for either.
 */
import { verb, VerbRefusal, type Verb, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import type { Claim } from "./claims.js";

/** What a claim holds: "increment <id>" or "capability <id>". */
function partOf(claim: Claim): string {
  return claim.increment !== undefined ? `increment ${claim.increment}` : `capability ${claim.capability}`;
}

/** Who holds it: the harness, its session (the window), whether it is live, and since when. */
function holderOf(claim: Claim): string {
  return `${claim.label} ${claim.session} (${claim.holder}${claim.branch === undefined ? "" : `, on ${claim.branch}`}), since ${claim.since}`;
}

const board = verb({
  command: { family: "noticeboard", name: "noticeboard", summary: "every claim now, or who holds one piece of work", usage: "noticeboard [<increment|capability>]" },
  tool: { absent: "an agent reads who holds what from show_plan" },
  inputs: { id: { kind: "text", word: 0, optional: true, describe: "an increment or a capability: who holds it" } },
  async act({ id }, { log, library, project, folder, session, harness }: SessionVerbContext) {
    // GitHub is asked first, so a claim whose branch has merged is never shown (ADR-0643 D3), its increment's pending
    // plan changes applied first through the board's library (5.37).
    const { boardClaims } = await import("./merges.js");
    const claims = await boardClaims({ log, project, folder, session, ...(harness === undefined ? {} : { harness }), source: "tool", library });
    if (id !== undefined) {
      const held = claims.find((claim) => claim.increment === id || claim.capability === id);
      return { text: held === undefined ? `${id}: nobody holds it.` : `${id}: held by ${holderOf(held)}: ${held.reason}` };
    }
    if (claims.length === 0) return { text: "Nobody holds anything right now." };
    const lines = claims.map((claim) => `  - ${partOf(claim)}  ${holderOf(claim)}: ${claim.reason}`);
    return { text: [`${claims.length} claim${claims.length === 1 ? "" : "s"} now:`, ...lines].join("\n") };
  },
});

/** How many of the latest lines `noticeboard log` shows unless told. */
const LOG_LINES = 20;

/** A --since or --until value as the instant it names, or a misuse refusal when it names none. */
function instant(flag: string, given: string | undefined): string | undefined {
  if (given === undefined) return undefined;
  const at = Date.parse(given);
  if (Number.isNaN(at)) throw new VerbRefusal(`${flag} takes a time, such as 2026-11-05T19:21:53Z`, { misuse: true });
  return new Date(at).toISOString();
}

const log = verb({
  command: {
    family: "noticeboard",
    name: "log",
    summary: "the activity log's latest lines and their causes, for a session or holder over a window; --full keeps complete commands",
    usage: "noticeboard log [--session <id>] [--holder <session>] [--since <time>] [--until <time>] [--limit <n>] [--full]",
  },
  tool: { absent: "the activity log's lines are read from a terminal" },
  inputs: {
    session: { kind: "text", optional: true, describe: "only this session's lines" },
    holder: { kind: "text", optional: true, describe: "only lines naming this session as a claim's holder: what ended its claims" },
    since: { kind: "text", optional: true, describe: "only lines written at this time or later" },
    until: { kind: "text", optional: true, describe: "only lines written at this time or earlier" },
    limit: { kind: "text", optional: true, describe: `how many of the latest lines, ${LOG_LINES} unless told` },
    full: { kind: "switch", describe: "complete commands, not clipped" },
  },
  async act({ session, holder, since: from, until: to, limit: given, full }, { log: activity, project }: SessionVerbContext) {
    const limit = Number(given ?? LOG_LINES);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new VerbRefusal("--limit takes a whole number, 1 or more", { misuse: true });
    const since = instant("--since", from);
    const until = instant("--until", to);
    // The latest lines alone, never the whole log (2.7).
    const lines = await activity.lines(project, {
      ...(session === undefined ? {} : { sessions: [session] }),
      ...(holder === undefined ? {} : { where: { holder } }),
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      newest: limit,
    });
    if (lines.length === 0) {
      if (session !== undefined) return { text: `The activity log has no lines for ${session}.` };
      return { text: holder === undefined && since === undefined && until === undefined ? "The activity log has no lines yet." : "The activity log has no lines that match." };
    }
    const { fullLineText, lineText } = await import("../activity/text.js");
    return { text: lines.map(full ? fullLineText : lineText).join("\n") };
  },
});

/** The noticeboard's verbs besides its bare one, and the bare one, which answers `storytree noticeboard [<id>]`. */
export const NOTICEBOARD_VERBS: readonly Verb<VerbInputs, SessionVerbContext>[] = [log];
export const NOTICEBOARD_BOARD: Verb<VerbInputs, SessionVerbContext> = board;
