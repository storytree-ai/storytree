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
 * - It is flagged "hooks not running" (`hooksRunning: false`) until a line from one of its hooks
 *   arrives: a session seen only through its tool calls is not an agent doing nothing.
 */
import type { ActivityLog, Line } from "../activity/index.js";
import { sessionsFrom as readLines, type Session, type SessionOptions } from "../readings.js";
import { idleAfterMs } from "../settings/settings.js";

export { COMMAND_KINDS, commandRunning, isQuiet, labelOf, LONGEST_COMMAND_MS, QUIET_MS, turnState } from "../readings.js";
export type { Session, SessionOptions, SessionState } from "../readings.js";

/** Read sessions with the current per-user idle-after duration, unless the caller supplies one. */
export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  return readLines(lines, { ...options, quietMs: options.quietMs ?? idleAfterMs() });
}

/** The sessions in `project`'s log, in the order they started, each judged at `options.now`. */
export async function readSessions(log: ActivityLog, project: string, options: SessionOptions = {}): Promise<Session[]> {
  const { lines } = await log.since(project, 0);
  return sessionsFrom(lines, options);
}
