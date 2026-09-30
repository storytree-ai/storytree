/**
 * Capability 4 · Sessions (the agent link story): the agent activity log read as a list of agent
 * sessions, one per Claude Code or Codex window. Nothing asks an agent whether it is still there:
 * a session's state is worked out from its lines.
 *
 * - A session is its lines under one harness session id. A resumed window keeps its id, so it
 *   continues the same session.
 * - Its state comes from its turns (ADR-0754 D5): working from a prompt until its turn ends, or while
 *   a command it started runs, waiting otherwise; ended if its latest line is its end line. A
 *   session whose hooks report no turns (no prompt line) reads as waiting once the quiet time has
 *   passed since its latest line, working otherwise.
 * - A shell command writes one line when it starts and one when it finishes, so a session whose
 *   command is still running is working, however long the command takes (ADR-0636 D2). A command
 *   the harness refused never finishes: the end of its turn closes it, unless the turn left
 *   background tasks running, as a restart or an end line
 *   does, and one started longer ago than LONGEST_COMMAND_MS is taken to have died with its window.
 * - Who is listed (ADR-0754 D4): a session whose branches still hold open work stays listed, whatever
 *   its end line, archive or silence says. Otherwise a session the Claude or Codex app keeps shows
 *   as done once it has ended or been quiet past the leave-after time, until it is archived there;
 *   any other session leaves then. The quiet time counts from its last line or from when its work
 *   resolved, whichever is later.
 * - It is flagged "hooks not running" (`hooksRunning: false`) until a line from one of its hooks
 *   arrives: a session seen only through its tool calls is not an agent doing nothing.
 */
import type { ActivityLog, Line } from "../activity/index.js";
import { sessionsFrom as readLines, type Session, type SessionOptions } from "../readings.js";
import { idleAfterMs, leaveAfterMs } from "../settings/settings.js";

export { closeOut } from "./close-out.js";
export type { CloseOutContext, CloseOutOptions } from "./close-out.js";

export { COMMAND_KINDS, commandRunning, isQuiet, labelOf, LEAVE_MS, LONGEST_COMMAND_MS, QUIET_MS, turnState } from "../readings.js";
export type { CloseOut, Listing, RunningCommand, Session, SessionApp, SessionOptions, SessionState } from "../readings.js";

/** Read sessions with the current per-user idle-after and leave-after durations, unless the caller supplies them. */
export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  return readLines(lines, { ...options, quietMs: options.quietMs ?? idleAfterMs(), leaveMs: options.leaveMs ?? leaveAfterMs() });
}

/** The sessions in `project`'s log, in the order they started, each judged at `options.now`. */
export async function readSessions(log: ActivityLog, project: string, options: SessionOptions = {}): Promise<Session[]> {
  const { lines } = await log.since(project, 0);
  return sessionsFrom(lines, options);
}
