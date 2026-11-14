/**
 * Capability 1 · Forwards hook events through the tool server (the Claude Code mod, ADR-1056 D3, ADR-1076 D5, ADR-1216 D2). Claude Code runs
 * this module in a worker of its own for each session that loads the mod: no Node, no database, everything reached
 * through the engine's `$`. For each hook event storytree's command hooks record, it hands the event to the session's
 * already-connected tool server (`$.mcp`, its hook_event tool) and then lets the chain go on (`next(e)`).
 *
 * The chain of a classic hook event is [managed settings hooks, hooks modules, the other settings hooks]: storytree's
 * command hooks run beneath this module, after the tool server noted that it recorded the event, so they find the
 * note and stand down (session-management's hooks.ts); a delivery that fails or is slow leaves no note, and they
 * record the event as before. A hook here never fails the chain: a throw is skipped by the engine, and the hooks
 * beneath run in its place.
 *
 * Capability 1 also keeps the session's heartbeat (contract 1.2): from `session.start` it beats on the engine's own timer,
 * so a session that is merely quiet (a long test run) still beats and one that died stops, and at `session.end` it says
 * the session ended; at start it writes the session's id where a Mint lane's runner reads it.
 *
 * Capability 3 reports the session's live usage (`$.session.usage()`: context fill, rate-limit windows, cost) as a mod-only
 * hook event the command hooks never send: at each main-loop turn's end, with why the turn ended (contracts 3.1, 3.2), and
 * each minute while the figures move, so an idle or ended session sends none.
 *
 * In a pool lane (its runner sets STORYTREE_LANE_RUN), capability 1 also brings the lane the messages sent it while it runs (contract
 * 1.3, Session management's 4.49): its beats say it is a lane, so a message can be sent it; after each tool call it takes the
 * steers waiting from the tool server and adds them to the tool's result for the model (`additionalContext`), and at its turn's
 * end it takes a waiting follow-up and keeps the turn going with it (`block`, the Stop hook's re-prompt), as `claude -p` honours.
 *
 * The API is early access and moves between releases (read from Claude Code 2.1.284's own declarations), so this
 * module declares the little of `$` it uses rather than importing the build's types file.
 */

/** The part of the engine interface this module uses. */
export interface Engine {
  readonly mcp: { call(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown> };
  readonly session: { id(): Promise<string>; cwd(): Promise<string>; usage(): Promise<Usage> };
  readonly clock: { now(): Promise<number>; after(ms: number, fn: () => void): Timer; every(ms: number, fn: () => void): Timer };
  readonly env: { get(name: string): Promise<string | undefined> };
  readonly fs: { write(path: string, text: string): Promise<void> };
}

/** The session's figures, as Claude Code's status line has them: `tokens` and `percent` absent until a response reported them. */
export interface Usage {
  readonly startedAt: number;
  readonly context: { readonly tokens?: number; readonly window: number; readonly percent?: number };
  readonly rateLimits: readonly { readonly kind: string; readonly percentUsed: number; readonly resetsAt?: string }[];
  readonly cost?: { readonly usd: number };
}

/** One of the engine's timers. */
interface Timer {
  cancel(): void;
}

/** A classic hook event's input: its stdin as a command hook reads it, or for PreToolUse the tool call's envelope. */
export type Input = Record<string, unknown>;

/** How the module adds a hook: `on(event, hook)`, each hook `($, e, next)`. */
export type On = (event: string, hook: (engine: Engine, e: Input, next: (e: Input) => Promise<unknown>) => Promise<unknown>) => unknown;

/** The tool server, as the repository's .mcp.json names it, and its tool that takes a hook event (ADR-1056 D2). */
export const SERVER = "storytree";
export const HOOK_EVENT = "hook_event";

/** How long a delivery may hold the chain before the hooks beneath run anyway, and record the event themselves. */
export const DELIVERY_WAIT_MS = 2_000;

/** The tool server's tool that takes a session's heartbeat, and how often the mod beats: storytree reads three missed beats as stopped. */
export const HEARTBEAT = "heartbeat";
export const BEAT_MS = 20_000;

/** How often the mod looks at the session's usage between turns' ends, sending it only when a figure moved. */
export const USAGE_MS = 60_000;

/** The mod's own events, which no command hook sends: the session's usage measured, and a main-loop turn ended (ADR-1056 D3). */
export const USAGE_MEASURED = "UsageMeasured";
export const TURN_COMPLETE = "TurnComplete";

/** The tool server's tool a lane takes its waiting messages from (Session management's 3.60). */
export const LANE_MESSAGES = "lane_messages";

/** How long the lane waits for its messages before the tool's result or its turn's end goes on without them. */
export const MESSAGES_WAIT_MS = 5_000;

/** How long the session's end waits to say so: the whole end chain shares one short bound (1.5 s in 2.1.284). */
const END_WAIT_MS = 1_000;

/** The tools whose calls storytree's command hooks record, by event (as setup registers them, app-setup hooks-config.ts). */
const SHELL = ["Bash", "PowerShell"];
const RECORDED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  // Before a shell command, its start; a storytree tool's own PreToolUse is left to its command hook, whose input alone names the subagent asking.
  PreToolUse: SHELL,
  PostToolUse: ["Write", "Edit", "MultiEdit", "NotebookEdit", ...SHELL, "Agent", "Task"],
  PostToolUseFailure: SHELL,
};

/** The events this module forwards: every one storytree's command hooks record a line for. */
export const FORWARDED = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"] as const;

/** The events whose delivery the chain waits for before the hooks beneath run. */
const AWAITED: ReadonlySet<string> = new Set(["UserPromptSubmit", "SessionEnd"]);

export function register(on: On): void {
  // The newest folder and transcript a classic event's own input named: classic.PreToolUse gives neither.
  const seen: Seen = {};
  // Each event is named as a literal: the engine reads which events a module hooks from its source.
  on("classic.SessionStart", ($, e, next) => forward("SessionStart", $, e, next, seen));
  on("classic.SessionEnd", ($, e, next) => forward("SessionEnd", $, e, next, seen));
  on("classic.UserPromptSubmit", ($, e, next) => forward("UserPromptSubmit", $, e, next, seen));
  on("classic.PreToolUse", ($, e, next) => forward("PreToolUse", $, e, next, seen));
  // A pool lane's hooks also bring it the messages waiting for it (1.3): steers after a tool call, follow-ups at its turn's end.
  on("classic.PostToolUse", async ($, e, next) => steered($, e, await forward("PostToolUse", $, e, next, seen)));
  on("classic.PostToolUseFailure", async ($, e, next) => steered($, e, await forward("PostToolUseFailure", $, e, next, seen)));
  on("classic.Stop", async ($, e, next) => followedUp($, e, await forward("Stop", $, e, next, seen)));

  // The heartbeat: started at each load (a reload drops the old timer and starts this module's variables over), ended with the process.
  let beating: Timer | undefined;
  // The usage last sent, so the timer sends only what moved; and its timer, kept as the heartbeat's is.
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
    // After a /clear the process goes on under a new id, which the next beat reads; any other end is the process's.
    if (e.reason !== "clear") {
      beating?.cancel();
      beating = undefined;
      measuring?.cancel();
      measuring = undefined;
    }
    if (typeof e.sessionId === "string") await deliver($, HEARTBEAT, { session: e.sessionId, cwd: await $.session.cwd(), ended: true }, END_WAIT_MS);
    return next(e);
  });
  // A main-loop turn's end: its usage, and why it ended, waited for so a `claude -p` run's last turn is not lost. A subagent's turn sends nothing.
  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined && typeof e.turnId === "string" && typeof e.reason === "string") await measure($, measured, { turn_id: e.turnId, reason: e.reason });
    return next(e);
  });
}

/** The usage the mod last sent, as its text. */
interface Measured {
  last?: string;
}

/**
 * Send the session's usage: at a turn's end (`turn`, its id and why it ended) always, otherwise only when it moved since
 * the last send. Never throws.
 */
async function measure($: Engine, measured: Measured, turn?: { turn_id: string; reason: string }): Promise<void> {
  try {
    const [{ context, rateLimits, cost }, session, cwd, at] = await Promise.all([$.session.usage(), $.session.id(), $.session.cwd(), $.clock.now()]);
    const usage = { context, rateLimits, ...(cost === undefined ? {} : { cost }) };
    const text = JSON.stringify(usage);
    if (turn === undefined && text === measured.last) return;
    measured.last = text;
    // When it was measured, so two measurements alike are two events.
    const common = { session_id: session, cwd, measured_at: at, usage };
    const input = turn === undefined ? { ...common, hook_event_name: USAGE_MEASURED } : { ...common, hook_event_name: TURN_COMPLETE, ...turn };
    await deliver($, HOOK_EVENT, { harness: "claude-code", input }, DELIVERY_WAIT_MS);
  } catch {
    // The next turn's end, or the next minute, says the same.
  }
}

/** Whether the session is a pool lane's engine: its runner sets STORYTREE_LANE_RUN on every engine it starts. */
async function isLane($: Engine): Promise<boolean> {
  try {
    // Named as a literal: the engine reads which variables a module reads from its source.
    return Boolean(await $.env.get("STORYTREE_LANE_RUN"));
  } catch {
    return false;
  }
}

/** A tool call's `result` with the lane's waiting steers added for the model; outside a lane, or with none waiting, as it was. */
async function steered($: Engine, e: Input, result: unknown): Promise<unknown> {
  const text = await waiting($, e, "tool");
  if (text === undefined) return result;
  const answer = (result ?? {}) as { additionalContext?: string[] };
  return { ...answer, additionalContext: [...(answer.additionalContext ?? []), text] };
}

/** A turn's end `result` kept going by the lane's waiting follow-up (and any steer still waiting); otherwise as it was. */
async function followedUp($: Engine, e: Input, result: unknown): Promise<unknown> {
  const text = await waiting($, e, "stop");
  if (text === undefined) return result;
  const answer = (result ?? {}) as { block?: string };
  return { ...answer, block: answer.block === undefined ? text : `${answer.block}\n\n${text}` };
}

/** The text of the messages waiting for this lane that `at` takes, or undefined outside a lane, with none, or when the tool server is slow or out of reach. */
async function waiting($: Engine, e: Input, at: "tool" | "stop"): Promise<string | undefined> {
  if (!(await isLane($))) return undefined;
  try {
    const [session, cwd] = await Promise.all([$.session.id(), typeof e.cwd === "string" ? e.cwd : $.session.cwd()]);
    const answer = await ask($, LANE_MESSAGES, { session: typeof e.session_id === "string" ? e.session_id : session, cwd, at }, MESSAGES_WAIT_MS);
    const text = (answer as { content?: { type?: string; text?: unknown }[] } | undefined)?.content?.find((part) => part.type === "text")?.text;
    return typeof text === "string" && text !== "" ? text : undefined;
  } catch {
    return undefined;
  }
}

/** One beat for the session's current id, saying so when it is a lane's; never throws. */
async function beat($: Engine): Promise<void> {
  try {
    const [session, cwd, lane] = await Promise.all([$.session.id(), $.session.cwd(), isLane($)]);
    await deliver($, HEARTBEAT, { session, cwd, ...(lane ? { lane: true } : {}) }, DELIVERY_WAIT_MS);
  } catch {
    // The next beat says the same.
  }
}

/** Write the session's id to the file STORYTREE_SESSION_FILE names, when it names one (a Mint lane's runner reads it); never throws. */
async function reportSession($: Engine): Promise<void> {
  try {
    // Named as a literal: the engine reads which variables a module reads from its source.
    const file = await $.env.get("STORYTREE_SESSION_FILE");
    if (file) await $.fs.write(file, `${await $.session.id()}\n`);
  } catch {
    // The runner searches its log for the id instead.
  }
}

/** The newest folder and transcript the session's events named. */
interface Seen {
  cwd?: string;
  transcript_path?: string;
}

/** One event's hook: hand it to the tool server when storytree records it, then let the hooks beneath run. */
async function forward(event: (typeof FORWARDED)[number], $: Engine, e: Input, next: (e: Input) => Promise<unknown>, seen: Seen): Promise<unknown> {
  if (typeof e.cwd === "string") seen.cwd = e.cwd;
  if (typeof e.transcript_path === "string") seen.transcript_path = e.transcript_path;
  const input = event === "PreToolUse" ? await preToolUse($, e, seen) : recorded(event, e) ? e : undefined;
  if (input === undefined) return next(e);
  const delivering = deliver($, HOOK_EVENT, { harness: "claude-code", input }, DELIVERY_WAIT_MS);
  // The prompt's command hook runs in the foreground, and the end's is cut short: each looks for the tool's note at once, so it is
  // waited for. Every other event's command hook runs in the background and waits a moment for the note itself, so the agent never waits.
  if (AWAITED.has(event)) await delivering;
  return next(e);
}

/** Whether `e`, an event's whole input, is one storytree's command hooks record. */
function recorded(event: string, e: Input): boolean {
  const tools = RECORDED_TOOLS[event];
  return tools === undefined || (typeof e.tool_name === "string" && tools.includes(e.tool_name));
}

/** A PreToolUse's input as its command hook reads it, rebuilt from the tool call's envelope; undefined for a call storytree does not record here. */
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

/** Call the tool server's `tool` with `args`, waiting at most `waitMs`; never throws. */
async function deliver($: Engine, tool: string, args: Record<string, unknown>, waitMs: number): Promise<void> {
  // A failed delivery leaves no note, so the hooks beneath record the event.
  await ask($, tool, args, waitMs);
}

/** Call the tool server's `tool` with `args`, resolving with its answer, or undefined when it failed or took over `waitMs`; never throws. */
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
