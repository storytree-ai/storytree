// Capability 9 · Context readings
import type { Storytree } from "@storytree/library";

import { readContext } from "../context/context.js";
import { freshIds } from "./given-once.js";

export const START_FRESH = "start-fresh";

export async function contextNudge(storytree: Storytree, project: string, session: string): Promise<string | undefined> {
  try {
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
