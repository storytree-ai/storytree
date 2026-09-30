// Browser-safe readings of activity lines. These functions never read settings or files.
// Node callers supply the configured idle duration; a browser caller that omits quietMs keeps
// the 30-minute default until its bridge supplies the setting.
import type { Line } from "./activity/index.js";
export type { Agent, Line, LineKind, LinesSince, NewLine } from "./activity/index.js";

/**
 * The quiet time after which a session whose lines have stopped reads as waiting, when its hooks
 * report no turns (hooks not running, or installed before ADR-0754 D5): 30 minutes to start with.
 * A session whose hooks report its turns is never judged by it.
 */
export const QUIET_MS = 30 * 60 * 1000;

/** The kinds of line that decide whether a session has a command running. */
export const COMMAND_KINDS = ["command-started", "command-run", "turn-ended", "session-started", "session-ended"] as const;

/**
 * The longest a started command keeps its session live without finishing: 12 hours. Past it, the
 * command is taken to have died with its window, as when a window crashes mid-command.
 */
export const LONGEST_COMMAND_MS = 12 * 60 * 60 * 1000;

/**
 * Claude Code's own limit on a shell command it waits for: 10 minutes, unless BASH_MAX_TIMEOUT_MS
 * sets another, which its hook then records on the command's line. Claude Code ends the command by
 * then, so one with no finish line past it was cut off with its turn (an interrupt or an API error
 * writes neither the finish nor the turn's end), never still running.
 */
export const CLAUDE_CODE_COMMAND_MS = 10 * 60 * 1000;

/**
 * Working from a prompt until its turn ends, or while a command it started runs; waiting otherwise
 * (ADR-0754 D5). Ended once its end line arrives; gone when no line has come for longer than a
 * command may run (LONGEST_COMMAND_MS) and none said it ended: it stopped reporting, as a window
 * that crashed does, which is never read as an end.
 */
export type SessionState = "working" | "waiting" | "ended" | "gone";

/**
 * How long a session with no open work stays listed once quiet, counted from its last line or
 * from when its work resolved, whichever is later: 1 hour (ADR-0754 D4, ADR-0758 D5). Node readers
 * pass the user's leave-after setting.
 */
export const LEAVE_MS = 60 * 60 * 1000;

/**
 * Whether the running-sessions list shows a session (ADR-0754 D4): listed; done (shown dimmed: a
 * session the Claude or Codex app keeps, whose work has resolved and which has ended or been quiet
 * past the leave-after time, until it is archived there); or hidden.
 */
export type Listing = "listed" | "done" | "hidden";

/**
 * A session's close-out (ADR-0758 D2, D3), standing until a prompt puts it back to work: what it said,
 * and whether the reading bore a "yes" out. A yes is verified when every branch it worked on has
 * resolved, none of its own runs still ran on its machine as the close-out counted them, and it left
 * no background task running; otherwise it needs you, naming the disagreement. A no needs you with
 * its why.
 */
export interface CloseOut {
  safe: boolean;
  why: string;
  /** When it closed out. */
  at: string;
  verified: boolean;
  /** Why the owner should look, when the close-out is not verified. */
  needsYou?: string;
}

/** The apps that keep their own record of sessions, and can archive them. */
export type SessionApp = "claude-desktop" | "codex";

/** Branches that are a project's main line, never a session's own work. */
const MAIN_BRANCHES = new Set(["main", "master"]);

/** One agent window, as the activity log shows it. */
export interface Session {
  /** The harness's own id for the session. */
  session: string;
  /** Which harness it runs in, as the harness names itself: `claude-code`, `codex`, … */
  harness?: string;
  /** The harness as people call it: "Claude Code", "Codex". */
  label: string;
  /** The folder it started in: its start line's, or else its first line's. */
  folder?: string;
  /** Every folder its lines name, in the order it first worked in each: one session may work in many worktrees (ADR-0749 D2). */
  worktrees: string[];
  /** When its first line was written. */
  startedAt: string;
  /** When its latest line was written. */
  lastSeenAt: string;
  state: SessionState;
  /** False while no hook of this session has written a line: it is flagged "hooks not running". */
  hooksRunning: boolean;
  /** Every branch other than the main line its lines name, in the order it first worked on each (ADR-0754 D4). */
  branches: string[];
  /** Those of its branches that still hold open work: not merged, still ahead of the main line, and not deleted. */
  openWork: string[];
  /** The app that keeps this session in its own record, when one does. */
  app?: SessionApp;
  /** Whether that app has it archived. */
  archived: boolean;
  /** The title that app shows for it (4.19), when it gives one. */
  title?: string;
  /** Its latest status as that app sums it up (4.19), when it gives one. */
  status?: string;
  /** Its close-out, while it stands (ADR-0758). */
  closeOut?: CloseOut;
  /** Whether the running-sessions list shows it. */
  listing: Listing;
}

export interface SessionOptions {
  /** The time to judge by. By default, now. */
  readonly now?: Date;
  /** How long a session whose hooks report no turns may be quiet before it reads as waiting. By default, QUIET_MS in browser readings; the per-user setting in Node readers. */
  readonly quietMs?: number;
  /** How long a session with no open work stays listed once quiet. By default, LEAVE_MS in browser readings; the per-user leave-after setting in Node readers. */
  readonly leaveMs?: number;
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
  const leaveMs = options.leaveMs ?? LEAVE_MS;
  const bySession = new Map<string, Line[]>();
  // What lines written by other sessions say about a branch, and about a session the apps keep: the latest of each.
  // A claim's merge resolves its branch as a branch-state line does, until a later look says otherwise.
  const branchStates = new Map<string, { open: boolean; at: string }>();
  const appRecords = new Map<string, Line & { kind: "session-archived" | "session-unarchived" }>();
  const appWords = new Map<string, Line & { kind: "session-described" }>();
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    const own = bySession.get(line.session);
    if (own === undefined) bySession.set(line.session, [line]);
    else own.push(line);
    if (line.kind === "branch-state") branchStates.set(line.of, line);
    else if (line.kind === "merged") branchStates.set(line.branch, { open: false, at: line.at });
    else if (line.kind === "session-archived" || line.kind === "session-unarchived") appRecords.set(line.of, line);
    else if (line.kind === "session-described") appWords.set(line.of, line);
  }
  return [...bySession.entries()].map(([session, own]) => {
    const first = own[0]!;
    const latest = own.at(-1)!;
    const harness = own.find((line) => line.harness !== undefined)?.harness;
    const folder = (own.find((line) => line.kind === "session-started" && line.folder !== undefined) ?? own.find((line) => line.folder !== undefined))?.folder;
    const worktrees = [...new Set(own.flatMap((line) => (line.folder === undefined ? [] : [line.folder])))];
    const state: SessionState = latest.kind === "session-ended" ? "ended"
      : now - Date.parse(latest.at) > LONGEST_COMMAND_MS ? "gone" : (turnState(own, now) ?? (isQuiet(own, now, quietMs) ? "waiting" : "working"));
    // A merged line names the claim's branch, not its writer's.
    const branches = [...new Set(own.flatMap((line) => (line.branch === undefined || line.kind === "merged" || MAIN_BRANCHES.has(line.branch) ? [] : [line.branch])))];
    const openWork = branches.filter((branch) => branchStates.get(branch)?.open !== false);
    const record = appRecords.get(session);
    const archived = record?.kind === "session-archived";
    const settledSince = Math.max(Date.parse(latest.at), ...branches.map((branch) => Date.parse(branchStates.get(branch)?.at ?? latest.at)));
    const settled = state === "ended" || now - settledSince > leaveMs;
    const closeOut = closeOutOf(own, openWork);
    // A verified close-out leaves at once; one that needs you stays, whatever else says (ADR-0758 D3).
    const listing: Listing = closeOut !== undefined ? (closeOut.verified ? "hidden" : "listed")
      : openWork.length > 0 ? "listed"
      : record !== undefined ? (archived ? "hidden" : settled ? "done" : "listed")
      : settled ? "hidden" : "listed";
    return {
      session,
      ...(harness === undefined ? {} : { harness }),
      label: labelOf(harness),
      ...(folder === undefined ? {} : { folder }),
      worktrees,
      startedAt: first.at,
      lastSeenAt: latest.at,
      state,
      hooksRunning: own.some((line) => line.source === "hook"),
      branches,
      openWork,
      ...(record === undefined ? {} : { app: record.app }),
      archived,
      ...(appWords.get(session)?.title === undefined ? {} : { title: appWords.get(session)!.title! }),
      ...(appWords.get(session)?.status === undefined ? {} : { status: appWords.get(session)!.status! }),
      ...(closeOut === undefined ? {} : { closeOut }),
      listing,
    };
  });
}

/** A session's standing close-out, by its own lines `own` (oldest first) and its branches still open. */
function closeOutOf(own: readonly Line[], openWork: readonly string[]): CloseOut | undefined {
  const index = own.findLastIndex((line) => line.kind === "closed-out");
  const line = own[index];
  if (line?.kind !== "closed-out") return undefined;
  const since = own.slice(index + 1);
  if (since.some((later) => later.kind === "prompt-submitted" || (later.kind === "session-started" && later.how !== "compact"))) return undefined;
  const said = { safe: line.safe, why: line.why, at: line.at };
  if (!line.safe) return { ...said, verified: false, needsYou: line.why };
  const turn = own.findLast((later) => later.kind === "turn-ended");
  const disagreements = [
    ...(openWork.length === 0 ? [] : [`${openWork.join(", ")} ${openWork.length === 1 ? "is" : "are"} unmerged`]),
    ...(line.running === undefined ? ["its own runs could not be counted"]
      : line.running === 0 ? [] : [`${line.running} run${line.running === 1 ? "" : "s"} of its own still ${line.running === 1 ? "runs" : "run"}`]),
    ...(turn?.kind === "turn-ended" && turn.seq > line.seq && (turn.background ?? 0) > 0 ? ["a background task still runs"] : []),
  ];
  return disagreements.length === 0 ? { ...said, verified: true } : { ...said, verified: false, needsYou: `says safe, but ${disagreements.join("; ")}` };
}

/**
 * Whether a session, by its own lines `own` (oldest first), is working or waiting at `now` by its
 * turns (ADR-0754 D5): working from a prompt until its turn ends, or while a command it started
 * runs. A restart ends a turn its window never finished; compacting mid-turn does not. Undefined
 * when its hooks have reported no prompt, so its turns are unknown.
 */
export function turnState(own: readonly Line[], now: number): "working" | "waiting" | undefined {
  let prompted = false;
  let inTurn = false;
  for (const line of own) {
    if (line.kind === "prompt-submitted") prompted = inTurn = true;
    else if (line.kind === "turn-ended" || line.kind === "session-ended" || (line.kind === "session-started" && line.how !== "compact")) inTurn = false;
  }
  if (!prompted) return undefined;
  return inTurn || commandRunning(own, now) ? "working" : "waiting";
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
 * started, has no finish line under its call's id, was not closed since by the end of
 * its turn (unless that turn left background tasks running) or of its session, or by a restart,
 * and is within its harness's limit on a command (CLAUDE_CODE_COMMAND_MS, else LONGEST_COMMAND_MS;
 * LONGEST_COMMAND_MS for one its turn left running in the background). The finish line may be written before the start line
 * (each is written by its own hook process), so a finish anywhere closes it.
 */
export function commandRunning(own: readonly Line[], now: number): boolean {
  const finished = new Set(own.flatMap((line) => (line.kind === "command-run" && line.call !== undefined ? [line.call] : [])));
  let running: { startedAt: number; until: number }[] = []; // each running command, and when its limit passes
  for (const line of own) {
    if (line.kind === "command-started" && !finished.has(line.call)) {
      const startedAt = Date.parse(line.at);
      running.push({ startedAt, until: startedAt + (line.limitMs ?? (line.harness === "claude-code" ? CLAUDE_CODE_COMMAND_MS : LONGEST_COMMAND_MS)) });
    } else if (line.kind === "turn-ended" && line.background !== undefined && line.background > 0) {
      // Left running in the background, a command is past its harness's limit on one it waits for.
      running = running.map(({ startedAt }) => ({ startedAt, until: startedAt + LONGEST_COMMAND_MS }));
    } else if (line.kind === "turn-ended" || line.kind === "session-started" || line.kind === "session-ended") running = [];
  }
  return running.some(({ until }) => now <= until);
}

/** A capability, or an increment (ADR-0643 D1), held by a session, as the log shows it. */
export type Claim = ClaimOn & ({ capability: string; increment?: undefined } | { increment: string; capability?: undefined });

/** What every claim shows, whatever it holds. */
interface ClaimOn {
  /** The holding session. */
  session: string;
  harness?: string;
  /** The holding session's harness as people call it: "Claude Code", "Codex". */
  label: string;
  reason: string;
  /** When it was claimed. */
  since: string;
  /** The git branch it was claimed on, when its session's folder was on one: a pull request from it merging ends the claim (ADR-0643 D3). */
  branch?: string;
  /** Whether the holding session is live, or idle past the quiet time (and so can be taken over). */
  holder: "live" | "idle";
}

/** An edit or command, and the capability and the increment it counts toward: both undefined for unplanned activity. */
export interface Attributed {
  line: Line;
  capability: string | undefined;
  increment: string | undefined;
}

export interface ClaimsOptions {
  /** The time to judge holders' liveness by. By default, now. */
  readonly now?: Date;
  /** How long a holder may be quiet before it reads as idle. By default, QUIET_MS in browser readings; the per-user setting in Node readers. */
  readonly quietMs?: number;
}

/** The kinds of line that decide who holds what. */
export const CLAIM_KINDS = ["claimed", "released", "landed", "closed", "merged", "session-ended"] as const;

/** Who holds what, as `lines` show it, each holder judged live or idle at `options.now`. In the order they were claimed. */
export function claimsFrom(lines: readonly Line[], options: ClaimsOptions = {}): Claim[] {
  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  const lastSeen = new Map<string, string>();
  for (const line of ordered) lastSeen.set(line.session, line.at);
  const claimLines = ordered.filter((line) => (CLAIM_KINDS as readonly string[]).includes(line.kind));
  const now = (options.now ?? new Date()).getTime();
  return [...held(claimLines, lastSeen, runningIn(ordered, now), now, options.quietMs ?? QUIET_MS).values()];
}

/** The current holder of one capability or increment, or undefined when nobody holds it. */
export function claimFrom(lines: readonly Line[], id: string, options: ClaimsOptions = {}): Claim | undefined {
  return claimsFrom(lines, options).find((claim) => idOf(claim) === id);
}

/**
 * Every edit and command in `lines`, with the capability and the increment it counts toward, each
 * the one its session claimed most recently of those it still holds; both undefined for unplanned
 * activity.
 */
export function attributeFrom(lines: readonly Line[]): Attributed[] {
  const holding = new Map<string, Part[]>(); // session → what it holds, in the order claimed
  const drop = (session: string, id: string) => {
    const held = holding.get(session);
    if (held !== undefined) holding.set(session, held.filter((other) => idOf(other) !== id));
  };
  const attributed: Attributed[] = [];
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    switch (line.kind) {
      case "claimed":
        for (const session of holding.keys()) drop(session, idOf(line)); // taken over, if it was held
        holding.set(line.session, [...(holding.get(line.session) ?? []), partOf(line)]);
        break;
      case "released":
      case "landed":
        drop(line.session, idOf(line));
        break;
      case "merged":
        drop(line.holder, idOf(line));
        break;
      case "closed":
        for (const session of holding.keys()) drop(session, line.increment);
        break;
      case "session-ended":
        holding.delete(line.session);
        break;
      case "file-edited":
      case "command-run": {
        const held = holding.get(line.session) ?? [];
        const capability = held.findLast((part) => part.capability !== undefined)?.capability;
        const increment = held.findLast((part) => part.increment !== undefined)?.increment;
        attributed.push({ line, capability, increment });
        break;
      }
    }
  }
  return attributed;
}

/** The sessions with a command still running at `now`, as `lines` (oldest first) show them. */
export function runningIn(lines: readonly Line[], now: number): Set<string> {
  const bySession = new Map<string, Line[]>();
  for (const line of lines) bySession.set(line.session, [...(bySession.get(line.session) ?? []), line]);
  return new Set([...bySession].filter(([, own]) => commandRunning(own, now)).map(([session]) => session));
}

/** The claims standing after `claimLines`, by what they are on, each holder judged by when its session last wrote and whether a command of its is running. */
export function held(claimLines: readonly Line[], lastSeen: ReadonlyMap<string, string>, running: ReadonlySet<string>, now: number, quietMs: number): Map<string, Claim> {
  const holders = new Map<string, Omit<Claim, "holder">>();
  for (const line of claimLines) {
    switch (line.kind) {
      case "claimed":
        holders.set(idOf(line), claimOf(line.session, line.harness, partOf(line), line.reason, line.at, line.branch));
        break;
      case "released":
      case "landed":
        if (holders.get(idOf(line))?.session === line.session) holders.delete(idOf(line));
        break;
      case "merged":
        if (holders.get(idOf(line))?.session === line.holder) holders.delete(idOf(line));
        break;
      case "closed":
        holders.delete(line.increment);
        break;
      case "session-ended":
        for (const [id, holder] of holders) if (holder.session === line.session) holders.delete(id);
        break;
    }
  }
  const claims = new Map<string, Claim>();
  for (const [id, holder] of holders) {
    const quiet = now - Date.parse(lastSeen.get(holder.session) ?? holder.since);
    claims.set(id, { ...holder, holder: quiet > quietMs && !running.has(holder.session) ? "idle" : "live" } as Claim);
  }
  return claims;
}

export function claimOf(session: string, harness: string | undefined, part: Part, reason: string, since: string, branch: string | undefined): Omit<Claim, "holder"> {
  return { ...part, session, ...(harness === undefined ? {} : { harness }), label: labelOf(harness), reason, since, ...(branch === undefined ? {} : { branch }) } as Omit<Claim, "holder">;
}

/** What a claim is on: a capability or an increment. */
export type Part = { capability: string; increment?: undefined } | { increment: string; capability?: undefined };

/** What a claim line or a claim is on. */
export function partOf(of: { capability?: string | undefined; increment?: string | undefined }): Part {
  return of.increment !== undefined ? { increment: of.increment } : { capability: of.capability ?? "" };
}

/** The id of what a claim line or a claim is on. */
function idOf(of: { capability?: string | undefined; increment?: string | undefined }): string {
  return of.increment ?? of.capability ?? "";
}
