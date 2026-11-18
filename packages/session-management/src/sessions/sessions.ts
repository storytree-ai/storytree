// Capability 4 · Sessions
import type { ActivityLog } from "../activity/index.js";
import type { Line } from "@storytree/library";
import { holdersOf, LogFold, LONGEST_COMMAND_MS, sessionsFrom, type Session, type SessionOptions } from "../readings.js";
import { idleAfterMs, leaveAfterMs } from "@storytree/project-and-caller";

export { closeOut } from "./close-out.js";
export { nameRefusal, nameSession, SESSION_NAME_LIMIT } from "./name.js";
export type { CloseOutContext, CloseOutOptions } from "./close-out.js";

export { labelOf, LEAVE_MS, LONGEST_COMMAND_MS, QUIET_MS, sessionsFrom } from "../readings.js";
export type { CloseOut, Listing, RunningCommand, Session, SessionApp, SessionOptions, SessionState } from "../readings.js";

export interface ReadSessionsOptions extends SessionOptions {
  readonly of?: "all" | "in-view" | readonly string[];
}

const COMMANDS_MS = LONGEST_COMMAND_MS + 60_000;

export async function readSessions(log: ActivityLog, project: string, options: ReadSessionsOptions = {}): Promise<Session[]> {
  const now = options.now ?? new Date();
  const quietMs = options.quietMs ?? idleAfterMs();
  const leaveMs = options.leaveMs ?? leaveAfterMs();
  const claimLines = await log.standing(project);
  const holders = holdersOf(claimLines);
  const of = options.of ?? "all";
  const sessions = Array.isArray(of) ? (of as readonly string[])
    : of === "all" ? await log.sessionsInView(project, new Date(0).toISOString())
    : [...new Set([...await log.sessionsInView(project, new Date(now.getTime() - Math.max(leaveMs, LONGEST_COMMAND_MS)).toISOString()), ...holders])];
  const standing = LogFold.fromBounded(await log.foldLines(project, sessions, new Date(now.getTime() - COMMANDS_MS).toISOString()), claimLines);
  return standing.sessions({ now, quietMs, leaveMs });
}

export async function readSessionStates(log: ActivityLog, project: string, options: SessionOptions = {}): Promise<Pick<Session, "session" | "harness" | "state">[]> {
  const now = options.now ?? new Date();
  const lines = await log.stateLines(project, new Date(now.getTime() - LONGEST_COMMAND_MS).toISOString(), new Date(now.getTime() - COMMANDS_MS).toISOString());
  return sessionsFrom(lines, { ...options, now, quietMs: options.quietMs ?? idleAfterMs(), leaveMs: options.leaveMs ?? leaveAfterMs() }).map(({ session, harness, state }) => ({ session, ...(harness === undefined ? {} : { harness }), state }));
}
