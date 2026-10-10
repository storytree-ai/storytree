/**
 * Capability 6 · Agent tools (the MCP server). `read_context` (contract 6.22): the calling session's context reading (capability 9), worked out
 * at the time of the call from the transcript its hooks named. The caller is the session the hook
 * before the call named, so after Claude Code's /clear it is the new session's (6.8).
 */
import path from "node:path";

import { z } from "zod";

import { currentBranch } from "@storytree/agent-link";
import { closeOut } from "@storytree/agent-link";
import { nameRefusal, nameSession, SESSION_NAME_LIMIT } from "@storytree/agent-link";

import { readContext } from "@storytree/agent-link";
import { guidanceSentence } from "@storytree/agent-link";
import { lineOf, type Define } from "./server.js";

export function registerContextTools(define: Define, home?: string): void {
  define(
    "read_context",
    "How many tokens your own context window holds right now, read from your session's transcript, and whether that is under, at or past your context guidance. Guidance is not an enforced limit.",
    z.object({}),
    async (_args, { log, project, caller }) => {
      const reading = await readContext(log, project, caller.session, home === undefined ? {} : { home });
      const text = "absent" in reading ? `No context reading for this session: ${reading.absent}.` : `Your context holds ${reading.tokens.toLocaleString("en-US")} tokens. ${guidanceSentence(reading.guidance)}`;
      return { text, data: { ...reading } };
    },
  );

  define(
    "close_out",
    "Close out your session when its work is done: release all your claims and say whether it is safe to close (safe) and why. The reply lists released claims. The sessions list checks a yes against your branches and your own running work: a yes it bears out leaves the list; anything else stays there, marked as needing the owner.",
    z.object({
      safe: z.boolean().describe("true: every pull request merged, the working tree clean, nothing of yours left running"),
      why: z.string().min(1).describe("Why, in a few words"),
    }),
    async ({ safe, why }, { log, library, project, caller, folder, writer }) => {
      const branch = currentBranch(folder);
      const { running, released } = await closeOut(
        { log, library, project, ...lineOf(caller), folder, writer, ...(branch === undefined ? {} : { branch }) },
        { safe, why },
        { look: {}, ...(home === undefined ? {} : { home: path.join(home, "own"), claimHome: home }) },
      );
      const counted = running === undefined ? "Your own running work could not be counted, so a yes will show as needing the owner." : running === 0 ? "Nothing of yours is running here." : `${running} of your runs still run here: stop them (stop_own_run) and close out again.`;
      const claims = released.length === 0 ? "No claims to release." : `Released claims: ${released.join(", ")}.`;
      return { text: `Closed out: ${safe ? "safe to close" : "not safe to close"} (${why.trim()}). ${counted} ${claims}`, data: { safe, released, ...(running === undefined ? {} : { running }) } };
    },
  );

  define(
    "name_session",
    `Name your session's row in the sessions list: what you are doing, in ${SESSION_NAME_LIMIT} characters or fewer. Name it once you know what you are doing, and again when your work shifts: the latest name shows.`,
    z.object({ title: z.string().min(1).describe(`What you are doing, in ${SESSION_NAME_LIMIT} characters or fewer`) }),
    async ({ title }, { log, project, caller, folder }) => {
      const branch = currentBranch(folder);
      const answer = await nameSession({ log, project, ...lineOf(caller), folder, ...(branch === undefined ? {} : { branch }) }, title);
      if (!answer.ok) return { text: nameRefusal(answer), refused: true };
      return { text: `Your session is named "${answer.line.kind === "session-named" ? answer.line.title : title}" in the sessions list.` };
    },
  );
}
