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
 * - Work on main (ADR-0906): a session with uncommitted changes it edited on the main line, or an
 *   increment it claimed there, stays listed, flagged as worked outside a workspace, or, before
 *   its repository's first commit, labelled as setting up git.
 * - It is flagged "hooks not running" (`hooksRunning: false`) until a line from one of its hooks
 *   arrives: a session seen only through its tool calls is not an agent doing nothing.
 * - It is read from the few lines that decide it (contract 2.7), never from the whole log: a reader
 *   of the list reads only the sessions the list may show, and the claims standing, so what it takes
 *   from the store does not grow with the project's history.
 */
import type { ActivityLog, Line } from "../activity/index.js";
import { held, LogFold, LONGEST_COMMAND_MS, sessionsFrom as readLines, type Session, type SessionOptions } from "../readings.js";
import { idleAfterMs, leaveAfterMs } from "../settings/settings.js";

export { closeOut } from "./close-out.js";
export { nameRefusal, nameSession, SESSION_NAME_LIMIT } from "./name.js";
export type { CloseOutContext, CloseOutOptions } from "./close-out.js";

export { COMMAND_KINDS, commandRunning, isQuiet, labelOf, LEAVE_MS, LONGEST_COMMAND_MS, ON_MAIN_LABELS, QUIET_MS, turnState } from "../readings.js";
export type { CloseOut, Listing, OnMain, RunningCommand, Session, SessionApp, SessionOptions, SessionState } from "../readings.js";

/** Read sessions with the current per-user idle-after and leave-after durations, unless the caller supplies them. */
export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  return readLines(lines, { ...options, quietMs: options.quietMs ?? idleAfterMs(), leaveMs: options.leaveMs ?? leaveAfterMs() });
}

export interface ReadSessionsOptions extends SessionOptions {
  /**
   * Which sessions: every one (the default); only those the running-sessions list may show at
   * `now`, which are all a reader of the list needs; or those named.
   */
  readonly of?: "all" | "in-view" | readonly string[];
}

/** How far back a session's unfinished commands are read: a command started earlier is past any limit, with a minute's margin. */
const COMMANDS_MS = LONGEST_COMMAND_MS + 60_000;

/**
 * The sessions in `project`'s log, in the order they started, each judged at `options.now`: read
 * from the lines that decide them and the claims standing, as a fold of the whole log reads them.
 */
export async function readSessions(log: ActivityLog, project: string, options: ReadSessionsOptions = {}): Promise<Session[]> {
  const now = options.now ?? new Date();
  const quietMs = options.quietMs ?? idleAfterMs();
  const leaveMs = options.leaveMs ?? leaveAfterMs();
  const claimLines = await log.standing(project);
  const holders = [...held(claimLines, new Map(), new Set(), now.getTime(), Infinity)];
  const of = options.of ?? "all";
  const sessions = Array.isArray(of) ? (of as readonly string[])
    : of === "all" ? await log.sessionsInView(project, new Date(0).toISOString())
    : [...new Set([...await log.sessionsInView(project, new Date(now.getTime() - Math.max(leaveMs, LONGEST_COMMAND_MS)).toISOString()), ...holders.map(([, claim]) => claim.session)])];
  const standing = LogFold.fromBounded(await log.foldLines(project, sessions, new Date(now.getTime() - COMMANDS_MS).toISOString()), claimLines);
  return standing.sessions({ now, quietMs, leaveMs });
}

/** The state of each session that wrote in the last LONGEST_COMMAND_MS, from the lines that decide it alone: the rest of each session is not read. */
export async function readSessionStates(log: ActivityLog, project: string, options: SessionOptions = {}): Promise<Pick<Session, "session" | "harness" | "state">[]> {
  const now = options.now ?? new Date();
  const lines = await log.stateLines(project, new Date(now.getTime() - LONGEST_COMMAND_MS).toISOString(), new Date(now.getTime() - COMMANDS_MS).toISOString());
  return sessionsFrom(lines, { ...options, now }).map(({ session, harness, state }) => ({ session, ...(harness === undefined ? {} : { harness }), state }));
}
