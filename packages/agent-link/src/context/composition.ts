/**
 * Contract 9.8 · what a Claude Code or Codex session's context is made of, in the four groups the owner
 * named (arc_895e232031b0): Injected (what arrives unasked), Grounding (reading to understand),
 * Implementation (changing things, and every call the session authored), Other (the rest).
 *
 * Ported from 0.2's measured composition fold (0.2 ADR-0516 D3/D4, ADR-0524;
 * `packages/context-traversal-transcript` there), regrouped:
 * - Sorted from the LABELS the harness put on each record (`attachment.type`, a block's `type`,
 *   a call's tool name and, for a shell, its command's verbs), never from a body's words. A label
 *   the table does not know goes to Other and is named in `unsorted`, never guessed into a group.
 * - A tool result is sorted by the call it answers, and a call by what it does, not which tool ran
 *   it: a shell `grep` is grounding, a shell test run is implementation.
 * - The system prompt and tool list are never written to a transcript, so they are the residual
 *   the first own request's resident tokens leave over what the transcript recorded before it,
 *   and they count as Injected.
 * - Sizes are the UTF-8 bytes of each record as serialised, at {@link CHARS_PER_TOKEN}. The groups
 *   are the window's intake over its life (a compaction's dropped records included), so a surface
 *   reads them as shares of tokens used, not as a second total.
 * - Subagent (`isSidechain`) lines are another window's and are left out; the harness's own
 *   bookkeeping records (`last-prompt`, queue logs and kin) are not content and are not counted.
 */
import { isCount, isRecord, jsonLines, SYNTHETIC, type JsonRecord } from "./transcript.js";

/** Characters per token for the conversion from bytes (0.2 ADR-0330 D1's calibration). */
export const CHARS_PER_TOKEN = 3.8;

export type CompositionGroup = "injected" | "grounding" | "implementation" | "other";

/** A reading's composition: estimated tokens per group, and the labels the table did not know. */
export type Composition = Readonly<Record<CompositionGroup, number>> & {
  /** Labels that fell to Other because nothing sorts them: `attachment:<type>`, `block:<type>`, `tool:<name>`, `tool_result:unmatched`. */
  readonly unsorted: readonly string[];
  readonly charsPerToken: number;
};

/** Attachment types the harness labels, by group. An absent type is unsorted. */
const ATTACHMENT_GROUP: Readonly<Record<string, CompositionGroup>> = {
  nested_memory: "injected",
  skill_listing: "injected",
  agent_listing_delta: "injected",
  deferred_tools_delta: "injected",
  mcp_instructions_delta: "injected",
  command_permissions: "injected",
  hook_success: "injected",
  hook_additional_context: "injected",
  hook_non_blocking_error: "injected",
  total_tokens_reminder: "injected",
  batching_reminder_sent: "injected",
  silent_turn_reminder: "injected",
  date_change: "injected",
  auto_mode: "injected",
  edited_text_file: "injected",
  // Measured on this machine 2026-09-28 (Claude Code desktop), newer than 0.2's table.
  date: "injected",
  deferred_tools_record: "injected",
  environment: "injected",
  instructions: "injected",
  model: "injected",
  prompt_snapshot: "injected",
  remote_session_change: "injected",
  session_context: "injected",
  queued_command: "other",
};

/** Tools whose output is reading: files, searches, the web, subagent digests. */
const GROUNDING_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead", "WebFetch", "WebSearch", "Agent", "Task", "TaskOutput", "ToolSearch"]);
/** Tools that change things. */
const IMPLEMENTATION_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Tools whose input is a command line, sorted by the command's verbs. */
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** Leading words of a command that only reads. Any other command in a shell call makes it implementation. */
const READING_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "rg", "egrep", "ls", "dir", "find", "wc", "tree", "stat", "file", "pwd",
  "which", "where", "echo", "type", "diff", "jq", "sort", "uniq", "cut", "awk", "basename", "dirname", "realpath", "cd",
  "Get-Content", "Get-ChildItem", "Select-String", "Get-Item", "Select-Object", "Measure-Object", "Test-Path", "Set-Location",
]);
/** `git` / `gh` sub-commands that only read. */
const READING_GIT = new Set(["log", "show", "diff", "status", "blame", "grep", "ls-files", "rev-parse", "branch", "remote", "fetch", "worktree"]);
const READING_GH = new Set(["view", "list", "checks", "diff", "status"]);
/** `storytree` families and verbs that only read the library. */
const READING_STORYTREE = new Set(["read", "search", "show", "list", "links", "history", "noticeboard", "tree", "context", "own"]);
/** An MCP tool's last name part that says it reads. */
const READING_MCP = /(^|_)(read|search|list|get|open|find|show|query|fetch|notes?|page|text|screenshot|status|context|history)(_|$)/;

/** What a call does. `undefined` for a tool nothing sorts, which goes to Other and is named. */
export function callGroup(name: string, input: JsonRecord): CompositionGroup | undefined {
  if (GROUNDING_TOOLS.has(name)) return "grounding";
  if (IMPLEMENTATION_TOOLS.has(name)) return "implementation";
  if (SHELL_TOOLS.has(name)) return typeof input.command === "string" && readsOnly(input.command) ? "grounding" : "implementation";
  if (name.startsWith("mcp__") && READING_MCP.test(name.slice(name.lastIndexOf("__") + 2))) return "grounding";
  return undefined;
}

/** Does every command in `line` only read? A pipeline, `&&` chain or `;` list reads only if each part does. */
export function readsOnly(line: string): boolean {
  const parts = line.split(/\|\||&&|[|;\n]/).map((part) => part.trim()).filter((part) => part !== "");
  return parts.length > 0 && parts.every((part) => {
    const words = [...part.matchAll(/[^\s"']+|"[^"]*"|'[^']*'/g)].map(([word]) => word).filter((word) => !/^\w+=/.test(word));
    const [head, ...rest] = words;
    if (head === undefined || /[^2]>|^>/.test(part.replace(/2>&1|2>\/dev\/null|2>\$null/g, ""))) return false;
    const verb = head.replace(/\\/g, "/").slice(head.lastIndexOf("/") + 1);
    const args = rest.filter((word) => !word.startsWith("-"));
    if (verb === "sed") return !rest.some((word) => word.startsWith("-i"));
    if (verb === "git") return READING_GIT.has(args[0] ?? "");
    if (verb === "gh") return args[0] === "api" ? !rest.some((word) => /^(-X|--method)$/.test(word)) : READING_GH.has(args[1] ?? "");
    if (verb === "pnpm" || verb === "npx") return args[0] === "storytree" && storytreeReads(args.slice(1));
    if (verb === "storytree") return storytreeReads(args);
    return READING_COMMANDS.has(verb);
  });
}

function storytreeReads(args: readonly string[]): boolean {
  return args.some((word) => READING_STORYTREE.has(word)) && !args.some((word) => ["new", "edit", "retire", "close", "settle", "set"].includes(word));
}

/**
 * The composition of a Claude Code transcript, or `undefined` when it holds no own request to take
 * the system prompt and tool list from (the reading is then an absence anyway, 9.2).
 */
export function claudeCodeComposition(text: string): Composition | undefined {
  const records = jsonLines(text);
  if (records === "empty") return undefined;
  const { add, unknown, seen, unsorted, composition } = tally();
  const calls = new Map<string, CompositionGroup | undefined>();
  let floor: number | undefined;

  for (const record of records) {
    if (record.isSidechain === true) continue;
    const message = isRecord(record.message) ? record.message : undefined;
    if (floor === undefined && record.type === "assistant" && message !== undefined && message.model !== SYNTHETIC && isRecord(message.usage)) {
      const { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created } = message.usage;
      if (isCount(input)) {
        const resident = input + (isCount(read) ? read : 0) + (isCount(created) ? created : 0);
        floor = Math.max(0, resident - Math.ceil(seen() / CHARS_PER_TOKEN));
      }
    }
    if (record.type === "attachment") {
      const attachment = record.attachment;
      const type = isRecord(attachment) && typeof attachment.type === "string" ? attachment.type : "<untyped>";
      const group = Object.hasOwn(ATTACHMENT_GROUP, type) ? ATTACHMENT_GROUP[type] : undefined;
      if (group === undefined) unknown(`attachment:${type}`, attachment);
      else add(group, attachment);
      continue;
    }
    if (record.type !== "user" && record.type !== "assistant") continue;
    const content = message?.content;
    const spoken: CompositionGroup = record.isMeta === true ? "injected" : "other";
    if (typeof content === "string") { add(spoken, content); continue; }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const type = isRecord(block) && typeof block.type === "string" ? block.type : "<untyped>";
      if (!isRecord(block)) { unknown(`block:${type}`, block); continue; }
      if (type === "tool_use") {
        const name = typeof block.name === "string" ? block.name : "<unnamed>";
        const group = callGroup(name, isRecord(block.input) ? block.input : {});
        if (typeof block.id === "string") calls.set(block.id, group);
        if (group === undefined) unsorted.add(`tool:${name}`);
        add("implementation", block);
      } else if (type === "tool_result") {
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        if (id === undefined || !calls.has(id)) unknown("tool_result:unmatched", block);
        else add(calls.get(id) ?? "other", block);
      } else if (type === "text") {
        add(record.type === "assistant" ? "other" : spoken, block);
      } else if (type === "thinking" || type === "redacted_thinking") {
        add("other", block);
      } else {
        unknown(`block:${type}`, block);
      }
    }
  }
  return floor === undefined ? undefined : composition(floor);
}

/** Codex tools by the Claude Code tool that does the same, so one table sorts both. Shells are read by their command. */
const CODEX_TOOLS: Readonly<Record<string, string>> = {
  apply_patch: "Edit", view_image: "Read", web__run: "WebFetch", spawn_agent: "Agent", wait_agent: "TaskOutput",
};
const CODEX_SHELLS = new Set(["shell_command", "exec_command"]);
/** Items that are the session's own history, summarised or passed between agents: Other, and sorted. */
const CODEX_OTHER_ITEMS = new Set(["reasoning", "compaction", "agent_message"]);

/** What one Codex tool call does: a shell by its command's verbs, any other tool as its Claude Code twin. */
function codexToolGroup(name: string, args: JsonRecord): CompositionGroup | undefined {
  if (CODEX_SHELLS.has(name)) return callGroup("Bash", { command: args.command ?? args.cmd });
  const twin = CODEX_TOOLS[name] ?? (name.startsWith("mcp__") ? undefined : CODEX_TOOLS[name.slice(name.lastIndexOf("__") + 2)]);
  return callGroup(twin ?? name, args);
}

/**
 * An `exec` cell is a script calling `tools.<name>(…)`: it reads only if every call in it does,
 * changes things if any call does, and is unsorted when a call nothing sorts (or no call) decides it.
 */
function execGroup(source: string): { group: CompositionGroup | undefined; unsorted: string[] } {
  const starts = [...source.matchAll(/tools\.(\w+)\s*\(/g)];
  if (starts.length === 0) return { group: undefined, unsorted: ["tool:exec:script"] };
  const groups = starts.map((start, index) => {
    const name = start[1] ?? "";
    const body = source.slice(start.index, starts[index + 1]?.index);
    const literal = /["']?(?:command|cmd)["']?\s*:\s*("(?:[^"\\]|\\.)*")/.exec(body)?.[1];
    let command: unknown;
    try { command = literal === undefined ? undefined : JSON.parse(literal); } catch { command = undefined; }
    return { name, group: codexToolGroup(name, { command }) };
  });
  if (groups.some(({ group }) => group === "implementation")) return { group: "implementation", unsorted: [] };
  const unknown = groups.filter(({ group }) => group === undefined).map(({ name }) => `tool:${name}`);
  return unknown.length > 0 ? { group: undefined, unsorted: unknown } : { group: "grounding", unsorted: [] };
}

/**
 * The composition of a Codex rollout (Codex 0.155's shapes), or `undefined` when it holds no token
 * count to take the unrecorded floor from. Sorted as a Claude Code transcript is, by the labels
 * Codex writes: the session's `base_instructions` and `developer` messages are Injected, and so is
 * a `user` message the harness added (one Codex never recorded as the user's own `UserMessage`);
 * an `exec` cell by what its tool calls do, a `wait` by the cell it waits on, and an output by its
 * call. Codex has no request id: its first token count's input less the bytes recorded before it
 * is the tool list and world state it sent unrecorded, counted as Injected. Its bookkeeping
 * (`event_msg`, `world_state`, `turn_context`, `token_usage_record`, `compacted`) is not counted.
 */
export function codexComposition(text: string): Composition | undefined {
  const records = jsonLines(text);
  if (records === "empty") return undefined;
  const typed = new Set<string>();
  for (const record of records) {
    const item = isRecord(record.payload) && isRecord(record.payload.item) ? record.payload.item : undefined;
    if (record.type !== "event_msg" || item?.type !== "UserMessage" || !Array.isArray(item.content)) continue;
    for (const part of item.content) if (isRecord(part) && typeof part.text === "string" && part.text.trim() !== "") typed.add(part.text.trim());
  }
  const { add, unknown, seen, unsorted, composition } = tally();
  const calls = new Map<string, CompositionGroup | undefined>();
  const cells = new Map<string, CompositionGroup | undefined>();
  let floor: number | undefined;

  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : undefined;
    if (payload === undefined) continue;
    if (record.type === "session_meta") {
      const base = payload.base_instructions;
      if (base !== undefined) add("injected", isRecord(base) && typeof base.text === "string" ? base.text : base);
      continue;
    }
    if (record.type === "event_msg") {
      const usage = payload.type === "token_count" && isRecord(payload.info) ? payload.info.last_token_usage : undefined;
      if (floor === undefined && isRecord(usage) && isCount(usage.input_tokens)) floor = Math.max(0, usage.input_tokens - Math.ceil(seen() / CHARS_PER_TOKEN));
      continue;
    }
    if (record.type !== "response_item") continue;
    const type = typeof payload.type === "string" ? payload.type : "<untyped>";
    const id = typeof payload.call_id === "string" ? payload.call_id : undefined;
    if (type === "message") {
      const own = Array.isArray(payload.content) && payload.content.some((part) => isRecord(part) && typeof part.text === "string" && typed.has(part.text.trim()));
      add(payload.role === "developer" || (payload.role === "user" && !own) ? "injected" : "other", payload);
    } else if (type === "custom_tool_call" || type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "<unnamed>";
      let sorted: { group: CompositionGroup | undefined; unsorted: string[] };
      if (type === "custom_tool_call" && name === "exec") {
        sorted = execGroup(typeof payload.input === "string" ? payload.input : "");
      } else {
        let args: unknown;
        try { args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments; } catch { args = undefined; }
        const input = isRecord(args) ? args : {};
        const cell = name === "wait" && typeof input.cell_id === "string" ? input.cell_id : undefined;
        const group = cell !== undefined && cells.has(cell) ? cells.get(cell) : codexToolGroup(name, input);
        sorted = { group, unsorted: group === undefined ? [`tool:${name}`] : [] };
      }
      if (id !== undefined) calls.set(id, sorted.group);
      for (const label of sorted.unsorted) unsorted.add(label);
      add("implementation", payload);
    } else if (type === "custom_tool_call_output" || type === "function_call_output") {
      if (id === undefined || !calls.has(id)) { unknown("tool_result:unmatched", payload); continue; }
      const cell = /cell ID (\w+)/.exec(JSON.stringify(payload.output) ?? "")?.[1];
      if (cell !== undefined && !cells.has(cell)) cells.set(cell, calls.get(id));
      add(calls.get(id) ?? "other", payload);
    } else if (CODEX_OTHER_ITEMS.has(type)) {
      add("other", payload);
    } else {
      unknown(`item:${type}`, payload);
    }
  }
  return floor === undefined ? undefined : composition(floor);
}

/** A running count of bytes per group, and the labels nothing sorted. */
function tally() {
  const bytes: Record<CompositionGroup, number> = { injected: 0, grounding: 0, implementation: 0, other: 0 };
  const unsorted = new Set<string>();
  let seen = 0;
  const add = (group: CompositionGroup, value: unknown): void => {
    const size = Buffer.byteLength(JSON.stringify(value) ?? "");
    bytes[group] += size;
    seen += size;
  };
  const tokens = (group: CompositionGroup): number => Math.round(bytes[group] / CHARS_PER_TOKEN);
  return {
    add,
    unknown: (label: string, value: unknown): void => { unsorted.add(label); add("other", value); },
    seen: (): number => seen,
    unsorted,
    /** The groups in tokens, the unrecorded `floor` counted as Injected. */
    composition: (floor: number): Composition => ({
      injected: floor + tokens("injected"),
      grounding: tokens("grounding"),
      implementation: tokens("implementation"),
      other: tokens("other"),
      unsorted: [...unsorted].sort(),
      charsPerToken: CHARS_PER_TOKEN,
    }),
  };
}
