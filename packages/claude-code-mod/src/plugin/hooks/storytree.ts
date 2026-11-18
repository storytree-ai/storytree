// Capability 1 · Forwards hook events through the tool server

export interface Engine {
  readonly mcp: { call(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown> };
  readonly session: { id(): Promise<string>; cwd(): Promise<string>; usage(): Promise<Usage> };
  readonly clock: { now(): Promise<number>; after(ms: number, fn: () => void): Timer; every(ms: number, fn: () => void): Timer };
  readonly env: { get(name: string): Promise<string | undefined> };
  readonly fs: { write(path: string, text: string): Promise<void> };
}

export interface Usage {
  readonly startedAt: number;
  readonly context: { readonly tokens?: number; readonly window: number; readonly percent?: number };
  readonly rateLimits: readonly { readonly kind: string; readonly percentUsed: number; readonly resetsAt?: string }[];
  readonly cost?: { readonly usd: number };
}

interface Timer {
  cancel(): void;
}

export type Input = Record<string, unknown>;

export type On = (event: string, hook: (engine: Engine, e: Input, next: (e: Input) => Promise<unknown>) => Promise<unknown>) => unknown;

export const SERVER = "storytree";
export const HOOK_EVENT = "hook_event";

export const DELIVERY_WAIT_MS = 2_000;

export const HEARTBEAT = "heartbeat";
export const BEAT_MS = 20_000;

export const USAGE_MS = 60_000;

export const USAGE_MEASURED = "UsageMeasured";
export const TURN_COMPLETE = "TurnComplete";

export const LANE_MESSAGES = "lane_messages";

export const MESSAGES_WAIT_MS = 5_000;

const END_WAIT_MS = 1_000;

const SHELL = ["Bash", "PowerShell"];
const RECORDED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  PreToolUse: SHELL,
  PostToolUse: ["Write", "Edit", "MultiEdit", "NotebookEdit", ...SHELL, "Agent", "Task"],
  PostToolUseFailure: SHELL,
};

export const FORWARDED = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"] as const;

const AWAITED: ReadonlySet<string> = new Set(["UserPromptSubmit", "SessionEnd"]);

export function register(on: On): void {
  const seen: Seen = {};
  // eslint-disable-next-line storytree/no-comments -- a refactor into a loop passes the tests but breaks real Claude Code
  // Each event is named as a literal: the engine reads which events a module hooks from its source.
  on("classic.SessionStart", ($, e, next) => forward("SessionStart", $, e, next, seen));
  on("classic.SessionEnd", ($, e, next) => forward("SessionEnd", $, e, next, seen));
  on("classic.UserPromptSubmit", ($, e, next) => forward("UserPromptSubmit", $, e, next, seen));
  on("classic.PreToolUse", ($, e, next) => forward("PreToolUse", $, e, next, seen));
  on("classic.PostToolUse", async ($, e, next) => steered($, e, await forward("PostToolUse", $, e, next, seen)));
  on("classic.PostToolUseFailure", async ($, e, next) => steered($, e, await forward("PostToolUseFailure", $, e, next, seen)));
  on("classic.Stop", async ($, e, next) => followedUp($, e, await forward("Stop", $, e, next, seen)));

  let beating: Timer | undefined;
  const measured: Measured = {};
  let measuring: Timer | undefined;
  on("session.start", async ($, e, next) => {
    beating?.cancel();
    beating = $.clock.every(BEAT_MS, () => void beat($));
    measuring?.cancel();
    measuring = $.clock.every(USAGE_MS, () => void measure($, measured));
    void beat($);
    await reportSession($);
    return next(e);
  });
  on("session.end", async ($, e, next) => {
    if (e.reason !== "clear") {
      beating?.cancel();
      beating = undefined;
      measuring?.cancel();
      measuring = undefined;
    }
    if (typeof e.sessionId === "string") await deliver($, HEARTBEAT, { session: e.sessionId, cwd: await $.session.cwd(), ended: true }, END_WAIT_MS);
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined && typeof e.turnId === "string" && typeof e.reason === "string") await measure($, measured, { turn_id: e.turnId, reason: e.reason });
    return next(e);
  });
}

interface Measured {
  last?: string;
}

async function measure($: Engine, measured: Measured, turn?: { turn_id: string; reason: string }): Promise<void> {
  try {
    const [{ context, rateLimits, cost }, session, cwd, at] = await Promise.all([$.session.usage(), $.session.id(), $.session.cwd(), $.clock.now()]);
    const usage = { context, rateLimits, ...(cost === undefined ? {} : { cost }) };
    const text = JSON.stringify(usage);
    if (turn === undefined && text === measured.last) return;
    measured.last = text;
    const common = { session_id: session, cwd, measured_at: at, usage };
    const input = turn === undefined ? { ...common, hook_event_name: USAGE_MEASURED } : { ...common, hook_event_name: TURN_COMPLETE, ...turn };
    await deliver($, HOOK_EVENT, { harness: "claude-code", input }, DELIVERY_WAIT_MS);
  } catch {}
}

async function isLane($: Engine): Promise<boolean> {
  try {
    // eslint-disable-next-line storytree/no-comments -- importing the name from a constant passes the tests but breaks real Claude Code
    // Named as a literal: the engine reads which variables a module reads from its source.
    return Boolean(await $.env.get("STORYTREE_LANE_RUN"));
  } catch {
    return false;
  }
}

async function steered($: Engine, e: Input, result: unknown): Promise<unknown> {
  const text = await waiting($, e, "tool");
  if (text === undefined) return result;
  const answer = (result ?? {}) as { additionalContext?: string[] };
  return { ...answer, additionalContext: [...(answer.additionalContext ?? []), text] };
}

async function followedUp($: Engine, e: Input, result: unknown): Promise<unknown> {
  const text = await waiting($, e, "stop");
  if (text === undefined) return result;
  const answer = (result ?? {}) as { block?: string };
  return { ...answer, block: answer.block === undefined ? text : `${answer.block}\n\n${text}` };
}

async function waiting($: Engine, e: Input, at: "tool" | "stop"): Promise<string | undefined> {
  if (!(await isLane($))) return undefined;
  try {
    const [session, cwd, now] = await Promise.all([typeof e.session_id === "string" ? e.session_id : $.session.id(), typeof e.cwd === "string" ? e.cwd : $.session.cwd(), $.clock.now()]);
    const answer = await ask($, LANE_MESSAGES, { session, cwd, at, before: now + MESSAGES_WAIT_MS }, MESSAGES_WAIT_MS);
    const text = (answer as { content?: { type?: string; text?: unknown }[] } | undefined)?.content?.find((part) => part.type === "text")?.text;
    return typeof text === "string" && text !== "" ? text : undefined;
  } catch {
    return undefined;
  }
}

async function beat($: Engine): Promise<void> {
  try {
    const [session, cwd, lane] = await Promise.all([$.session.id(), $.session.cwd(), isLane($)]);
    await deliver($, HEARTBEAT, { session, cwd, ...(lane ? { lane: true } : {}) }, DELIVERY_WAIT_MS);
  } catch {}
}

async function reportSession($: Engine): Promise<void> {
  try {
    // eslint-disable-next-line storytree/no-comments -- importing the name from a constant passes the tests but breaks real Claude Code
    // Named as a literal: the engine reads which variables a module reads from its source.
    const file = await $.env.get("STORYTREE_SESSION_FILE");
    if (file) await $.fs.write(file, `${await $.session.id()}\n`);
  } catch {}
}

interface Seen {
  cwd?: string;
  transcript_path?: string;
}

async function forward(event: (typeof FORWARDED)[number], $: Engine, e: Input, next: (e: Input) => Promise<unknown>, seen: Seen): Promise<unknown> {
  if (typeof e.cwd === "string") seen.cwd = e.cwd;
  if (typeof e.transcript_path === "string") seen.transcript_path = e.transcript_path;
  const input = event === "PreToolUse" ? await preToolUse($, e, seen) : recorded(event, e) ? e : undefined;
  if (input === undefined) return next(e);
  const delivering = deliver($, HOOK_EVENT, { harness: "claude-code", input }, DELIVERY_WAIT_MS);
  if (AWAITED.has(event)) await delivering;
  return next(e);
}

function recorded(event: string, e: Input): boolean {
  const tools = RECORDED_TOOLS[event];
  return tools === undefined || (typeof e.tool_name === "string" && tools.includes(e.tool_name));
}

async function preToolUse($: Engine, e: Input, seen: Seen): Promise<Input | undefined> {
  const { tool, tool_use_id: call, agentId: _loop, ...toolInput } = e;
  if (typeof tool !== "string" || typeof call !== "string" || !(RECORDED_TOOLS.PreToolUse ?? []).includes(tool)) return undefined;
  const [session, cwd] = await Promise.all([$.session.id(), seen.cwd === undefined ? $.session.cwd() : seen.cwd]);
  return {
    session_id: session,
    ...(seen.transcript_path === undefined ? {} : { transcript_path: seen.transcript_path }),
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: call,
  };
}

async function deliver($: Engine, tool: string, args: Record<string, unknown>, waitMs: number): Promise<void> {
  await ask($, tool, args, waitMs);
}

async function ask($: Engine, tool: string, args: Record<string, unknown>, waitMs: number): Promise<unknown> {
  let timer: Timer | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = $.clock.after(waitMs, () => resolve(undefined));
  });
  try {
    return await Promise.race([$.mcp.call(SERVER, tool, args).catch(() => undefined), late]);
  } catch {
    return undefined;
  } finally {
    timer?.cancel();
  }
}
