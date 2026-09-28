/**
 * `read_context` (contract 6.22): the calling session's context reading (capability 9), worked out
 * at the time of the call from the transcript its hooks named. The caller is the session the hook
 * before the call named, so after Claude Code's /clear it is the new session's (6.8).
 */
import { z } from "zod";

import { readContext } from "../context/index.js";
import type { Define } from "./server.js";

export function registerContextTools(define: Define): void {
  define(
    "read_context",
    "How many tokens your own context window holds right now, read from your session's transcript. It states no limit: judge it against the project's guidance.",
    z.object({}),
    async (_args, { log, project, caller }) => {
      const reading = await readContext(log, project, caller.session);
      const text = "absent" in reading ? `No context reading for this session: ${reading.absent}.` : `Your context holds ${reading.tokens.toLocaleString("en-US")} tokens.`;
      return { text, data: { ...reading } };
    },
  );
}
