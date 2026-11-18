// Capability 9 · Context readings
import { isCount, isRecord, jsonLines, SYNTHETIC, type JsonRecord } from "./transcript.js";

export const CHARS_PER_TOKEN = 3.8;

export type CompositionGroup = "injected" | "grounding" | "implementation" | "other";

export type Composition = Readonly<Record<CompositionGroup, number>> & {
  readonly unsorted: readonly string[];
  readonly charsPerToken: number;
};

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

const GROUNDING_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead", "WebFetch", "WebSearch", "Agent", "Task", "TaskOutput", "ToolSearch"]);
const IMPLEMENTATION_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const READING_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "rg", "egrep", "ls", "dir", "find", "wc", "tree", "stat", "file", "pwd",
  "which", "where", "echo", "type", "diff", "jq", "sort", "uniq", "cut", "awk", "basename", "dirname", "realpath", "cd",
  "Get-Content", "Get-ChildItem", "Select-String", "Get-Item", "Select-Object", "Measure-Object", "Test-Path", "Set-Location",
]);
const READING_GIT = new Set(["log", "show", "diff", "status", "blame", "grep", "ls-files", "rev-parse", "branch", "remote", "fetch", "worktree"]);
const READING_GH = new Set(["view", "list", "checks", "diff", "status"]);
const READING_STORYTREE = new Set(["read", "search", "show", "list", "links", "history", "noticeboard", "tree", "context", "processes", "own"]);
const READING_MCP = /(^|_)(read|search|list|get|open|find|show|query|fetch|notes?|page|text|screenshot|status|context|history)(_|$)/;

export function callGroup(name: string, input: JsonRecord): CompositionGroup | undefined {
  if (GROUNDING_TOOLS.has(name)) return "grounding";
  if (IMPLEMENTATION_TOOLS.has(name)) return "implementation";
  if (SHELL_TOOLS.has(name)) return typeof input.command === "string" && readsOnly(input.command) ? "grounding" : "implementation";
  if (name.startsWith("mcp__") && READING_MCP.test(name.slice(name.lastIndexOf("__") + 2))) return "grounding";
  return undefined;
}

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

export function claudeCodeComposition(text: string): Composition | undefined {
  return composed(text, claudeCodeCompositionFold());
}

export interface CompositionFold {
  add(record: JsonRecord): void;
  composition(): Composition | undefined;
}

function composed(text: string, fold: CompositionFold): Composition | undefined {
  const records = jsonLines(text);
  if (records === "empty") return undefined;
  for (const record of records) fold.add(record);
  return fold.composition();
}

export function claudeCodeCompositionFold({ subagent = false }: { subagent?: boolean } = {}): CompositionFold {
  const { add, unknown, seen, unsorted, composition } = tally();
  const calls = new Map<string, CompositionGroup | undefined>();
  let floor: number | undefined;

  const take = (record: JsonRecord): void => {
    if (record.isSidechain === true && !subagent) return;
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
      return;
    }
    if (record.type !== "user" && record.type !== "assistant") return;
    const content = message?.content;
    const spoken: CompositionGroup = record.isMeta === true ? "injected" : "other";
    if (typeof content === "string") { add(spoken, content); return; }
    if (!Array.isArray(content)) return;
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
  };
  return { add: take, composition: () => (floor === undefined ? undefined : composition(floor)) };
}

const CODEX_TOOLS: Readonly<Record<string, string>> = {
  apply_patch: "Edit", view_image: "Read", web__run: "WebFetch", spawn_agent: "Agent", wait_agent: "TaskOutput",
};
const CODEX_SHELLS = new Set(["shell_command", "exec_command"]);
const CODEX_OTHER_ITEMS = new Set(["reasoning", "compaction", "agent_message"]);

function codexToolGroup(name: string, args: JsonRecord): CompositionGroup | undefined {
  if (CODEX_SHELLS.has(name)) return callGroup("Bash", { command: args.command ?? args.cmd });
  const twin = CODEX_TOOLS[name] ?? (name.startsWith("mcp__") ? undefined : CODEX_TOOLS[name.slice(name.lastIndexOf("__") + 2)]);
  return callGroup(twin ?? name, args);
}

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

export function codexComposition(text: string): Composition | undefined {
  return composed(text, codexCompositionFold());
}

export function codexCompositionFold(): CompositionFold {
  const typed = new Set<string>();
  const { add, hold, unknown, seen, unsorted, composition } = tally();
  const said: { texts: string[]; size: number }[] = [];
  const calls = new Map<string, CompositionGroup | undefined>();
  const cells = new Map<string, CompositionGroup | undefined>();
  let floor: number | undefined;

  const take = (record: JsonRecord): void => {
    const payload = isRecord(record.payload) ? record.payload : undefined;
    if (payload === undefined) return;
    if (record.type === "session_meta") {
      const base = payload.base_instructions;
      if (base !== undefined) add("injected", isRecord(base) && typeof base.text === "string" ? base.text : base);
      return;
    }
    if (record.type === "event_msg") {
      const item = isRecord(payload.item) ? payload.item : undefined;
      if (item?.type === "UserMessage" && Array.isArray(item.content)) {
        for (const part of item.content) if (isRecord(part) && typeof part.text === "string" && part.text.trim() !== "") typed.add(part.text.trim());
      }
      const usage = payload.type === "token_count" && isRecord(payload.info) ? payload.info.last_token_usage : undefined;
      if (floor === undefined && isRecord(usage) && isCount(usage.input_tokens)) floor = Math.max(0, usage.input_tokens - Math.ceil(seen() / CHARS_PER_TOKEN));
      return;
    }
    if (record.type !== "response_item") return;
    const type = typeof payload.type === "string" ? payload.type : "<untyped>";
    const id = typeof payload.call_id === "string" ? payload.call_id : undefined;
    if (type === "message") {
      if (payload.role === "user") {
        const texts = Array.isArray(payload.content) ? payload.content.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text.trim()] : [])) : [];
        said.push({ texts, size: hold(payload) });
      } else {
        add(payload.role === "developer" ? "injected" : "other", payload);
      }
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
      if (id === undefined || !calls.has(id)) { unknown("tool_result:unmatched", payload); return; }
      const cell = /cell ID (\w+)/.exec(JSON.stringify(payload.output) ?? "")?.[1];
      if (cell !== undefined && !cells.has(cell)) cells.set(cell, calls.get(id));
      add(calls.get(id) ?? "other", payload);
    } else if (CODEX_OTHER_ITEMS.has(type)) {
      add("other", payload);
    } else {
      unknown(`item:${type}`, payload);
    }
  };
  const sorted = (): Partial<Record<CompositionGroup, number>> => {
    const held = { injected: 0, other: 0 };
    for (const { texts, size } of said) held[texts.some((text) => typed.has(text)) ? "other" : "injected"] += size;
    return held;
  };
  return { add: take, composition: () => (floor === undefined ? undefined : composition(floor, sorted())) };
}

const PIXELS_PER_TOKEN = 750;
const MOST_IMAGE_TOKENS = 4_800;

export function imageTokens(base64: string): number {
  const head = Buffer.from(base64.slice(0, 8_000), "base64");
  const size = pixelSize(head);
  return size === undefined ? MOST_IMAGE_TOKENS : Math.min(MOST_IMAGE_TOKENS, Math.ceil((size[0] * size[1]) / PIXELS_PER_TOKEN));
}

function pixelSize(head: Buffer): [number, number] | undefined {
  if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47) return [head.readUInt32BE(16), head.readUInt32BE(20)];
  if (head.length >= 10 && head.toString("latin1", 0, 3) === "GIF") return [head.readUInt16LE(6), head.readUInt16LE(8)];
  if (head.length >= 30 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") {
    const chunk = head.toString("latin1", 12, 16);
    if (chunk === "VP8X") return [1 + head.readUIntLE(24, 3), 1 + head.readUIntLE(27, 3)];
    if (chunk === "VP8 ") return [head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff];
    if (chunk === "VP8L") { const bits = head.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
  }
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) {
    for (let at = 2; at + 9 < head.length;) {
      if (head[at] !== 0xff) return undefined;
      const marker = head[at + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [head.readUInt16BE(at + 7), head.readUInt16BE(at + 5)];
      at += 2 + head.readUInt16BE(at + 2);
    }
  }
  return undefined;
}

function imageData(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "image" && isRecord(value.source) && typeof value.source.data === "string") return value.source.data;
  if (value.type === "input_image" && typeof value.image_url === "string" && value.image_url.startsWith("data:")) return value.image_url.slice(value.image_url.indexOf(",") + 1);
  return undefined;
}

function sizeOf(value: unknown): number {
  let images = 0;
  const text = JSON.stringify(value, (_key, inner: unknown) => {
    const data = imageData(inner);
    if (data === undefined) return inner;
    images += imageTokens(data) * CHARS_PER_TOKEN;
    return null;
  });
  return Buffer.byteLength(text ?? "") + images;
}

function tally() {
  const bytes: Record<CompositionGroup, number> = { injected: 0, grounding: 0, implementation: 0, other: 0 };
  const unsorted = new Set<string>();
  let seen = 0;
  const add = (group: CompositionGroup, value: unknown): void => {
    const size = sizeOf(value);
    bytes[group] += size;
    seen += size;
  };
  return {
    add,
    hold: (value: unknown): number => {
      const size = sizeOf(value);
      seen += size;
      return size;
    },
    unknown: (label: string, value: unknown): void => { unsorted.add(label); add("other", value); },
    seen: (): number => seen,
    unsorted,
    composition: (floor: number, held: Partial<Record<CompositionGroup, number>> = {}): Composition => {
      const tokens = (group: CompositionGroup): number => Math.round((bytes[group] + (held[group] ?? 0)) / CHARS_PER_TOKEN);
      return {
        injected: floor + tokens("injected"),
        grounding: tokens("grounding"),
        implementation: tokens("implementation"),
        other: tokens("other"),
        unsorted: [...unsorted].sort(),
        charsPerToken: CHARS_PER_TOKEN,
      };
    },
  };
}
