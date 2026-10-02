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
 * A session's close-out (ADR-0758 D2, D3), standing until a prompt or new claim puts it back to work: what it said,
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

/** A command a session started and has not seen finish: its text, and when it started. */
export interface RunningCommand {
  command: string;
  /** When its start line was written. */
  since: string;
}

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
  /**
   * Each branch its lines recorded in a folder, with whether it still holds open work (contract 4.22), in the
   * order first recorded. A line naming a branch but no folder counts in the folder the session last worked in.
   * The main line is no branch. A branch recorded with no folder at all, and none to place it in, has none.
   * An open branch whose pull request a look has read carries it (contract 4.24).
   */
  branchesByFolder: BranchInFolder[];
  /** The commands it started and has not seen finish, oldest first (contract 4.23): the commands that keep it working. */
  running: RunningCommand[];
  /** The app that keeps this session in its own record, when one does. */
  app?: SessionApp;
  /** Whether that app has it archived. */
  archived: boolean;
  /** The title that app shows for it (4.19), when it gives one. */
  title?: string;
  /** The name it gave itself, its latest (contract 6.32), when it has given one. */
  name?: string;
  /** Its latest status as that app sums it up (4.19), when it gives one. */
  status?: string;
  /** Its close-out, while it stands (ADR-0758). */
  closeOut?: CloseOut;
  /** Whether the running-sessions list shows it. */
  listing: Listing;
}

/** A branch a session recorded in a folder (contract 4.22), and its open pull request once a look has read it (4.24). */
export interface BranchInFolder {
  folder?: string;
  branch: string;
  open: boolean;
  pr?: PullState;
}

/** An open pull request as the latest look found it (contract 4.24): its checks are absent when it has none. */
export interface PullState {
  number: number;
  draft: boolean;
  checks?: "pending" | "passing" | "failing";
  /** Whether it waits in the merge queue. */
  queued: boolean;
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

/** The kinds of line whose writer only looked at others' work: a claim's merge, a branch's state, what an app keeps. */
const ABOUT_OTHERS: ReadonlySet<Line["kind"]> = new Set(["merged", "branch-state", "session-archived", "session-unarchived", "session-described"]);

/** The sessions `lines` show, in the order they started, each judged at `options.now`. */
export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  const fold = new LogFold();
  fold.add(lines);
  return fold.sessions(options);
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
  return commandsRunning(own, now).length > 0;
}

/** A command still running: what it was, when it started, and when its limit passes. */
interface CommandRunning extends RunningCommand {
  until: number;
}

/** The commands `commandRunning` counts, each with its text and when it started, oldest first: the same reading, not a second one. */
function commandsRunning(own: readonly Line[], now: number): CommandRunning[] {
  const finished = new Set(own.flatMap((line) => (line.kind === "command-run" && line.call !== undefined ? [line.call] : [])));
  let running: CommandRunning[] = []; // each running command, and when its limit passes
  for (const line of own) {
    if (line.kind === "command-started" && !finished.has(line.call)) {
      const startedAt = Date.parse(line.at);
      running.push({ command: line.command, since: line.at, until: startedAt + (line.limitMs ?? (line.harness === "claude-code" ? CLAUDE_CODE_COMMAND_MS : LONGEST_COMMAND_MS)) });
    } else if (line.kind === "turn-ended" && line.background !== undefined && line.background > 0) {
      // Left running in the background, a command is past its harness's limit on one it waits for.
      running = running.map((one) => ({ ...one, until: Date.parse(one.since) + LONGEST_COMMAND_MS }));
    } else if (line.kind === "turn-ended" || line.kind === "session-started" || line.kind === "session-ended") running = [];
  }
  return running.filter(({ until }) => now <= until);
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
  /**
   * A machine, and when it last started: a holder whose lines name that machine and were last
   * written before then died with it, so it reads idle at once, whatever its quiet time.
   */
  readonly restarted?: Restart;
}

/** A machine, by the name lines record, and when it last started. */
export interface Restart {
  readonly machine: string;
  readonly at: Date;
}

/** Whether a session last seen at `lastSeen` on `machine` died in `restarted`. */
function diedIn(restarted: Restart | undefined, machine: string | undefined, lastSeen: string): boolean {
  return restarted !== undefined && machine === restarted.machine && Date.parse(lastSeen) < restarted.at.getTime();
}

/** The kinds of line that decide who holds what. */
export const CLAIM_KINDS = ["claimed", "released", "landed", "closed", "merged", "session-ended"] as const;

/** Who holds what, as `lines` show it, each holder judged live or idle at `options.now`. In the order they were claimed. */
export function claimsFrom(lines: readonly Line[], options: ClaimsOptions = {}): Claim[] {
  const fold = new LogFold();
  fold.add(lines);
  return fold.claims(options);
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
export function held(claimLines: readonly Line[], lastSeen: ReadonlyMap<string, string>, running: ReadonlySet<string>, now: number, quietMs: number, restarted?: Restart): Map<string, Claim> {
  const holders = new Map<string, Omit<Claim, "holder">>();
  const machines = new Map<string, string>();
  for (const line of claimLines) {
    holding(holders, line);
    if (line.machine !== undefined) machines.set(line.session, line.machine);
  }
  const claims = new Map<string, Claim>();
  for (const [id, holder] of holders) {
    const seen = lastSeen.get(holder.session) ?? holder.since;
    const idle = (now - Date.parse(seen) > quietMs && !running.has(holder.session)) || diedIn(restarted, machines.get(holder.session), seen);
    claims.set(id, { ...holder, holder: idle ? "idle" : "live" } as Claim);
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

/** What a session's own lines (oldest first) have said so far: everything sessionsFrom reads, without the lines. */
interface SessionFold {
  session: string;
  firstAt: string;
  latest: { kind: Line["kind"]; at: string };
  harness?: string;
  /** The folder of its first start line that names one, and of its first line that names one. */
  startedIn?: string;
  firstFolder?: string;
  worktrees: Set<string>;
  hooksRunning: boolean;
  branches: Set<string>;
  /** The folder its latest line naming one named, and each branch it recorded in a folder, once, by folder and branch. */
  folder?: string;
  placed: Map<string, { folder?: string; branch: string }>;
  prompted: boolean;
  inTurn: boolean;
  /** Its commands started and not seen finish, by call, in the order started; and finishes no running command took. */
  running: Map<string, CommandRunning>;
  finished: Set<string>;
  closedOut?: { line: Line & { kind: "closed-out" }; reopened: boolean };
  name?: string;
  lastTurnEnded?: { seq: number; background: number };
}

/** What a branch's state lines have said of it last: open or not, and its open pull request once a look has read it. */
type BranchState = { open: boolean; at: string; pr?: number | undefined; draft?: true | undefined; checks?: PullState["checks"] | undefined; queued?: true | undefined };

/**
 * A fold written out as plain data, its sets and maps as arrays, so a page can keep it between starts
 * and start again from it rather than from every line (ADR-0836 D4). Nothing in it is shared with
 * the fold it came from.
 */
export interface LogFoldSnapshot {
  sessions: (Omit<SessionFold, "worktrees" | "branches" | "placed" | "running" | "finished"> & {
    worktrees: string[];
    branches: string[];
    placed: [string, { folder?: string; branch: string }][];
    running: [string, CommandRunning][];
    finished: string[];
  })[];
  lastSeen: [string, string][];
  branchStates: [string, BranchState][];
  appRecords: [string, Line & { kind: "session-archived" | "session-unarchived" }][];
  appWords: [string, Line & { kind: "session-described" }][];
  holders: [string, Omit<Claim, "holder">][];
  machines: [string, string][];
}

/**
 * The sessions and claims reading, folded as the log's lines arrive (ADR-0836 D1, D4): it keeps what
 * each session's lines have said, the claims standing, and the latest that others' lines say about a
 * branch and about a session the apps keep, never the lines themselves. The time is applied only
 * when it is read, so it reads the same as sessionsFrom and claimsFrom over every line it was fed.
 * Feed it the log's lines in order, each once: each piece is put in order, and pieces are taken as they come.
 */
export class LogFold {
  #sessions = new Map<string, SessionFold>();
  /** When each session, about others' work or its own, last wrote. */
  #lastSeen = new Map<string, string>();
  #branchStates = new Map<string, BranchState>();
  #appRecords = new Map<string, Line & { kind: "session-archived" | "session-unarchived" }>();
  #appWords = new Map<string, Line & { kind: "session-described" }>();
  #holders = new Map<string, Omit<Claim, "holder">>();
  #machines = new Map<string, string>();

  /** A fold that goes on from `snapshot`, as the fold it was taken from would. */
  static fromSnapshot(snapshot: LogFoldSnapshot): LogFold {
    const fold = new LogFold();
    for (const { worktrees, branches, placed, running, finished, closedOut, ...own } of snapshot.sessions) {
      fold.#sessions.set(own.session, {
        ...own,
        worktrees: new Set(worktrees),
        branches: new Set(branches),
        placed: new Map(placed),
        running: new Map(running.map(([call, one]) => [call, { ...one }])),
        finished: new Set(finished),
        ...(closedOut === undefined ? {} : { closedOut: { ...closedOut } }),
      });
    }
    fold.#lastSeen = new Map(snapshot.lastSeen);
    fold.#branchStates = new Map(snapshot.branchStates);
    fold.#appRecords = new Map(snapshot.appRecords);
    fold.#appWords = new Map(snapshot.appWords);
    fold.#holders = new Map(snapshot.holders);
    fold.#machines = new Map(snapshot.machines);
    return fold;
  }

  /** What it has folded so far, as plain data to keep (LogFoldSnapshot). */
  snapshot(): LogFoldSnapshot {
    return {
      sessions: [...this.#sessions.values()].map(({ worktrees, branches, placed, running, finished, closedOut, ...own }) => ({
        ...own,
        worktrees: [...worktrees],
        branches: [...branches],
        placed: [...placed],
        running: [...running].map(([call, one]) => [call, { ...one }]),
        finished: [...finished],
        ...(closedOut === undefined ? {} : { closedOut: { ...closedOut } }),
      })),
      lastSeen: [...this.#lastSeen],
      branchStates: [...this.#branchStates],
      appRecords: [...this.#appRecords],
      appWords: [...this.#appWords],
      holders: [...this.#holders],
      machines: [...this.#machines],
    };
  }

  /** Take what is new. */
  add(lines: readonly Line[]): void {
    for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
      this.#lastSeen.set(line.session, line.at);
      if (line.machine !== undefined) this.#machines.set(line.session, line.machine);
      if (!ABOUT_OTHERS.has(line.kind)) this.#own(line);
      if (line.kind === "branch-state") this.#branchStates.set(line.of, line);
      else if (line.kind === "merged") this.#branchStates.set(line.branch, { open: false, at: line.at });
      else if (line.kind === "session-archived" || line.kind === "session-unarchived") this.#appRecords.set(line.of, line);
      else if (line.kind === "session-described") this.#appWords.set(line.of, line);
      holding(this.#holders, line);
    }
  }

  #own(line: Line): void {
    let own = this.#sessions.get(line.session);
    if (own === undefined) {
      own = { session: line.session, firstAt: line.at, latest: line, worktrees: new Set(), hooksRunning: false, branches: new Set(), placed: new Map(),
        prompted: false, inTurn: false, running: new Map(), finished: new Set() };
      this.#sessions.set(line.session, own);
    }
    own.latest = { kind: line.kind, at: line.at };
    if (line.harness !== undefined) own.harness ??= line.harness;
    if (line.folder !== undefined) {
      own.firstFolder ??= line.folder;
      if (line.kind === "session-started") own.startedIn ??= line.folder;
      own.worktrees.add(line.folder);
      own.folder = line.folder;
    }
    if (line.source === "hook") own.hooksRunning = true;
    if (line.branch !== undefined && line.kind !== "merged" && !MAIN_BRANCHES.has(line.branch)) {
      own.branches.add(line.branch);
      const key = `${own.folder ?? ""}\u0000${line.branch}`;
      if (!own.placed.has(key)) own.placed.set(key, { ...(own.folder === undefined ? {} : { folder: own.folder }), branch: line.branch });
    }
    // Its turns (turnState), and its commands (commandsRunning).
    if (line.kind === "prompt-submitted") own.prompted = own.inTurn = true;
    else if (line.kind === "turn-ended" || line.kind === "session-ended" || (line.kind === "session-started" && line.how !== "compact")) own.inTurn = false;
    if (line.kind === "command-started") {
      if (!own.finished.has(line.call)) {
        own.running.set(line.call, { command: line.command, since: line.at,
          until: Date.parse(line.at) + (line.limitMs ?? (line.harness === "claude-code" ? CLAUDE_CODE_COMMAND_MS : LONGEST_COMMAND_MS)) });
      }
    } else if (line.kind === "command-run" && line.call !== undefined) {
      // A finish ends its command; one that came before its start ends it as it starts.
      if (!own.running.delete(line.call)) own.finished.add(line.call);
    } else if (line.kind === "turn-ended" && line.background !== undefined && line.background > 0) {
      for (const one of own.running.values()) one.until = Date.parse(one.since) + LONGEST_COMMAND_MS;
    } else if (line.kind === "turn-ended" || line.kind === "session-started" || line.kind === "session-ended") own.running.clear();
    // Its close-out, and what came after it.
    if (line.kind === "closed-out") own.closedOut = { line, reopened: false };
    else if (own.closedOut !== undefined && (line.kind === "claimed" || line.kind === "prompt-submitted" || (line.kind === "session-started" && line.how !== "compact"))) own.closedOut.reopened = true;
    if (line.kind === "session-named") own.name = line.title;
    if (line.kind === "turn-ended") own.lastTurnEnded = { seq: line.seq, background: line.background ?? 0 };
  }

  /** The sessions it has been fed, in the order they started, each judged at `options.now`. */
  sessions(options: SessionOptions = {}): Session[] {
    const now = (options.now ?? new Date()).getTime();
    const quietMs = options.quietMs ?? QUIET_MS;
    const leaveMs = options.leaveMs ?? LEAVE_MS;
    return [...this.#sessions.values()].map((own) => {
      const { session, harness, latest } = own;
      const folder = own.startedIn ?? own.firstFolder;
      const running = [...own.running.values()].filter(({ until }) => now <= until);
      const quiet = now - Date.parse(latest.at) > quietMs && running.length === 0;
      const state: SessionState = latest.kind === "session-ended" ? "ended"
        : now - Date.parse(latest.at) > LONGEST_COMMAND_MS ? "gone"
        : own.prompted ? (own.inTurn || running.length > 0 ? "working" : "waiting")
        : quiet ? "waiting" : "working";
      const branches = [...own.branches];
      const openWork = branches.filter((branch) => this.#branchStates.get(branch)?.open !== false);
      const branchesByFolder = [...own.placed.values()].map((placed): BranchInFolder => ({ ...placed, ...this.#branchState(placed.branch) }));
      const record = this.#appRecords.get(session);
      const archived = record?.kind === "session-archived";
      const settledSince = Math.max(Date.parse(latest.at), ...branches.map((branch) => Date.parse(this.#branchStates.get(branch)?.at ?? latest.at)));
      const settled = state === "ended" || now - settledSince > leaveMs;
      const closeOut = this.#closeOut(own, openWork);
      // A verified close-out leaves at once; one that needs you stays, whatever else says (ADR-0758 D3).
      const listing: Listing = closeOut !== undefined ? (closeOut.verified ? "hidden" : "listed")
        : openWork.length > 0 ? "listed"
        : record !== undefined ? (archived ? "hidden" : settled ? "done" : "listed")
        : settled ? "hidden" : "listed";
      const words = this.#appWords.get(session);
      return {
        session,
        ...(harness === undefined ? {} : { harness }),
        label: labelOf(harness),
        ...(folder === undefined ? {} : { folder }),
        worktrees: [...own.worktrees],
        startedAt: own.firstAt,
        lastSeenAt: latest.at,
        state,
        hooksRunning: own.hooksRunning,
        branches,
        openWork,
        branchesByFolder,
        running: running.map(({ command, since }) => ({ command, since })),
        ...(record === undefined ? {} : { app: record.app }),
        archived,
        ...(words?.title === undefined ? {} : { title: words.title }),
        ...(own.name === undefined ? {} : { name: own.name }),
        ...(words?.status === undefined ? {} : { status: words.status }),
        ...(closeOut === undefined ? {} : { closeOut }),
        listing,
      };
    });
  }

  /** Who holds what, each holder judged live or idle at `options.now`, in the order they were claimed. */
  claims(options: ClaimsOptions = {}): Claim[] {
    const now = (options.now ?? new Date()).getTime();
    const quietMs = options.quietMs ?? QUIET_MS;
    return [...this.#holders.values()].map((holder) => {
      const seen = this.#lastSeen.get(holder.session) ?? holder.since;
      const running = [...(this.#sessions.get(holder.session)?.running.values() ?? [])].some(({ until }) => now <= until);
      const idle = (now - Date.parse(seen) > quietMs && !running) || diedIn(options.restarted, this.#machines.get(holder.session), seen);
      return { ...holder, holder: idle ? "idle" : "live" } as Claim;
    });
  }

  /** The machine each session's latest line naming one was written on. */
  machines(): ReadonlyMap<string, string> {
    return this.#machines;
  }

  /** Whether `branch` still holds open work, with its open pull request once a look has read it. */
  #branchState(branch: string): Pick<BranchInFolder, "open" | "pr"> {
    const state = this.#branchStates.get(branch);
    if (state?.open === false) return { open: false };
    if (state?.pr === undefined) return { open: true };
    return { open: true, pr: { number: state.pr, draft: state.draft === true, ...(state.checks === undefined ? {} : { checks: state.checks }), queued: state.queued === true } };
  }

  /** A session's standing close-out, by what its lines said and its branches still open. */
  #closeOut(own: SessionFold, openWork: readonly string[]): CloseOut | undefined {
    if (own.closedOut === undefined || own.closedOut.reopened) return undefined;
    const { line } = own.closedOut;
    const said = { safe: line.safe, why: line.why, at: line.at };
    if (!line.safe) return { ...said, verified: false, needsYou: line.why };
    const turn = own.lastTurnEnded;
    const disagreements = [
      ...(openWork.length === 0 ? [] : [`${openWork.join(", ")} ${openWork.length === 1 ? "is" : "are"} unmerged`]),
      ...(line.running === undefined ? ["its own runs could not be counted"]
        : line.running === 0 ? [] : [`${line.running} run${line.running === 1 ? "" : "s"} of its own still ${line.running === 1 ? "runs" : "run"}`]),
      ...(turn !== undefined && turn.seq > line.seq && turn.background > 0 ? ["a background task still runs"] : []),
    ];
    return disagreements.length === 0 ? { ...said, verified: true } : { ...said, verified: false, needsYou: `says safe, but ${disagreements.join("; ")}` };
  }
}

/**
 * The log as a surface reads it: its sessions and claims folded, and its lines of the kinds a
 * surface reads one by one (a reading may hold only those, as the page's does).
 */
export interface LogReading {
  readonly fold: LogFold;
  readonly lines: readonly Line[];
}

/** `log` as a reading: every line of it folded, when it is the lines themselves. */
export function logReading(log: readonly Line[] | LogReading): LogReading {
  if (!Array.isArray(log)) return log as LogReading;
  const fold = new LogFold();
  fold.add(log);
  return { fold, lines: log };
}

/** Take one line into `holders`, the claims standing by what they are on. */
function holding(holders: Map<string, Omit<Claim, "holder">>, line: Line): void {
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
