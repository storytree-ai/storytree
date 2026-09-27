/**
 * Capability 4 · Sessions (the agent link story): the agent activity log read as a list of agent
 * sessions, one per Claude Code or Codex window. Nothing asks an agent whether it is still there:
 * a session's state is worked out from its lines.
 *
 * - A session is its lines under one harness session id. A resumed window keeps its id, so it
 *   continues the same session.
 * - Its state comes from its latest line and the time now: ended if that line is its end line,
 *   idle once the quiet time has passed since it, live otherwise. So it never reads as live just
 *   because nobody said otherwise.
 * - A shell command writes one line when it starts and one when it finishes, so a session whose
 *   command is still running is not idle, however long the command takes (ADR-0636 D2). A command
 *   the harness refused never finishes: the end of its turn closes it, as a restart or an end line
 *   does, and one started longer ago than LONGEST_COMMAND_MS is taken to have died with its window.
 * - It is flagged "hooks not running" (`hooksRunning: false`) until a line from one of its hooks
 *   arrives: a session seen only through its tool calls is not an agent doing nothing.
 */
import type { ActivityLog, Line } from "../activity/index.js";

/** The quiet time after which a session whose lines have stopped reads as idle: 30 minutes to start with. */
export const QUIET_MS = 30 * 60 * 1000;

/** The kinds of line that decide whether a session has a command running. */
export const COMMAND_KINDS = ["command-started", "command-run", "turn-ended", "session-started", "session-ended"] as const;

/**
 * The longest a started command keeps its session live without finishing: 12 hours. Past it, the
 * command is taken to have died with its window, as when a window crashes mid-command.
 */
export const LONGEST_COMMAND_MS = 12 * 60 * 60 * 1000;

/** Live while its lines keep arriving, idle after the quiet time, ended once its end line arrives. */
export type SessionState = "live" | "idle" | "ended";

/** One agent window, as the activity log shows it. */
export interface Session {
  /** The harness's own id for the session. */
  session: string;
  /** Which harness it runs in, as the harness names itself: `claude-code`, `codex`, … */
  harness?: string;
  /** The harness as people call it: "Claude Code", "Codex". */
  label: string;
  /** The folder it works in. */
  folder?: string;
  /** When its first line was written. */
  startedAt: string;
  /** When its latest line was written. */
  lastSeenAt: string;
  state: SessionState;
  /** False while no hook of this session has written a line: it is flagged "hooks not running". */
  hooksRunning: boolean;
}

export interface SessionOptions {
  /** The time to judge by. By default, now. */
  readonly now?: Date;
  /** How long a session may be quiet before it reads as idle. By default, QUIET_MS. */
  readonly quietMs?: number;
}

/** The harnesses people know by another name than their id. */
const LABELS: Readonly<Record<string, string>> = { "claude-code": "Claude Code", codex: "Codex" };

/** A harness as people call it: "Claude Code" for `claude-code`, "Codex" for `codex`, any other by its own id. */
export function labelOf(harness: string | undefined): string {
  return harness === undefined ? "an unnamed harness" : (LABELS[harness] ?? harness);
}

/** The sessions `lines` show, in the order they started, each judged at `options.now`. */
export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  const now = (options.now ?? new Date()).getTime();
  const quietMs = options.quietMs ?? QUIET_MS;
  const bySession = new Map<string, Line[]>();
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    const own = bySession.get(line.session);
    if (own === undefined) bySession.set(line.session, [line]);
    else own.push(line);
  }
  return [...bySession.entries()].map(([session, own]) => {
    const first = own[0]!;
    const latest = own.at(-1)!;
    const harness = own.find((line) => line.harness !== undefined)?.harness;
    const folder = (own.find((line) => line.kind === "session-started" && line.folder !== undefined) ?? own.find((line) => line.folder !== undefined))?.folder;
    const state: SessionState = latest.kind === "session-ended" ? "ended" : isQuiet(own, now, quietMs) ? "idle" : "live";
    return {
      session,
      ...(harness === undefined ? {} : { harness }),
      label: labelOf(harness),
      ...(folder === undefined ? {} : { folder }),
      startedAt: first.at,
      lastSeenAt: latest.at,
      state,
      hooksRunning: own.some((line) => line.source === "hook"),
    };
  });
}

/**
 * Whether a session, by its own lines `own` (oldest first), has been quiet for longer than `quietMs`
 * at `now`: no line in that time, and no command of its still running.
 */
export function isQuiet(own: readonly Line[], now: number, quietMs: number): boolean {
  const latest = own.at(-1);
  if (latest === undefined) return true;
  return now - Date.parse(latest.at) > quietMs && !commandRunning(own, now);
}

/**
 * Whether a session, by its own lines `own` (oldest first), has a command still running at `now`.
 * Only its command-started, command-run, turn-ended, session-started and session-ended lines count,
 * so `own` may hold just those (COMMAND_KINDS). A command is running when it
 * started, has no finish line under its call's id, and was not closed since by the end of
 * its turn or of its session, or by a restart. The finish line may be written before the start line
 * (each is written by its own hook process), so a finish anywhere closes it.
 */
export function commandRunning(own: readonly Line[], now: number): boolean {
  const finished = new Set(own.flatMap((line) => (line.kind === "command-run" && line.call !== undefined ? [line.call] : [])));
  let running: number[] = [];
  for (const line of own) {
    if (line.kind === "command-started" && !finished.has(line.call)) running.push(Date.parse(line.at));
    else if (line.kind === "turn-ended" || line.kind === "session-started" || line.kind === "session-ended") running = [];
  }
  return running.some((startedAt) => now - startedAt <= LONGEST_COMMAND_MS);
}

/** The sessions in `project`'s log, in the order they started, each judged at `options.now`. */
export async function readSessions(log: ActivityLog, project: string, options: SessionOptions = {}): Promise<Session[]> {
  const { lines } = await log.since(project, 0);
  return sessionsFrom(lines, options);
}
