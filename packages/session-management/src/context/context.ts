// Capability 9 · Context readings
import { readFile } from "node:fs/promises";

import type { ActivityLog } from "../activity/index.js";
import type { Line } from "@storytree/library";
import { labelOf } from "../readings.js";
import { watchedHarness } from "@storytree/project-and-caller/caller";
import { claudeCodeCompositionFold, codexCompositionFold, type Composition, type CompositionFold } from "./composition.js";
import { contextGuidance, type ContextGuidance } from "./guidance.js";
import { isCount, isRecord, SYNTHETIC, type JsonRecord } from "./transcript.js";

export interface ModelUsage {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

export type TokenCount = { readonly tokens: number } | { readonly absent: string };

export type ContextReading = {
  readonly session: string;
  readonly harness?: string;
  readonly at: string;
  readonly source?: string;
} & ({
  readonly tokens: number;
  readonly window?: number;
  readonly percent?: number;
  readonly composition: Composition | { readonly absent: string };
  readonly guidance: ContextGuidance;
} | { readonly absent: string });

export function claudeCodeTokens(text: string): TokenCount {
  return new ContextFold("claude-code").feed(text).count();
}

export function codexTokens(text: string): TokenCount {
  return new ContextFold("codex").feed(text).count();
}

function piContextTokens(record: JsonRecord): number | undefined {
  const message = record.message;
  if (record.type !== "message" || !isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") return undefined;
  const { totalTokens, input, output, cacheRead, cacheWrite } = message.usage;
  const tokens = isCount(totalTokens) && totalTokens > 0 ? totalTokens : [input, output, cacheRead, cacheWrite].reduce<number>((sum, part) => sum + (isCount(part) ? part : 0), 0);
  return tokens > 0 ? tokens : undefined;
}

export class ContextFold {
  readonly harness: string | undefined;
  readonly #codex: boolean;
  readonly #pi: boolean;
  readonly #unread: boolean;
  readonly #composition: CompositionFold;
  readonly subagent: boolean;
  #lines = 0;
  #records = 0;
  #latest: number | undefined;
  readonly #requests = new Map<string, number>();
  readonly #billed = new Map<string, { model: string; usage: ModelUsage }>();
  #total = 0;

  constructor(harness: string | undefined, { subagent = false }: { subagent?: boolean } = {}) {
    this.harness = harness;
    this.subagent = subagent;
    const reader = harness === undefined ? "claude-code" : watchedHarness(harness)?.transcript;
    this.#unread = reader === undefined;
    this.#codex = reader === "codex";
    this.#pi = reader === "pi";
    this.#composition = this.#codex ? codexCompositionFold() : claudeCodeCompositionFold({ subagent });
  }

  feed(text: string): this {
    if (this.#unread) return this;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      this.#lines += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      this.#records += 1;
      this.#take(parsed);
      this.#composition.add(parsed);
    }
    return this;
  }

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

  spent(): number {
    if (this.#codex || this.#pi) return this.#total;
    let sum = 0;
    for (const tokens of this.#requests.values()) sum += tokens;
    return sum;
  }

  bill(): Map<string, ModelUsage> | undefined {
    if (this.#codex || this.#pi || this.#unread) return undefined;
    const bill = new Map<string, ModelUsage>();
    for (const { model, usage } of this.#billed.values()) {
      const sum = bill.get(model) ?? { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 };
      for (const kind of Object.keys(sum) as (keyof ModelUsage)[]) sum[kind] += usage[kind];
      bill.set(model, sum);
    }
    return bill;
  }

  composition(): Composition | undefined {
    return this.#lines === 0 || this.#pi ? undefined : this.#composition.composition();
  }

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
    const key = typeof record.requestId === "string" ? record.requestId : `line ${this.#lines}`;
    this.#requests.set(key, this.#latest + (isCount(output) ? output : 0));
    const split = isRecord(message.usage.cache_creation) ? message.usage.cache_creation : {};
    const hour = isCount(split.ephemeral_1h_input_tokens) ? split.ephemeral_1h_input_tokens : 0;
    const written = isCount(created) ? created : 0;
    this.#billed.set(key, {
      model: typeof message.model === "string" ? message.model : "an unnamed model",
      usage: { input, cacheRead: isCount(read) ? read : 0, cacheWrite5m: Math.max(0, written - hour), cacheWrite1h: Math.min(hour, written), output: isCount(output) ? output : 0 },
    });
  }
}

export type StoredAt = { readonly session: string; readonly part: string };

export type NamedTranscript = { transcript: string; harness?: string; stored: StoredAt };

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

function subagentTranscript(parent: string, subagent: string): string {
  const separator = parent.lastIndexOf("\\") > parent.lastIndexOf("/") ? "\\" : "/";
  return [parent.replace(/\.jsonl$/, ""), "subagents", `agent-${subagent}.jsonl`].join(separator);
}

export type TranscriptReader = (transcript: string, stored: StoredAt) => Promise<string | undefined>;

export const readTranscriptFile: TranscriptReader = (transcript) => readFile(transcript, "utf8");

export const NOTHING_STORED = "none of this session's transcript has reached the shared log yet";

export type TranscriptFolder = (transcript: string, harness: string | undefined, stored: StoredAt) => Promise<ContextFold | undefined>;

export async function contextReading(lines: readonly Line[], session: string,
  { now = new Date(), home, read = readTranscriptFile, fold }: { now?: Date; home?: string; read?: TranscriptReader; fold?: TranscriptFolder } = {}): Promise<ContextReading> {
  const at = now.toISOString();
  const usage = reportedUsage(lines, session);
  const live = usage?.context.tokens === undefined ? undefined : usage;
  const named = transcriptOf(lines, session);
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

const USAGE_CURRENT_MS = 120_000;

function reportedUsage(lines: readonly Line[], session: string): UsageLine | undefined {
  const usage = lines.findLast((one): one is UsageLine => one.kind === "usage-measured" && one.session === session);
  if (usage === undefined) return undefined;
  const named = lines.findLast((one) => one.session === session && one.transcript !== undefined);
  return named !== undefined && Date.parse(named.at) - Date.parse(usage.at) > USAGE_CURRENT_MS ? undefined : usage;
}

function figure(tokens: number, usage: UsageLine | undefined, own = true): { tokens: number; window?: number; percent?: number } {
  if (usage === undefined) return { tokens };
  const { window, percent } = usage.context;
  return { tokens, window, percent: own && percent !== undefined ? percent : Math.min(100, Math.round((tokens / window) * 100)) };
}

export async function readContext(log: ActivityLog, project: string, session: string, options: { now?: Date; home?: string } = {}): Promise<ContextReading> {
  return contextReading(await transcriptLines(log, project, session), session, options);
}

export function transcriptLines(log: ActivityLog, project: string, session: string): Promise<Line[]> {
  return readingLines(log, project, [session]);
}

export async function readingLines(log: ActivityLog, project: string, sessions: readonly string[]): Promise<Line[]> {
  const omit = ["command", "files"];
  const [own, started, usage] = await Promise.all([
    log.lines(project, { sessions, has: ["transcript"], latestBy: ["session"], omit }),
    log.lines(project, { kinds: ["subagent-started"], where: { subagent: sessions }, has: ["transcript"], latestBy: ["subagent"], omit }),
    log.lines(project, { sessions, kinds: ["usage-measured"], latestBy: ["session"] }),
  ]);
  return [...own, ...started, ...usage].sort((a, b) => a.seq - b.seq);
}

export interface ReportedUsage {
  readonly usage?: UsageLine;
  readonly failed?: Extract<Line, { kind: "turn-failed" }>;
}

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
