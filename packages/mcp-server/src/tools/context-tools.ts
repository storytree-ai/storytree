/**
 * Capability 6 · Agent tools (the MCP server). `read_context` (contract 6.22): the calling session's context reading (capability 9), worked out
 * at the time of the call from the transcript its hooks named. The caller is the session the hook
 * before the call named, so after Claude Code's /clear it is the new session's (6.8). The session verbs (close_out,
 * name_session) are Session management's, declared once and mounted here (ADR-0969 D2).
 */
import { z } from "zod";

import { SESSION_VERBS } from "@storytree/session-management/verbs";

import { readContext } from "@storytree/session-management";
import { guidanceSentence } from "@storytree/session-management";
import { mountTools } from "./mount.js";
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

  mountTools(define, SESSION_VERBS, home);
}
