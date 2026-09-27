/**
 * Capability 7 · Board, read only (stories/cli.md): who is on what right now, each claim on an
 * increment or a capability with its agent's harness, window and reason, and whether it is live or
 * idle; or who holds one piece of work. Claiming and releasing stay with the agents' tools.
 *
 * One reading: the agent link's `readClaims` over its activity log, which judges live and idle.
 */
import type { Claim } from "@storytree/agent-link";

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

export const noticeboard: Family = {
  name: "noticeboard",
  summary: "who is on what right now (read only)",
  verbs: [],
  bare: board,
};
