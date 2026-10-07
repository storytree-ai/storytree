/**
 * Capability 9 · Context readings. Contract 9.10 · a session's window, read from its transcript (ADR-0746 D1): what is in it now, the
 * call that brought each piece, each note or file the session opened, in order, with whether its
 * read is still in the window, and the notes it only glimpsed.
 *
 * - A piece is a tool result, joined to its call by the id the harness wrote (`tool_use_id`, Codex's
 *   `call_id`). What a call opened is read from its labels: the agent link's `open`, a shell's
 *   `storytree library read <id>`, a file-read tool's path, or a shell `cat`/`head`/`tail`/`sed -n`
 *   of a file. Nothing is inferred from timing, order or wording.
 * - A compaction (Claude Code's `compact_boundary`, Codex's `compacted`) drops what came before it,
 *   except the segment Claude Code says it kept. A subagent's (`isSidechain`) records are another
 *   window's and are left out.
 * - A glimpse means only that a note's id is in a result the window holds. It never says the session
 *   followed anything (ADR-0740 D3), and nothing decides anything from it (D4).
 */

import type { Line } from "../activity/index.js";
import { NOTHING_STORED, readTranscriptFile, transcriptOf, type TranscriptReader } from "./context.js";
import { isRecord, jsonLines, type JsonRecord } from "./transcript.js";

/** A note (any library record, by id) or a file (by the path the call named). */
export type WindowTarget = { readonly kind: "note" | "file"; readonly id: string };

/** How a piece arrived: the call that brought it, and what that call opened. */
export type Arrival = { readonly call: string; readonly tool: string; readonly opened: readonly WindowTarget[] };

/** One opening: the call that made it, and whether what it brought is still in the window now. */
export type WindowOpen = WindowTarget & {
  readonly call: string;
  readonly tool: string;
  readonly resident: boolean;
};

export type WindowReading = {
  /** Every result in the window now, in order, with the call that brought it. */
  readonly inView: readonly Arrival[];
  /** Every opening in the transcript, in order. */
  readonly opens: readonly WindowOpen[];
  /** Notes named in a result in the window now but never opened, in the order first named: search hits, shelf spines, linked titles. */
  readonly glimpses: readonly string[];
  /** How many compactions the transcript records. */
  readonly compactions: number;
};

/** A transcript as the fold reads it: calls, their results, and compactions, by position. */
type Step =
  | { readonly kind: "call"; readonly id: string; readonly tool: string; readonly opens: readonly WindowTarget[] }
  | { readonly kind: "result"; readonly id: string; readonly text: string }
  | { readonly kind: "boundary"; readonly kept: ReadonlySet<number> };

const NOTE_ID = /\b[a-z]+_[0-9a-f]{12}\b/;
const NOTE_IDS = new RegExp(NOTE_ID.source, "g");
const LIBRARY_READ = new RegExp(`storytree\\s+library\\s+read\\s+(${NOTE_ID.source})`, "g");
/** A reader in command position (a line's start, or after |, ;, & or a subshell's paren), with its arguments on that line. */
const FILE_READERS = /(?:^|[|;&(])[ \t]*(?:cat|head|tail|less|more)((?:[ \t]+[^\s|;&>]+)+)/gm;
const SED_PRINT = /(?:^|[|;&(])[ \t]*sed[ \t]+-n[ \t]+\S+[ \t]+([^\s|;&>]+)/gm;
const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w-]*)\2/;

/**
 * A command line with every quoted span's characters (quotes included), and every heredoc's operator and
 * body, hidden behind a mark of the same length (line breaks kept), so a reader named inside quoted text or
 * a heredoc (an echo, a commit message) is never read as a call, and a quoted path stays one word.
 */
function hideQuoted(command: string): string {
  let hidden = "";
  let quote: string | undefined;
  const heredocs: { word: string; tabs: boolean }[] = [];
  for (let at = 0; at < command.length; at++) {
    const char = command[at]!;
    const heredoc = quote === undefined && command[at - 1] !== "<" && command[at + 2] !== "<" ? HEREDOC.exec(command.slice(at)) : null;
    if (heredoc) {
      heredocs.push({ word: heredoc[3]!, tabs: heredoc[1] === "-" });
      hidden += "\0".repeat(heredoc[0].length);
      at += heredoc[0].length - 1;
      continue;
    }
    if (quote === undefined && char === "\n" && heredocs.length > 0) {
      // Each body runs from the next line through its delimiter's own line, the bodies one after another.
      let end = at + 1;
      for (const { word, tabs } of heredocs.splice(0)) {
        for (let line = end; line < command.length; line = end) {
          const eol = command.indexOf("\n", line);
          end = eol === -1 ? command.length : eol + 1;
          const text = command.slice(line, eol === -1 ? command.length : eol);
          if ((tabs ? text.replace(/^\t+/, "") : text) === word) break;
        }
      }
      hidden += `\n${command.slice(at + 1, end).replace(/[^\n]/g, "\0")}`;
      at = end - 1;
      continue;
    }
    if (quote === undefined && (char === "'" || char === '"')) quote = char;
    else if (quote === '"' && char === "\\") { hidden += "\0"; at++; if (at < command.length) hidden += "\0"; continue; }
    else if (char === quote) { quote = undefined; hidden += "\0"; continue; }
    hidden += quote === undefined ? char : "\0";
  }
  return hidden;
}

/** What a shell command line opens: notes it reads from the library, and files it prints outside quoted text. */
function shellOpens(command: string): WindowTarget[] {
  const opens: WindowTarget[] = [...command.matchAll(LIBRARY_READ)].map(([, id]) => ({ kind: "note", id: id! }));
  const hidden = hideQuoted(command);
  /** The words of a match's last group, as the command wrote them. */
  const words = (match: RegExpMatchArray): string[] => {
    const start = match.index! + match[0].length - match[1]!.length;
    return [...match[1]!.matchAll(/\S+/g)].map((word) => command.slice(start + word.index!, start + word.index! + word[0].length).replace(/^["']|["']$/g, ""));
  };
  for (const match of hidden.matchAll(FILE_READERS)) {
    for (const word of words(match)) if (!/^[-<]/.test(word) && !/^\d+$/.test(word)) opens.push({ kind: "file", id: word });
  }
  for (const match of hidden.matchAll(SED_PRINT)) opens.push({ kind: "file", id: words(match)[0]! });
  return opens;
}

/** What a named tool call opens. */
function callOpens(tool: string, input: JsonRecord): WindowTarget[] {
  const name = tool.slice(tool.lastIndexOf("__") + 2);
  if (tool.startsWith("mcp__storytree__") && name === "open" && typeof input.id === "string") return [{ kind: "note", id: input.id }];
  if ((tool === "Read" || tool === "view_image") && typeof (input.file_path ?? input.path) === "string") return [{ kind: "file", id: String(input.file_path ?? input.path) }];
  const command = input.command ?? input.cmd;
  if (typeof command === "string") return shellOpens(command);
  if (Array.isArray(command)) return shellOpens(command.filter((part) => typeof part === "string").join(" "));
  return [];
}

/** A result's words: its text blocks, or the value as written. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : JSON.stringify(block))).join("\n");
  return JSON.stringify(content) ?? "";
}

/** The window a list of steps leaves. */
function fold(steps: readonly Step[]): WindowReading {
  const calls = new Map<string, Arrival>();
  const results: { at: number; id: string; text: string }[] = [];
  const boundaries: { at: number; kept: ReadonlySet<number> }[] = [];
  const opened: { at: number; target: WindowTarget; arrival: Arrival }[] = [];
  /** Was the result at `at` still in view at position `now`? */
  const inViewAt = (at: number, now: number): boolean => at < now && boundaries.every((b) => b.at < at || b.at >= now || b.kept.has(at));
  const arrivalOf = (id: string): Arrival => calls.get(id) ?? { call: id, tool: "<unmatched>", opened: [] };

  steps.forEach((step, at) => {
    if (step.kind === "boundary") boundaries.push({ at, kept: step.kept });
    else if (step.kind === "result") results.push({ at, id: step.id, text: step.text });
    else {
      const arrival: Arrival = { call: step.id, tool: step.tool, opened: step.opens };
      calls.set(step.id, arrival);
      for (const target of step.opens) opened.push({ at, target, arrival });
    }
  });
  const end = steps.length;
  const resultOf = new Map(results.map((result) => [result.id, result]));
  const resident = results.filter(({ at }) => inViewAt(at, end));
  const everOpened = new Set(opened.filter(({ target }) => target.kind === "note").map(({ target }) => target.id));
  const glimpses = new Set(resident.flatMap(({ text }) => text.match(NOTE_IDS) ?? []).filter((id) => !everOpened.has(id)));
  return {
    inView: resident.map(({ id }) => arrivalOf(id)),
    opens: opened.map(({ target, arrival }) => {
      const brought = resultOf.get(arrival.call);
      return { ...target, call: arrival.call, tool: arrival.tool, resident: brought !== undefined && inViewAt(brought.at, end) };
    }),
    glimpses: [...glimpses],
    compactions: boundaries.length,
  };
}

/** A Claude Code transcript's window. Positions are steps, so a kept segment is named by the steps its records made. */
export function claudeCodeWindow(text: string): WindowReading {
  const records = jsonLines(text);
  const steps: Step[] = [];
  const stepsOf = new Map<string, number[]>();
  for (const record of records === "empty" ? [] : records) {
    if (record.isSidechain === true) continue;
    const made: number[] = [];
    const push = (step: Step): void => { made.push(steps.length); steps.push(step); };
    if (record.type === "system" && record.subtype === "compact_boundary") {
      const segment = isRecord(record.compactMetadata) && isRecord(record.compactMetadata.preservedSegment) ? record.compactMetadata.preservedSegment : undefined;
      push({ kind: "boundary", kept: keptSteps(segment, [...stepsOf.entries()]) });
    }
    const content = isRecord(record.message) ? record.message.content : undefined;
    if ((record.type === "user" || record.type === "assistant") && Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "tool_use" && typeof block.id === "string") {
          const tool = typeof block.name === "string" ? block.name : "<unnamed>";
          push({ kind: "call", id: block.id, tool, opens: callOpens(tool, isRecord(block.input) ? block.input : {}) });
        } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          push({ kind: "result", id: block.tool_use_id, text: textOf(block.content) });
        }
      }
    }
    if (typeof record.uuid === "string") stepsOf.set(record.uuid, made);
  }
  return fold(steps);
}

/** The steps made by the records from the kept segment's head to its tail, in file order. */
function keptSteps(segment: JsonRecord | undefined, seen: [string, number[]][]): Set<number> {
  if (segment === undefined) return new Set();
  const head = seen.findIndex(([uuid]) => uuid === segment.headUuid);
  const tail = seen.findIndex(([uuid]) => uuid === segment.tailUuid);
  if (head < 0 || tail < head) return new Set();
  return new Set(seen.slice(head, tail + 1).flatMap(([, made]) => made));
}

/** A Codex rollout's window: its calls and outputs by `call_id`; a `compacted` record keeps no earlier output. */
export function codexWindow(text: string): WindowReading {
  const records = jsonLines(text);
  const steps: Step[] = [];
  for (const record of records === "empty" ? [] : records) {
    if (record.type === "compacted") { steps.push({ kind: "boundary", kept: new Set() }); continue; }
    const payload = record.type === "response_item" && isRecord(record.payload) ? record.payload : undefined;
    const id = typeof payload?.call_id === "string" ? payload.call_id : undefined;
    if (payload === undefined || id === undefined) continue;
    const name = typeof payload.name === "string" ? payload.name : "<unnamed>";
    if (payload.type === "custom_tool_call") {
      const source = typeof payload.input === "string" ? payload.input : "";
      steps.push({ kind: "call", id, tool: name, opens: name === "exec" ? execOpens(source) : callOpens(name, { command: source }) });
    } else if (payload.type === "function_call") {
      let args: unknown;
      try { args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments; } catch { args = undefined; }
      steps.push({ kind: "call", id, tool: name, opens: callOpens(name, isRecord(args) ? args : {}) });
    } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      steps.push({ kind: "result", id, text: textOf(payload.output) });
    }
  }
  return fold(steps);
}

/** An `exec` cell's opens: each `tools.<name>(…)` call in its script, read as that tool's call. */
function execOpens(source: string): WindowTarget[] {
  const starts = [...source.matchAll(/tools\.(\w+)\s*\(/g)];
  return starts.flatMap((start, index) => {
    const body = source.slice(start.index, starts[index + 1]?.index);
    const literal = /["']?(?:command|cmd|id|path)["']?\s*:\s*("(?:[^"\\]|\\.)*")/.exec(body);
    let value: unknown;
    try { value = literal?.[1] === undefined ? undefined : JSON.parse(literal[1]); } catch { value = undefined; }
    if (typeof value !== "string") return [];
    const name = start[1] ?? "";
    return name.endsWith("open") ? callOpens(`mcp__storytree__open`, { id: value }) : callOpens(name, { command: value, path: value });
  });
}

/** A session's window, worked out when asked, and when and from what; or why there is none. */
export type SessionWindow = { readonly session: string; readonly harness?: string; readonly at: string; readonly source?: string }
  & (WindowReading | { readonly absent: string });

/** `session`'s window, from the transcript last recorded for it (3.12), read now: never a folder's guess. From its file, unless `read` says otherwise. */
export async function sessionWindow(lines: readonly Line[], session: string,
  { now = new Date(), read = readTranscriptFile }: { now?: Date; read?: TranscriptReader } = {}): Promise<SessionWindow> {
  const at = now.toISOString();
  const named = transcriptOf(lines, session);
  if (named === undefined) return { session, absent: "no hook has named this session's transcript", at };
  const { transcript, harness } = named;
  const who = harness === undefined ? { session } : { session, harness };
  let text: string | undefined;
  try {
    text = await read(transcript);
  } catch {
    return { ...who, absent: "the transcript named for this session cannot be read", at, source: transcript };
  }
  if (text === undefined) return { ...who, absent: NOTHING_STORED, at, source: transcript };
  return { ...who, ...(harness === "codex" ? codexWindow(text) : claudeCodeWindow(text)), at, source: transcript };
}
