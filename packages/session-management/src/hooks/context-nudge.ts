/** Capability 9 · Context readings. Contract 9.9: one advisory nudge per Claude Code session, using the reading's current guidance. */
import type { Storytree } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { readContext } from "../context/context.js";
import { notYetGivenIds } from "./given-once.js";

/** Missing readings or settings add nothing, and never prevent the prompt's definitions. */
export async function contextNudge(storytree: Storytree, project: string, session: string): Promise<string | undefined> {
  try {
    const log = await openActivityLog(storytree);
    try {
      const reading = await readContext(log, project, session);
      if (!("tokens" in reading) || reading.harness !== "claude-code" || "absent" in reading.guidance || reading.guidance.position !== "past") return undefined;
      if (notYetGivenIds(session, ["start-fresh"], "context-nudges").length === 0) return undefined;
      return `[storytree] This session has used ${reading.tokens.toLocaleString("en-US")} tokens, past the context guidance of ${reading.guidance.value.toLocaleString("en-US")} tokens. Hand off and start a fresh session at the next safe boundary. This is advice; you decide when to hand off.`;
    } finally {
      await log.close();
    }
  } catch {
    return undefined;
  }
}
