/**
 * Capability 9 · Context readings (the agent link story; ADR-0725, ADR-0728; 0.2's
 * `storytree context`, ADR-0716 O2): how many tokens a session's own context window holds, worked
 * out when it is asked for.
 *
 * The hooks record, on every line, the transcript file the harness named (`transcript_path`,
 * capability 3). A reading reads that file as it stands at the moment of asking, so it is fresh
 * mid-turn and in a `claude -p` run whose turn has not ended. Nothing ever looks for a transcript
 * by folder: that is what blinded 0.2 for batch sessions and for sessions that moved worktrees.
 *
 * A reading is tokens used, with no window size and no fraction (ADR-0728 D1): the guidance a
 * session judges against is a token figure, set on a settings surface still to come. It reads and
 * never enforces. Any session's reading can be worked out this way without that session asking,
 * which is how a board can show one per session.
 */
import { readFile } from "node:fs/promises";

import type { ActivityLog, Line } from "../activity/index.js";

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
} & ({ readonly tokens: number } | { readonly absent: string });

/** The harness's marker for a line it made itself rather than the model answering. */
const SYNTHETIC = "<synthetic>";

/**
 * A Claude Code transcript's figure: its own latest request's `input_tokens` +
 * `cache_read_input_tokens` + `cache_creation_input_tokens`. A request written across several
 * lines (one per content block) shares one `requestId` and counts once; subagent (`isSidechain`)
 * and `<synthetic>` lines are not the session's own window, so they never change the figure.
 */
export function claudeCodeTokens(text: string): TokenCount {
  const records = jsonLines(text);
  if (records === "empty") return { absent: "the transcript is empty" };
  if (records.length === 0) return { absent: "the transcript holds no line storytree can read" };
  let latest: number | undefined;
  for (const record of records) {
    const message = record.message;
    if (!isRecord(message) || !isRecord(message.usage) || record.isSidechain === true || message.model === SYNTHETIC) continue;
    const { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created } = message.usage;
    if (!isCount(input)) continue;
    latest = input + (isCount(read) ? read : 0) + (isCount(created) ? created : 0);
  }
  return latest === undefined ? { absent: "the transcript holds only subagent or synthetic requests" } : { tokens: latest };
}

/** A Codex rollout's figure: its last token count's `input_tokens` (Codex counts its cached input within it). */
export function codexTokens(text: string): TokenCount {
  const records = jsonLines(text);
  if (records === "empty") return { absent: "the rollout is empty" };
  let latest: number | undefined;
  for (const record of records) {
    const payload = record.payload;
    if (record.type !== "event_msg" || !isRecord(payload) || payload.type !== "token_count" || !isRecord(payload.info)) continue;
    const usage = payload.info.last_token_usage;
    if (isRecord(usage) && isCount(usage.input_tokens)) latest = usage.input_tokens;
  }
  return latest === undefined ? { absent: "the rollout holds no token count" } : { tokens: latest };
}

/** The transcript last recorded for `session`, and its harness: what a hook named, never a folder's guess. */
export function transcriptOf(lines: readonly Line[], session: string): { transcript: string; harness?: string } | undefined {
  const line = lines.findLast((one) => one.session === session && one.transcript !== undefined);
  if (line?.transcript === undefined) return undefined;
  return line.harness === undefined ? { transcript: line.transcript } : { transcript: line.transcript, harness: line.harness };
}

/** `session`'s reading from `lines`, its transcript read now. */
export async function contextReading(lines: readonly Line[], session: string, { now = new Date() }: { now?: Date } = {}): Promise<ContextReading> {
  const at = now.toISOString();
  const named = transcriptOf(lines, session);
  if (named === undefined) return { session, absent: "no hook has named this session's transcript", at };
  const { transcript, harness } = named;
  const who = harness === undefined ? { session } : { session, harness };
  let text: string;
  try {
    text = await readFile(transcript, "utf8");
  } catch {
    return { ...who, absent: "the transcript named for this session cannot be read", at, source: transcript };
  }
  const count = harness === "codex" ? codexTokens(text) : claudeCodeTokens(text);
  return { ...who, ...count, at, source: transcript };
}

/** `session`'s reading in `project`, worked out now from what the hooks recorded. */
export async function readContext(log: ActivityLog, project: string, session: string, options: { now?: Date } = {}): Promise<ContextReading> {
  const { lines } = await log.since(project, 0);
  return contextReading(lines, session, options);
}

type JsonRecord = Record<string, unknown>;

/** Each line of `text` that is a JSON object; "empty" for a text with no lines at all. */
function jsonLines(text: string): JsonRecord[] | "empty" {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return "empty";
  const records: JsonRecord[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // A line cut short while the harness writes it, or one that is not JSON: not a reading.
    }
  }
  return records;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
