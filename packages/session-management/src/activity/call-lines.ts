// Capability 2 · Agent activity log
import type { Line } from "@storytree/library";
import { agentOf, callOf, watchedHarness, type CallMeta } from "@storytree/project-and-caller/caller";
import type { ActivityLog } from "./activity-log.js";

export async function callLines(log: ActivityLog, project: string, meta: CallMeta, called?: { readonly harness?: string | undefined; readonly tool: string }): Promise<Line[]> {
  const call = callOf(meta);
  const requested = call === undefined ? await announcedRequest(log, project, called) : await log.lines(project, { kinds: ["tool-requested"], where: { call }, newest: 1, omit: ["transcript"] });
  const agent = agentOf(requested, meta);
  if (typeof agent !== "object") return requested;
  const started = await log.lines(project, { kinds: ["subagent-started"], where: { subagent: agent.subagent }, newest: 1, omit: ["transcript"] });
  return [...started, ...requested].sort((a, b) => a.seq - b.seq);
}

const ANNOUNCED_WITHIN_MS = 30_000;

async function announcedRequest(log: ActivityLog, project: string, called: { readonly harness?: string | undefined; readonly tool: string } | undefined): Promise<Line[]> {
  const harness = called?.harness;
  if (harness === undefined || watchedHarness(harness)?.callIds !== false) return [];
  const since = new Date(Date.now() - ANNOUNCED_WITHIN_MS).toISOString();
  return log.lines(project, { kinds: ["tool-requested"], where: { harness, tool: called!.tool }, since, newest: 1, omit: ["transcript"] });
}
