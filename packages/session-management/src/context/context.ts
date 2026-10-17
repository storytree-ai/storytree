/**
 * Capability 9 · Context readings (the Session management story; ADR-0725, ADR-0728; 0.2's
 * `storytree context`, ADR-0716 O2): how many tokens a session's own context window holds, worked
 * out when it is asked for.
 *
 * The hooks record, on every line, the transcript file the harness named (`transcript_path`,
 * capability 3). A reading reads that file as it stands at the moment of asking, so it is fresh
 * mid-turn and in a `claude -p` run whose turn has not ended. Nothing ever looks for a transcript
 * by folder: that is what blinded 0.2 for batch sessions and for sessions that moved worktrees.
 *
 * A reading is tokens used (ADR-0728 D1), and, when the session's Claude Code mod reported its usage (ADR-1056 D3,
 * which narrows D1), the window and the share of it in use: the mod's figure is taken before the transcript's
 * while it is current (9.19). The guidance a session judges against is still a token figure from the per-user
 * settings (9.7). It reads and
 * never enforces. Any session's reading can be worked out this way without that session asking,
 * which is how a board can show one per session.
 */
import { readFile } from "node:fs/promises";

import type { ActivityLog } from "../activity/index.js";
import type { Line } from "@storytree/library";
import { labelOf } from "../readings.js";
import { watchedHarness } from "@storytree/project-and-caller/caller";
import { claudeCodeCompositionFold, codexCompositionFold, type Composition, type CompositionFold } from "./composition.js";
import { contextGuidance, type ContextGuidance } from "./guidance.js";
import { isCount, isRecord, SYNTHETIC, type JsonRecord } from "./transcript.js";

/** Tokens a transcript's latest own request held, or why there is no figure. Never a 0 standing in for an absence. */
export type TokenCount = { readonly tokens: number } | { readonly absent: string };

/** A session's context reading: its tokens used, or why there is no figure, and when and from what it was read. */
export type ContextReading = {
  readonly session: string;
  readonly harness?: string;
  /** When the reading was worked out, as an ISO 8601 timestamp. */
  readonly at: string;
  /** The transcript it was read from, when one was named. */
  readonly source?: string;
} & ({
  readonly tokens: number;
  /** The context window's size and the whole percent of it the tokens fill, when the session's mod reported its window (9.19). */
  readonly window?: number;
  readonly percent?: number;
  /** What those tokens are made of (9.8), or why that is not known. */
  readonly composition: Composition | { readonly absent: string };
  /** The user's current context guidance and where this count sits, or why it could not be read (9.7). */
  readonly guidance: ContextGuidance;
} | { readonly absent: string });

/**
 * A Claude Code transcript's figure: its own latest request's `input_tokens` +
 * `cache_read_input_tokens` + `cache_creation_input_tokens`. A request written across several
 * lines (one per content block) shares one `requestId` and counts once; subagent (`isSidechain`)
 * and `<synthetic>` lines are not the session's own window, so they never change the figure.
 */
export function claudeCodeTokens(text: string): TokenCount {
  return new ContextFold("claude-code").feed(text).count();
}

/** A Codex rollout's figure: its last token count's `input_tokens` (Codex counts its cached input within it). */
export function codexTokens(text: string): TokenCount {
  return new ContextFold("codex").feed(text).count();
}

/**
 * A Pi session file's figure, as Pi counts its own context (`calculateContextTokens`, Pi 1.1.0): its last
 * assistant message's `usage.totalTokens`, or its input, output, cache-read and cache-write summed, skipping
 * a message that was aborted or errored and one whose usage is all zero. It matched Pi's own
 * `getContextUsage().tokens` in a real Pi (2026-10-12).
 */
function piContextTokens(record: JsonRecord): number | undefined {
  const message = record.message;
  if (record.type !== "message" || !isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") return undefined;
  const { totalTokens, input, output, cacheRead, cacheWrite } = message.usage;
  const tokens = isCount(totalTokens) && totalTokens > 0 ? totalTokens : [input, output, cacheRead, cacheWrite].reduce<number>((sum, part) => sum + (isCount(part) ? part : 0), 0);
  return tokens > 0 ? tokens : undefined;
}

/**
 * A transcript's figure and composition, worked out a piece at a time: fed the transcript in pieces
 * that end on whole lines, it reads as the whole would, so a reader that asks again and again (the
 * app, every 10 seconds) parses only what the transcript gained since (9.14).
 */
export class ContextFold {
  readonly harness: string | undefined;
  readonly #codex: boolean;
  readonly #pi: boolean;
  /** A harness storytree has no reader for: its transcript is never read as another's (contract 9.15). */
  readonly #unread: boolean;
  readonly #composition: CompositionFold;
  /** The transcript is a subagent's own file, where every record is a sidechain record and all of them are its window (9.17). */
  readonly subagent: boolean;
  #lines = 0;
  #records = 0;
  #latest: number | undefined;
  /** Each own request's spend, by its `requestId`, a request written across several lines counted once (a Claude Code transcript). */
  readonly #requests = new Map<string, number>();
  /** What a Codex rollout's running total says it has spent, or a Pi session's messages summed. */
  #total = 0;

  constructor(harness: string | undefined, { subagent = false }: { subagent?: boolean } = {}) {
    this.harness = harness;
    this.subagent = subagent;
    // A line naming no harness is from before hooks named it: Claude Code's, the only harness then.
    const reader = harness === undefined ? "claude-code" : watchedHarness(harness)?.transcript;
    this.#unread = reader === undefined;
    this.#codex = reader === "codex";
    this.#pi = reader === "pi";
    this.#composition = this.#codex ? codexCompositionFold() : claudeCodeCompositionFold({ subagent });
  }

  /** Take the next piece of the transcript: whole lines, following the last piece fed. */
  feed(text: string): this {
    if (this.#unread) return this;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      this.#lines += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // A line cut short while the harness writes it, or one that is not JSON: not a reading.
      }
      if (!isRecord(parsed)) continue;
      this.#records += 1;
      this.#take(parsed);
      this.#composition.add(parsed);
    }
    return this;
  }

  /** How many lines it has parsed. */
  get parsed(): number {
    return this.#lines;
  }

  count(): TokenCount {
    if (this.#unread) return { absent: `storytree reads no transcript of ${labelOf(this.harness)}` };
    if (this.#codex) {
      if (this.#lines === 0) return { absent: "the rollout is empty" };
      return this.#latest === undefined ? { absent: "the rollout holds no token count" } : { tokens: this.#latest };
    }
    if (this.#lines === 0) return { absent: "the transcript is empty" };
    if (this.#pi) return this.#latest === undefined ? { absent: "the session file holds no assistant message's usage" } : { tokens: this.#latest };
    if (this.#records === 0) return { absent: "the transcript holds no line storytree can read" };
    return this.#latest === undefined ? { absent: "the transcript holds only subagent or synthetic requests" } : { tokens: this.#latest };
  }

  /**
   * The tokens the transcript has spent so far, every own request's added up: a Claude Code request's input, cache
   * reads, cache writes and output, once per `requestId`; a Codex rollout's latest running total; a Pi session's
   * messages, each counted as its context figure is. 0 for a transcript holding none; what the window holds is `count`.
   */
  spent(): number {
    if (this.#codex || this.#pi) return this.#total;
    let sum = 0;
    for (const tokens of this.#requests.values()) sum += tokens;
    return sum;
  }

  composition(): Composition | undefined {
    return this.#lines === 0 || this.#pi ? undefined : this.#composition.composition();
  }

  /** Why there is no composition, when composition() gives none. */
  get compositionAbsent(): string {
    return this.#pi ? "storytree does not yet sort what a Pi session's context is made of" : "the transcript holds no own request to sort";
  }

  #take(record: JsonRecord): void {
    if (this.#pi) {
      const tokens = piContextTokens(record);
      if (tokens === undefined) return;
      this.#latest = tokens;
      this.#total += tokens;
      return;
    }
    if (this.#codex) {
      const payload = record.payload;
      if (record.type !== "event_msg" || !isRecord(payload) || payload.type !== "token_count" || !isRecord(payload.info)) return;
      const total = payload.info.total_token_usage;
      if (isRecord(total) && isCount(total.total_tokens)) this.#total = total.total_tokens;
      const usage = payload.info.last_token_usage;
      if (isRecord(usage) && isCount(usage.input_tokens)) this.#latest = usage.input_tokens;
      return;
    }
    const message = record.message;
    if (!isRecord(message) || !isRecord(message.usage) || (record.isSidechain === true && !this.subagent) || message.model === SYNTHETIC) return;
    const { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created, output_tokens: output } = message.usage;
    if (!isCount(input)) return;
    this.#latest = input + (isCount(read) ? read : 0) + (isCount(created) ? created : 0);
    this.#requests.set(typeof record.requestId === "string" ? record.requestId : `line ${this.#lines}`, this.#latest + (isCount(output) ? output : 0));
  }
}

/**
 * Where a transcript's records are stored in the shared log: under the session whose hooks shipped
 * them, as its own (`part` '') or as one of its subagents' (`part` the subagent's id).
 */
export type StoredAt = { readonly session: string; readonly part: string };

/** A session's transcript as the hooks named it: its path, its harness, and where its records are stored. */
export type NamedTranscript = { transcript: string; harness?: string; stored: StoredAt };

/**
 * The transcript last recorded for `session`, and its harness: what a hook named, never a folder's guess.
 * A Claude Code subagent's hooks name only its parent's transcript, so a subagent's is the file Claude Code
 * writes beside it, `<parent without .jsonl>/subagents/agent-<id>.jsonl`, named by the line its parent
 * started it with (9.17), and stored under the parent by its id (ship.ts).
 */
export function transcriptOf(lines: readonly Line[], session: string): NamedTranscript | undefined {
  const line = lines.findLast((one) => one.session === session && one.transcript !== undefined);
  if (line?.transcript !== undefined) {
    const stored = { session, part: "" };
    return line.harness === undefined ? { transcript: line.transcript, stored } : { transcript: line.transcript, harness: line.harness, stored };
  }
  const started = lines.findLast((one) => one.kind === "subagent-started" && one.subagent === session && one.transcript !== undefined
    && (one.harness === undefined || watchedHarness(one.harness)?.transcript === "claude-code"));
  if (started?.transcript === undefined) return undefined;
  const stored = { session: started.session, part: session };
  const transcript = subagentTranscript(started.transcript, session);
  return started.harness === undefined ? { transcript, stored } : { transcript, harness: started.harness, stored };
}

/** The file Claude Code writes `subagent`'s transcript to, beside its parent's, in the parent path's own separators. */
function subagentTranscript(parent: string, subagent: string): string {
  const separator = parent.lastIndexOf("\\") > parent.lastIndexOf("/") ? "\\" : "/";
  return [parent.replace(/\.jsonl$/, ""), "subagents", `agent-${subagent}.jsonl`].join(separator);
}

/**
 * Where a transcript's text comes from: its file on this machine by default, or the records its
 * hooks streamed into the shared log (ADR-0749 D3), as `stored` says where. Undefined when none of it is there yet.
 */
export type TranscriptReader = (transcript: string, stored: StoredAt) => Promise<string | undefined>;

/** The transcript file itself, on the machine the session ran on. */
export const readTranscriptFile: TranscriptReader = (transcript) => readFile(transcript, "utf8");

/** Why a transcript `read` gave nothing: none of its records has reached the shared log. */
export const NOTHING_STORED = "none of this session's transcript has reached the shared log yet";

/**
 * A transcript's reading kept up to date by whoever holds it (9.14): the fold of everything stored
 * of `transcript` so far, or undefined when none of it is there yet.
 */
export type TranscriptFolder = (transcript: string, harness: string | undefined, stored: StoredAt) => Promise<ContextFold | undefined>;

/**
 * `session`'s reading from `lines`, its transcript read now: from its file, unless `read` says
 * otherwise, or from the fold `fold` keeps of it.
 */
export async function contextReading(lines: readonly Line[], session: string,
  { now = new Date(), home, read = readTranscriptFile, fold }: { now?: Date; home?: string; read?: TranscriptReader; fold?: TranscriptFolder } = {}): Promise<ContextReading> {
  const at = now.toISOString();
  const usage = reportedUsage(lines, session);
  const live = usage?.context.tokens === undefined ? undefined : usage;
  const named = transcriptOf(lines, session);
  /** The reading from the mod's figure alone, its composition absent for `why`. */
  const reported = (why: string, base: { harness?: string; source?: string }): ContextReading | undefined =>
    live?.context.tokens === undefined ? undefined : { session, ...base, ...figure(live.context.tokens, live), composition: { absent: why }, guidance: contextGuidance(live.context.tokens, home), at };
  if (named === undefined) {
    const why = "no hook has named this session's transcript";
    return reported(why, usage?.harness === undefined ? {} : { harness: usage.harness }) ?? { session, absent: why, at };
  }
  const { transcript, harness, stored } = named;
  const who = harness === undefined ? { session } : { session, harness };
  let folded: ContextFold | undefined;
  try {
    if (fold !== undefined) {
      folded = await fold(transcript, harness, stored);
    } else {
      const text = await read(transcript, stored);
      folded = text === undefined ? undefined : new ContextFold(harness, { subagent: stored.part !== "" }).feed(text);
    }
  } catch {
    const why = "the transcript named for this session cannot be read";
    return reported(why, { ...who, source: transcript }) ?? { ...who, absent: why, at, source: transcript };
  }
  if (folded === undefined) return reported(NOTHING_STORED, { ...who, source: transcript }) ?? { ...who, absent: NOTHING_STORED, at, source: transcript };
  const count = folded.count();
  if ("absent" in count) return reported(count.absent, { ...who, source: transcript }) ?? { ...who, ...count, at, source: transcript };
  const tokens = live?.context.tokens ?? count.tokens;
  const composition = folded.composition();
  return { ...who, ...figure(tokens, usage, live !== undefined), composition: composition ?? { absent: folded.compositionAbsent }, guidance: contextGuidance(tokens, home), at, source: transcript };
}

type UsageLine = Extract<Line, { kind: "usage-measured" }>;

/** How long a usage line stays current behind the session's latest transcript-naming line: two of the mod's report periods. */
const USAGE_CURRENT_MS = 120_000;

/**
 * `session`'s latest usage line, while it is current (no older than its latest transcript-naming line by more than
 * `USAGE_CURRENT_MS`): undefined for a session whose mod never reported, or stopped.
 */
function reportedUsage(lines: readonly Line[], session: string): UsageLine | undefined {
  const usage = lines.findLast((one): one is UsageLine => one.kind === "usage-measured" && one.session === session);
  if (usage === undefined) return undefined;
  const named = lines.findLast((one) => one.session === session && one.transcript !== undefined);
  return named !== undefined && Date.parse(named.at) - Date.parse(usage.at) > USAGE_CURRENT_MS ? undefined : usage;
}

/** `tokens` with the window `usage` names and the share of it they fill: the mod's own percent when `own` it is the mod's figure. */
function figure(tokens: number, usage: UsageLine | undefined, own = true): { tokens: number; window?: number; percent?: number } {
  if (usage === undefined) return { tokens };
  const { window, percent } = usage.context;
  return { tokens, window, percent: own && percent !== undefined ? percent : Math.min(100, Math.round((tokens / window) * 100)) };
}

/** `session`'s reading in `project`, worked out now from what the hooks recorded. */
export async function readContext(log: ActivityLog, project: string, session: string, options: { now?: Date; home?: string } = {}): Promise<ContextReading> {
  return contextReading(await transcriptLines(log, project, session), session, options);
}

/** The line that names `session`'s transcript, its latest: all a reading of it needs from the log (contract 2.7). */
export function transcriptLines(log: ActivityLog, project: string, session: string): Promise<Line[]> {
  return readingLines(log, project, [session]);
}

/**
 * The lines that name each of `sessions`' transcripts, the latest for each (contract 2.7): a session's own,
 * and for a subagent the line its parent started it with, which names the parent's (9.17).
 */
export async function readingLines(log: ActivityLog, project: string, sessions: readonly string[]): Promise<Line[]> {
  const omit = ["command", "files"];
  const [own, started, usage] = await Promise.all([
    log.lines(project, { sessions, has: ["transcript"], latestBy: ["session"], omit }),
    log.lines(project, { kinds: ["subagent-started"], where: { subagent: sessions }, has: ["transcript"], latestBy: ["subagent"], omit }),
    // And each session's latest usage its mod reported, which a reading takes before the transcript's figure (9.19).
    log.lines(project, { sessions, kinds: ["usage-measured"], latestBy: ["session"] }),
  ]);
  return [...own, ...started, ...usage].sort((a, b) => a.seq - b.seq);
}

/** A session's latest usage and latest failed turn, as its Claude Code mod reported them (ADR-1056 D3). */
export interface ReportedUsage {
  readonly usage?: UsageLine;
  readonly failed?: Extract<Line, { kind: "turn-failed" }>;
}

/** Each of `sessions`' latest reported usage and failed turn, for a lane's runner and the pool (9.20); a session with neither is left out. */
export async function reportedUsageOf(log: ActivityLog, project: string, sessions: readonly string[]): Promise<Map<string, ReportedUsage>> {
  const found = new Map<string, ReportedUsage>();
  if (sessions.length === 0) return found;
  const lines = await log.lines(project, { sessions, kinds: ["usage-measured", "turn-failed"], latestBy: ["session", "kind"] });
  for (const line of lines) {
    if (line.kind !== "usage-measured" && line.kind !== "turn-failed") continue;
    const seen = found.get(line.session) ?? {};
    found.set(line.session, line.kind === "usage-measured" ? { ...seen, usage: line } : { ...seen, failed: line });
  }
  return found;
}
