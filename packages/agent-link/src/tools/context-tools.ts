/**
 * `read_context` (contract 6.22): the calling session's context reading (capability 9), worked out
 * at the time of the call from the transcript its hooks named. The caller is the session the hook
 * before the call named, so after Claude Code's /clear it is the new session's (6.8).
 */
import { z } from "zod";

import { readContext } from "../context/index.js";
import { guidanceSentence } from "../context/guidance.js";
import type { Define } from "./server.js";

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
}
