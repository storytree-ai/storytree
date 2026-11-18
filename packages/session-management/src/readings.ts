// Capability 4 · Sessions
import type { Line } from "@storytree/library";
import { ENDING_KINDS, ends } from "./claims/endings.js";
import { tierOf, WATCHED_HARNESSES, type Tier } from "@storytree/project-and-caller/caller";

export const QUIET_MS = 30 * 60 * 1000;

export const LONGEST_COMMAND_MS = 12 * 60 * 60 * 1000;

export const CLAUDE_CODE_COMMAND_MS = 10 * 60 * 1000;

export type SessionState = "working" | "waiting" | "ended" | "gone";

export const LEAVE_MS = 60 * 60 * 1000;

export type Listing = "listed" | "done" | "hidden";

export interface CloseOut {
  safe: boolean;
  why: string;
  at: string;
  verified: boolean;
  needsYou?: string;
}

export type SessionApp = "claude-desktop" | "codex";

const MAIN_BRANCHES = new Set(["main", "master"]);

export function isMainBranch(branch: string): boolean {
  return MAIN_BRANCHES.has(branch);
}

export interface RunningCommand {
  command: string;
  since: string;
}

export interface Session {
  session: string;
  harness?: string;
  label: string;
  folder?: string;
  machine?: string;
  worktrees: string[];
  startedAt: string;
  lastSeenAt: string;
  state: SessionState;
  hooksRunning: boolean;
  tier: Tier;
  branches: string[];
  openWork: string[];
  branchesByFolder: BranchInFolder[];
  running: RunningCommand[];
  app?: SessionApp;
  archived: boolean;
  title?: string;
  name?: string;
  status?: string;
  pointer?: Pointer;
  closeOut?: CloseOut;
  listing: Listing;
}

export interface Pointer {
  capability: string;
  gate?: string;
  why: string;
  question?: string;
  at: string;
}

export interface BranchInFolder {
  folder?: string;
  branch: string;
  open: boolean;
  pr?: PullState;
}

export interface PullState {
  number: number;
  draft: boolean;
  checks?: "pending" | "passing" | "failing";
  queued: boolean;
  checksSince?: string;
  queuedSince?: string;
  queueWaiting?: true;
}

export interface SessionOptions {
  readonly now?: Date;
  readonly quietMs?: number;
  readonly leaveMs?: number;
}

const LABELS: Readonly<Record<string, string>> = Object.fromEntries(WATCHED_HARNESSES.map((harness) => [harness.id, harness.label]));

export function labelOf(harness: string | undefined): string {
  return harness === undefined ? "an unnamed harness" : (LABELS[harness] ?? harness);
}

const ABOUT_OTHERS: ReadonlySet<Line["kind"]> = new Set(["merged", "branch-state", "main-state", "session-archived", "session-unarchived", "session-described", "machine-started", "hook-times", "usage-measured", "turn-failed", "ci-rerun", "queue-red", "lane-failed", "lane-reoffered"]);

export function sessionsFrom(lines: readonly Line[], options: SessionOptions = {}): Session[] {
  const fold = new LogFold();
  fold.add(lines);
  return fold.sessions(options);
}

interface CommandRunning extends RunningCommand {
  until: number;
}

export type Claim = ClaimOn & ({ capability: string; increment?: undefined } | { increment: string; capability?: undefined });

interface ClaimOn {
  session: string;
  harness?: string;
  label: string;
  reason: string;
  since: string;
  branch?: string;
  holder: "live" | "idle";
  quiet?: { since: string; because: QuietBecause };
  binds?: string;
  under?: string;
}

export interface Attributed {
  line: Line;
  capability: string | undefined;
  increment: string | undefined;
}

export interface ClaimsOptions {
  readonly now?: Date;
  readonly quietMs?: number;
  readonly restarted?: Restart;
  readonly beats?: ReadonlyMap<string, Beat>;
}

export interface Beat {
  readonly at: string;
  readonly ended?: string;
  readonly lane?: true;
}

export const STOPPED_MS = 60_000;

function stoppedBy(beat: Beat | undefined, lastSeen: string, now: number, running = false): boolean {
  if (beat === undefined || (running && beat.ended === undefined)) return false;
  const last = beat.ended ?? beat.at;
  const after = Date.parse(lastSeen) > Date.parse(last) + (beat.ended === undefined ? STOPPED_MS : 0);
  return !after && (beat.ended !== undefined || now - Date.parse(beat.at) > STOPPED_MS);
}

export interface Restart {
  readonly machine: string;
  readonly at: Date;
}

export type QuietBecause = NonNullable<Extract<Line, { kind: "claimed" }>["takenBecause"]>;

function diedIn(restarted: Restart | undefined, machine: string | undefined, lastSeen: string): boolean {
  return restarted !== undefined && machine === restarted.machine && Date.parse(lastSeen) < restarted.at.getTime();
}

export function pullHolder(pr: number): string {
  return `pull-request-${pr}`;
}

export function pullOf(session: string): number | undefined {
  const pr = /^pull-request-(\d+)$/.exec(session)?.[1];
  return pr === undefined ? undefined : Number(pr);
}

export const CLAIM_KINDS = ["claimed", ...ENDING_KINDS] as const;

export function claimsFrom(lines: readonly Line[], options: ClaimsOptions = {}): Claim[] {
  const fold = new LogFold();
  fold.add(lines);
  return fold.claims(options);
}

export function claimFrom(lines: readonly Line[], id: string, options: ClaimsOptions = {}): Claim | undefined {
  return claimsFrom(lines, options).find((claim) => idOf(claim) === id);
}

export function attributeFrom(lines: readonly Line[]): Attributed[] {
  const holders = new Map<string, Omit<Claim, "holder">>();
  const attributed: Attributed[] = [];
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    holding(holders, line);
    if (line.kind !== "file-edited" && line.kind !== "command-run") continue;
    const held = [...holders.values()].filter((holder) => holder.session === line.session);
    attributed.push({ line, capability: held.findLast((part) => part.capability !== undefined)?.capability, increment: held.findLast((part) => part.increment !== undefined)?.increment });
  }
  return attributed;
}

export function standingFrom(claimLines: readonly Line[]): Map<string, Omit<Claim, "holder">> {
  const holders = new Map<string, Omit<Claim, "holder">>();
  for (const line of claimLines) holding(holders, line);
  return holders;
}

export function holdersOf(claimLines: readonly Line[]): string[] {
  return [...new Set([...standingFrom(claimLines).values()].map((holder) => holder.session))];
}

export function claimOf(session: string, harness: string | undefined, part: Part, reason: string, since: string, branch: string | undefined): Omit<Claim, "holder"> {
  return { ...part, session, ...(harness === undefined ? {} : { harness }), label: labelOf(harness), reason, since, ...(branch === undefined ? {} : { branch }) } as Omit<Claim, "holder">;
}

export type Part = { capability: string; increment?: undefined } | { increment: string; capability?: undefined };

export function partOf(of: { capability?: string | undefined; increment?: string | undefined }): Part {
  return of.increment !== undefined ? { increment: of.increment } : { capability: of.capability ?? "" };
}

function idOf(of: { capability?: string | undefined; increment?: string | undefined }): string {
  return of.increment ?? of.capability ?? "";
}

interface SessionFold {
  session: string;
  firstAt: string;
  latest: { kind: Line["kind"]; at: string; exits?: true };
  harness?: string;
  startedIn?: string;
  firstFolder?: string;
  worktrees: Set<string>;
  hooksRunning: boolean;
  branches: Set<string>;
  folder?: string;
  placed: Map<string, { folder?: string; branch: string }>;
  prompted: boolean;
  inTurn: boolean;
  running: Map<string, CommandRunning>;
  finished: Set<string>;
  backgroundUntil?: number;
  stopped?: true;
  closedOut?: { line: Line & { kind: "closed-out" }; reopened: boolean };
  name?: string;
  pointer?: Pointer;
  lastTurnEnded?: { seq: number; background: number };
}

type BranchState = { open: boolean; at: string; pr?: number | undefined; draft?: true | undefined; checks?: PullState["checks"] | undefined; queued?: true | undefined;
  checksSince?: string | undefined; queuedSince?: string | undefined; queueWaiting?: true | undefined };

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
  machineStarts?: [string, string][];
}

export class LogFold {
  #sessions = new Map<string, SessionFold>();
  #lastSeen = new Map<string, string>();
  #branchStates = new Map<string, BranchState>();
  #appRecords = new Map<string, Line & { kind: "session-archived" | "session-unarchived" }>();
  #appWords = new Map<string, Line & { kind: "session-described" }>();
  #holders = new Map<string, Omit<Claim, "holder">>();
  #machines = new Map<string, string>();
  #machineStarts = new Map<string, string>();
  #judged = new Map<string, Map<string, Judged>>();

  static fromBounded(lines: readonly Line[], claimLines: readonly Line[]): LogFold {
    const fold = new LogFold();
    fold.add(lines);
    fold.#holders.clear();
    for (const line of claimLines) holding(fold.#holders, line);
    return fold;
  }

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
    fold.#machineStarts = new Map(snapshot.machineStarts ?? []);
    return fold;
  }

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
      machineStarts: [...this.#machineStarts],
    };
  }

  add(lines: readonly Line[]): void {
    for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
      this.#lastSeen.set(line.session, line.at);
      if (line.machine !== undefined) this.#machines.set(line.session, line.machine);
      if (!ABOUT_OTHERS.has(line.kind) && pullOf(line.session) === undefined) this.#own(line);
      if (line.kind === "branch-state") this.#branchStates.set(line.of, line);
      else if (line.kind === "merged") this.#branchStates.set(line.branch, { open: false, at: line.at });
      else if (line.kind === "session-archived" || line.kind === "session-unarchived") this.#appRecords.set(line.of, line);
      else if (line.kind === "session-described") this.#appWords.set(line.of, line);
      else if (line.kind === "machine-started" && !(Date.parse(this.#machineStarts.get(line.machine) ?? "") >= Date.parse(line.startedAt))) this.#machineStarts.set(line.machine, line.startedAt);
      holding(this.#holders, line);
    }
  }

  strangers(lines: readonly Line[]): string[] {
    const strangers = new Set<string>();
    for (const line of lines) if (!ABOUT_OTHERS.has(line.kind) && pullOf(line.session) === undefined && !this.#sessions.has(line.session)) strangers.add(line.session);
    return [...strangers];
  }

  foldEarlier(lines: readonly Line[]): void {
    const known = new Set(this.#sessions.keys());
    const placed = new Set(this.#machines.keys());
    for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
      if (known.has(line.session) || ABOUT_OTHERS.has(line.kind) || pullOf(line.session) !== undefined) continue;
      const seen = this.#lastSeen.get(line.session);
      if (seen === undefined || Date.parse(seen) < Date.parse(line.at)) this.#lastSeen.set(line.session, line.at);
      if (line.machine !== undefined && !placed.has(line.session)) this.#machines.set(line.session, line.machine);
      this.#own(line);
    }
    const entries = [...this.#sessions].filter(([session]) => known.has(session));
    if (entries.length === this.#sessions.size) return;
    for (const entry of [...this.#sessions].filter(([session]) => !known.has(session))) {
      const before = entries.findIndex(([, own]) => Date.parse(own.firstAt) > Date.parse(entry[1].firstAt));
      entries.splice(before === -1 ? entries.length : before, 0, entry);
    }
    this.#sessions = new Map(entries);
  }

  #own(line: Line): void {
    let own = this.#sessions.get(line.session);
    if (own === undefined) {
      own = { session: line.session, firstAt: line.at, latest: { kind: line.kind, at: line.at }, worktrees: new Set(), hooksRunning: false, branches: new Set(), placed: new Map(),
        prompted: false, inTurn: false, running: new Map(), finished: new Set() };
      this.#sessions.set(line.session, own);
    }
    own.latest = line.kind === "turn-ended" && line.exits === true && (line.background ?? 0) === 0 ? { kind: line.kind, at: line.at, exits: true } : { kind: line.kind, at: line.at };
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
    if (line.kind === "prompt-submitted") own.prompted = own.inTurn = true;
    else if (line.kind === "turn-ended" || line.kind === "session-ended" || (line.kind === "session-started" && line.how !== "compact")) own.inTurn = false;
    if (line.kind === "command-started") {
      if (!own.finished.has(line.call)) {
        own.running.set(line.call, { command: line.command, since: line.at,
          until: Date.parse(line.at) + (line.limitMs ?? (line.harness === "claude-code" ? CLAUDE_CODE_COMMAND_MS : LONGEST_COMMAND_MS)) });
      }
    } else if (line.kind === "command-run" && line.call !== undefined) {
      if (!own.running.delete(line.call)) own.finished.add(line.call);
    } else if (line.kind === "turn-ended" && line.background !== undefined && line.background > 0) {
      for (const one of own.running.values()) one.until = Date.parse(one.since) + LONGEST_COMMAND_MS;
    } else if (line.kind === "turn-ended" || line.kind === "session-started" || line.kind === "session-ended") own.running.clear();
    if (line.kind === "turn-ended" && (line.background ?? 0) > 0) own.backgroundUntil = Date.parse(line.at) + LONGEST_COMMAND_MS;
    else if (line.kind === "turn-ended" || (line.kind === "session-started" && line.how !== "compact")) delete own.backgroundUntil;
    if (line.kind === "session-ended" || (line.kind === "turn-ended" && line.exits === true && (line.background ?? 0) === 0)) own.stopped = true;
    else if (line.kind === "turn-ended" || line.kind === "prompt-submitted" || line.kind === "claimed" || (line.kind === "session-started" && line.how !== "compact")) delete own.stopped;
    if (line.kind === "closed-out") own.closedOut = { line, reopened: false };
    else if (own.closedOut !== undefined && (line.kind === "claimed" || line.kind === "prompt-submitted" || (line.kind === "session-started" && line.how !== "compact"))) own.closedOut.reopened = true;
    if (line.kind === "session-named") own.name = line.title;
    if (line.kind === "pointed" && line.capability !== undefined && line.why !== undefined) {
      own.pointer = { capability: line.capability, ...(line.gate === undefined ? {} : { gate: line.gate }), why: line.why, ...(line.question === undefined ? {} : { question: line.question }), at: line.at };
    } else if (line.kind === "pointed" || line.kind === "closed-out" || line.kind === "session-ended") delete own.pointer;
    if (line.kind === "turn-ended") own.lastTurnEnded = { seq: line.seq, background: line.background ?? 0 };
  }

  sessions(options: SessionOptions = {}): Session[] {
    const now = (options.now ?? new Date()).getTime();
    const quietMs = options.quietMs ?? QUIET_MS;
    const leaveMs = options.leaveMs ?? LEAVE_MS;
    const times = `${quietMs} ${leaveMs}`;
    let judgedAt = this.#judged.get(times);
    if (judgedAt === undefined) {
      if (this.#judged.size >= JUDGED_TIMES) this.#judged.delete(this.#judged.keys().next().value!);
      this.#judged.set(times, judgedAt = new Map());
    }
    const judgements = judgedAt;
    return [...this.#sessions.values()].map((own) => {
      const reads = this.#reads(own);
      const was = judgements.get(own.session);
      if (was !== undefined && was.from <= now && now < was.until && sameReads(was.reads, reads)) return was.session;
      const { session: judged, until } = this.#judge(own, now, quietMs, leaveMs);
      judgements.set(own.session, { reads, from: now, until, session: judged });
      return judged;
    });
  }

  #reads(own: SessionFold): unknown[] {
    const machine = this.#machines.get(own.session);
    return [own.latest, machine, machine === undefined ? undefined : this.#machineStarts.get(machine),
      this.#appRecords.get(own.session), this.#appWords.get(own.session),
      ...[...own.branches].map((branch) => this.#branchStates.get(branch))];
  }

  #judge(own: SessionFold, now: number, quietMs: number, leaveMs: number): { session: Session; until: number } {
    const { session, harness, latest } = own;
    const folder = own.startedIn ?? own.firstFolder;
    const died = this.#diedWithMachine(session, latest.at);
    const running = died ? [] : [...own.running.values()].filter(({ until }) => now <= until);
    const quiet = now - Date.parse(latest.at) > quietMs && running.length === 0;
    const person = session.startsWith("person:");
    const state: SessionState = latest.kind === "session-ended" || latest.exits === true ? "ended"
      : died || now - Date.parse(latest.at) > LONGEST_COMMAND_MS ? "gone"
      : person ? "waiting"
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
    const listing: Listing = person ? "hidden"
      : closeOut !== undefined ? (closeOut.verified ? "hidden" : "listed")
      : openWork.length > 0 ? "listed"
      : record !== undefined ? (archived ? "hidden" : settled ? "done" : "listed")
      : settled ? "hidden" : "listed";
    const words = this.#appWords.get(session);
    const machine = this.#machines.get(session);
    const seen = Date.parse(latest.at);
    const until = Math.min(...[seen + quietMs + 1, seen + LONGEST_COMMAND_MS + 1, settledSince + leaveMs + 1,
      ...(died ? [] : [...own.running.values()].map(({ until: ends }) => ends + 1))].filter((at) => at > now));
    return { until, session: {
      session,
      ...(harness === undefined ? {} : { harness }),
      label: labelOf(harness),
      ...(folder === undefined ? {} : { folder }),
      ...(machine === undefined ? {} : { machine }),
      worktrees: [...own.worktrees],
      startedAt: own.firstAt,
      lastSeenAt: latest.at,
      state,
      hooksRunning: own.hooksRunning,
      tier: own.hooksRunning ? "watched" : tierOf(harness),
      branches,
      openWork,
      branchesByFolder,
      running: running.map(({ command, since }) => ({ command, since })),
      ...(record === undefined ? {} : { app: record.app }),
      archived,
      ...(words?.title === undefined ? {} : { title: words.title }),
      ...(own.name === undefined ? {} : { name: own.name }),
      ...(words?.status === undefined ? {} : { status: words.status }),
      ...(own.pointer === undefined || state === "ended" || state === "gone" ? {} : { pointer: { ...own.pointer } }),
      ...(closeOut === undefined ? {} : { closeOut }),
      listing,
    } };
  }

  claims(options: ClaimsOptions = {}): Claim[] {
    const now = (options.now ?? new Date()).getTime();
    const quietMs = options.quietMs ?? QUIET_MS;
    const sessions = new Map(this.sessions({ now: new Date(now) }).map((session) => [session.session, session]));
    return [...this.#holders.values()].map((holder) => {
      const pull = pullOf(holder.session);
      if (pull !== undefined) return { ...holder, holder: "live", binds: `held for PR #${pull} until it merges or closes (ADR-1037)` } as Claim;
      const seen = this.#lastSeen.get(holder.session) ?? holder.since;
      const own = this.#sessions.get(holder.session);
      const running = [...(own?.running.values() ?? [])].some(({ until }) => now <= until);
      const background = own?.backgroundUntil !== undefined && now <= own.backgroundUntil;
      const closeOut = sessions.get(holder.session)?.closeOut;
      const because: QuietBecause | undefined = closeOut?.verified === true ? "closed-out"
        : diedIn(options.restarted, this.#machines.get(holder.session), seen) || this.#diedWithMachine(holder.session, seen) ? "restart"
        : own?.stopped === true || stoppedBy(options.beats?.get(holder.session), seen, now, running) ? "stopped"
        : now - Date.parse(seen) > quietMs && !running && !background ? (now - Date.parse(seen) > LONGEST_COMMAND_MS ? "gone" : "idle")
        : undefined;
      if (because !== undefined) return { ...holder, holder: "idle", quiet: { since: seen, because } } as Claim;
      const binds = running ? "a command is still recorded as running"
        : background && now - Date.parse(seen) > quietMs ? "a background task its turn left running still runs"
        : "activity is within the claim quiet time";
      return { ...holder, holder: "live", binds: `${binds}${closeOut?.needsYou === undefined ? "" : `; close-out ${closeOut.needsYou}`}` } as Claim;
    });
  }

  #diedWithMachine(session: string, lastSeen: string): boolean {
    const machine = this.#machines.get(session);
    const started = machine === undefined ? undefined : this.#machineStarts.get(machine);
    return started !== undefined && Date.parse(lastSeen) < Date.parse(started);
  }

  machines(): ReadonlyMap<string, string> {
    return this.#machines;
  }

  #branchState(branch: string): Pick<BranchInFolder, "open" | "pr"> {
    const state = this.#branchStates.get(branch);
    if (state?.open === false) return { open: false };
    if (state?.pr === undefined) return { open: true };
    return { open: true, pr: pullState(state.pr, state) };
  }

  openPull(pr: number): (PullState & { at: string }) | undefined {
    const state = [...this.#branchStates.values()].filter((one) => one.open && one.pr === pr).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    return state === undefined ? undefined : { ...pullState(pr, state), at: state.at };
  }

  pullsInCi(): { inCi: number; inQueue: number } | undefined {
    if (this.#branchStates.size === 0) return undefined;
    const latest = new Map<number, BranchState>();
    for (const state of this.#branchStates.values()) {
      if (!state.open || state.pr === undefined) continue;
      const seen = latest.get(state.pr);
      if (seen === undefined || Date.parse(state.at) > Date.parse(seen.at)) latest.set(state.pr, state);
    }
    const pulls = [...latest.values()].map((state) => ({ checks: state.checks, queued: state.queued === true })).filter(inCi);
    return { inCi: pulls.filter(({ queued }) => !queued).length, inQueue: pulls.filter(({ queued }) => queued).length };
  }

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

export function inCi(pull: { readonly checks?: PullState["checks"] | undefined; readonly queued: boolean }): boolean {
  return pull.queued || pull.checks === "pending";
}

function pullState(pr: number, state: BranchState): PullState {
  return { number: pr, draft: state.draft === true, ...(state.checks === undefined ? {} : { checks: state.checks }), queued: state.queued === true,
    ...(state.checksSince === undefined ? {} : { checksSince: state.checksSince }), ...(state.queuedSince === undefined ? {} : { queuedSince: state.queuedSince }),
    ...(state.queueWaiting ? { queueWaiting: true as const } : {}) };
}

const JUDGED_TIMES = 4;

interface Judged {
  reads: unknown[];
  from: number;
  until: number;
  session: Session;
}

function sameReads(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((one, i) => one === b[i]);
}

export interface LogReading {
  readonly fold: LogFold;
  readonly lines: readonly Line[];
}

export function logReading(log: readonly Line[] | LogReading): LogReading {
  if (!Array.isArray(log)) return log as LogReading;
  const fold = new LogFold();
  fold.add(log);
  return { fold, lines: log };
}

function holding(holders: Map<string, Omit<Claim, "holder">>, line: Line): void {
  if (line.kind === "claimed") {
    holders.delete(idOf(line));
    holders.set(idOf(line), { ...claimOf(line.session, line.harness, partOf(line), line.reason, line.at, line.branch), ...(line.under === undefined ? {} : { under: line.under }) });
    return;
  }
  for (const [id, holder] of holders) if (ends(line, id, holder)) holders.delete(id);
}
