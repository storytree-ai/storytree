/**
 * Capability 2 · Agent activity log: the log's query for the lines a tool call is read from. Project and caller's
 * caller names the call from these lines (ADR-1025 D2); the MCP server's wrapper composes the two (ADR-0969 D1).
 */
import type { Line } from "@storytree/library";
import { agentOf, callOf, watchedHarness, type CallMeta } from "@storytree/project-and-caller/caller";
import type { ActivityLog } from "./activity-log.js";

/**
 * The lines a call is read from (contract 2.7): the line the hook before it left, found by the call's
 * id, and the start of the subagent that line or the call names. Nothing else of the log is sent.
 */
export async function callLines(log: ActivityLog, project: string, meta: CallMeta, called?: { readonly harness?: string | undefined; readonly tool: string }): Promise<Line[]> {
  const call = callOf(meta);
  const requested = call === undefined ? await announcedRequest(log, project, called) : await log.lines(project, { kinds: ["tool-requested"], where: { call }, newest: 1, omit: ["transcript"] });
  const agent = agentOf(requested, meta);
  if (typeof agent !== "object") return requested;
  const started = await log.lines(project, { kinds: ["subagent-started"], where: { subagent: agent.subagent }, newest: 1, omit: ["transcript"] });
  return [...started, ...requested].sort((a, b) => a.seq - b.seq);
}

/** How long before a call a hook of a harness that sends no call id may have announced it. */
const ANNOUNCED_WITHIN_MS = 30_000;

/**
 * The line the hook of a harness that sends the tool server no session and no call id left just before a
 * call to `called.tool`: Cursor (read from its installed code, 2026-10-12, 6.66) and Pi (measured in Pi
 * 1.1.0, 6.68). Its line is found by its harness, its tool and its time: the newest that harness announced
 * for that tool in the last half minute. Two sessions of one such harness calling the same tool in the
 * same moment may be taken for each other; every other harness is joined by the call's id, never by time.
 */
async function announcedRequest(log: ActivityLog, project: string, called: { readonly harness?: string | undefined; readonly tool: string } | undefined): Promise<Line[]> {
  const harness = called?.harness;
  if (harness === undefined || watchedHarness(harness)?.callIds !== false) return [];
  const since = new Date(Date.now() - ANNOUNCED_WITHIN_MS).toISOString();
  return log.lines(project, { kinds: ["tool-requested"], where: { harness, tool: called!.tool }, since, newest: 1, omit: ["transcript"] });
}
