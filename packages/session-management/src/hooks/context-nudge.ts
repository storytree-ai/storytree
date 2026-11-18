/** Capability 9 · Context readings. Contract 9.9: one advisory nudge per Claude Code session, using the reading's current guidance. */
import type { Storytree } from "@storytree/library";

import { readContext } from "../context/context.js";
import { freshIds } from "./given-once.js";

/** The advice's id in the "context-nudges" ledger. */
export const START_FRESH = "start-fresh";

/**
 * Missing readings or settings add nothing, and never prevent the prompt's definitions. Read only:
 * the caller remembers START_FRESH in the "context-nudges" ledger once the advice is shown.
 */
export async function contextNudge(storytree: Storytree, project: string, session: string): Promise<string | undefined> {
  try {
    // Loaded here, not at the top: a static import would load the library on every hook's start (3.3).
    const { openActivityLog } = await import("../activity/index.js");
    const log = await openActivityLog(storytree);
    try {
      const reading = await readContext(log, project, session);
      if (!("tokens" in reading) || reading.harness !== "claude-code" || "absent" in reading.guidance || reading.guidance.position !== "past") return undefined;
      if (freshIds(session, [START_FRESH], "context-nudges").length === 0) return undefined;
      return `[storytree] This session has used ${reading.tokens.toLocaleString("en-US")} tokens, past the context guidance of ${reading.guidance.value.toLocaleString("en-US")} tokens. Hand off and start a fresh session at the next safe boundary. This is advice; you decide when to hand off.`;
    } finally {
      await log.close();
    }
  } catch {
    return undefined;
  }
}
