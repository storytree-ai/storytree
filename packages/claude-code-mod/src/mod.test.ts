/** The Claude Code mod: its hooks module, run against a stand-in for the engine's `$`, and the plugin folder its hosts load. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { BEAT_MS, DELIVERY_WAIT_MS, register, type Engine, type Input } from "../plugin/hooks/storytree.js";
import { FUNCTION_HOOKS, PLUGIN_FOLDER, SESSION_FILE } from "./index.mjs";

type Hook = (engine: Engine, e: Input, next: (e: Input) => Promise<unknown>) => Promise<unknown>;

/** The module registered, with an engine whose tool server answers as `answer` does, and what happened, in order. */
function loaded(answer: () => Promise<unknown> = async () => ({ content: [] }), after: Engine["clock"]["after"] = (ms, fn) => {
  const timer = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(timer) };
}) {
  const hooks = new Map<string, Hook>();
  register((event, hook) => void hooks.set(event, hook));
  const happened: string[] = [];
  const sent: { server: string; tool: string; args: Record<string, unknown> | undefined }[] = [];
  // The engine's own timers, its environment and the files the module wrote, standing in.
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const env = new Map<string, string>();
  const written = new Map<string, string>();
  let id = "session-1";
  const engine: Engine = {
    mcp: {
      call: async (server, tool, args) => {
        happened.push("delivered");
        sent.push({ server, tool, args });
        return answer();
      },
    },
    session: { id: async () => id, cwd: async () => "/work/start" },
    clock: {
      after,
      every: (ms, fn) => {
        const timer = { ms, fn, cancelled: false };
        timers.push(timer);
        return { cancel: () => void (timer.cancelled = true) };
      },
    },
    env: { get: async (name) => env.get(name) },
    fs: { write: async (file, text) => void written.set(file, text) },
  };
  /** Raise `event` with `e`; resolves with what the hooks beneath were given. */
  const raise = async (event: string, e: Input) => {
    const hook = hooks.get(`classic.${event}`);
    assert.ok(hook, `the module hooks classic.${event}`);
    let beneath: Input | undefined;
    await hook(engine, e, async (passed) => {
      happened.push("beneath");
      beneath = passed;
      return {};
    });
    // A delivery the chain did not wait for settles on its own.
    await new Promise((resolve) => setImmediate(resolve));
    return beneath;
  };
  /** Raise one of the engine's own events, `session.start` or `session.end`. */
  const own = async (event: string, e: Input) => {
    const hook = hooks.get(event);
    assert.ok(hook, `the module hooks ${event}`);
    await hook(engine, e, async () => ({}));
    await new Promise((resolve) => setImmediate(resolve));
  };
  /** Let a period of every live timer pass. */
  const tick = async () => {
    for (const timer of timers.filter((one) => !one.cancelled)) timer.fn();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { raise, own, tick, happened, sent, timers, env, written, become: (next: string) => void (id = next) };
}

const base = { session_id: "session-1", transcript_path: "/home/dev/.claude/projects/p/session-1.jsonl", cwd: "/work/site", permission_mode: "default" };

test("1.1 · Each recorded classic event reaches the tool server's hook_event tool before the settings hooks beneath it run; a storytree tool's PreToolUse and an unrecorded event are passed on untouched; a failed or slow delivery still runs the hooks beneath", { timeout: 20_000 }, async () => {
  // A prompt: its whole input, delivered before the foreground hook beneath looks for the tool's note.
  {
    const { raise, happened, sent } = loaded();
    const prompt = { ...base, hook_event_name: "UserPromptSubmit", prompt: "build it" };
    assert.deepEqual(await raise("UserPromptSubmit", prompt), prompt);
    assert.deepEqual(happened, ["delivered", "beneath"]);
    assert.deepEqual(sent, [{ server: "storytree", tool: "hook_event", args: { harness: "claude-code", input: prompt } }]);
  }
  // Each event a command hook records is delivered, once, and passed on as it came.
  {
    const { raise, sent } = loaded();
    const events: [string, Input][] = [
      ["SessionStart", { ...base, hook_event_name: "SessionStart", source: "startup" }],
      ["PostToolUse", { ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: {}, tool_use_id: "toolu_1" }],
      ["PostToolUse", { ...base, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "/work/site/a.ts" }, tool_response: {}, tool_use_id: "toolu_2" }],
      ["PostToolUseFailure", { ...base, hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "toolu_3", error: "exit 1" }],
      ["Stop", { ...base, hook_event_name: "Stop", stop_hook_active: false }],
      ["SessionEnd", { ...base, hook_event_name: "SessionEnd", reason: "other" }],
    ];
    for (const [event, e] of events) assert.deepEqual(await raise(event, e), e, event);
    assert.deepEqual(sent.map((one) => (one.args?.input as Input).hook_event_name), events.map(([event]) => event));
  }
  // Before a shell command: the input its command hook reads, rebuilt from the call's envelope, in the folder the session last named.
  {
    const { raise, sent } = loaded();
    await raise("SessionStart", { ...base, hook_event_name: "SessionStart", source: "startup" });
    const envelope = { tool: "Bash", tool_use_id: "toolu_4", command: "pnpm test", description: "Run the tests" };
    assert.deepEqual(await raise("PreToolUse", envelope), envelope);
    assert.deepEqual(sent.at(-1)?.args, {
      harness: "claude-code",
      input: { session_id: "session-1", transcript_path: base.transcript_path, cwd: "/work/site", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm test", description: "Run the tests" }, tool_use_id: "toolu_4" },
    });
  }
  // A storytree tool's PreToolUse (its command hook alone names the subagent asking) and an event no command hook records: passed on, never delivered.
  {
    const { raise, happened } = loaded();
    const claim = { tool: "mcp__storytree__claim", tool_use_id: "toolu_5", increment: "increment_1", reason: "x" };
    assert.deepEqual(await raise("PreToolUse", claim), claim);
    const read = { ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/work/site/a.ts" }, tool_response: {}, tool_use_id: "toolu_6" };
    assert.deepEqual(await raise("PostToolUse", read), read);
    assert.deepEqual(happened, ["beneath", "beneath"]);
  }
  // A delivery that fails, or never answers, still runs the hooks beneath: they record the event themselves.
  {
    const { raise, happened } = loaded(async () => {
      throw new Error("no tool hook_event on a server named storytree");
    });
    await raise("UserPromptSubmit", { ...base, hook_event_name: "UserPromptSubmit", prompt: "a" });
    assert.deepEqual(happened, ["delivered", "beneath"]);
  }
  {
    // The engine's clock, standing in: the bound it is asked for passes at once.
    const asked: number[] = [];
    const { raise, happened } = loaded(() => new Promise(() => undefined), (ms, fn) => {
      asked.push(ms);
      queueMicrotask(fn);
      return { cancel: () => undefined };
    });
    await raise("UserPromptSubmit", { ...base, hook_event_name: "UserPromptSubmit", prompt: "b" });
    assert.deepEqual(happened, ["delivered", "beneath"]);
    assert.deepEqual(asked, [DELIVERY_WAIT_MS], "the chain waits no longer than the delivery's bound");
  }
});

test("1.2 · From session.start the mod beats on its own timer for the session's current id, writes that id where STORYTREE_SESSION_FILE names, and at session.end reports the end; a /clear beats on under the new id, and a failed beat never fails the chain", async () => {
  const { own, tick, sent, timers, env, written, become } = loaded();
  const beats = () => sent.filter((one) => one.tool === "heartbeat").map((one) => one.args);
  env.set(SESSION_FILE, "/lanes/lane.session");
  await own("session.start", { cwd: "/work/start" });
  assert.deepEqual(written, new Map([["/lanes/lane.session", "session-1\n"]]), "its id, where the lane's runner reads it");
  assert.deepEqual(beats(), [{ session: "session-1", cwd: "/work/start" }], "a beat at once");
  assert.deepEqual(timers.map((one) => one.ms), [BEAT_MS], "then one on the engine's timer, whatever the session does");
  await tick();
  await tick();
  assert.equal(beats().length, 3);

  // A /clear ends the session's id, and the process beats on under the new one.
  await own("session.end", { reason: "clear", sessionId: "session-1" });
  assert.deepEqual(beats().at(-1), { session: "session-1", cwd: "/work/start", ended: true });
  become("session-2");
  await tick();
  assert.deepEqual(beats().at(-1), { session: "session-2", cwd: "/work/start" });

  // Its real end: the last word, and no beat after it.
  await own("session.end", { reason: "prompt_input_exit", sessionId: "session-2" });
  assert.deepEqual(beats().at(-1), { session: "session-2", cwd: "/work/start", ended: true });
  const count = beats().length;
  await tick();
  assert.equal(beats().length, count);

  // A reload starts the beat again with no second timer left running, and without the variable writes no file.
  const again = loaded(async () => {
    throw new Error("no tool heartbeat on a server named storytree");
  });
  await again.own("session.start", { cwd: "/work/start" });
  await again.own("session.start", { cwd: "/work/start" });
  await again.tick();
  assert.equal(again.timers.filter((one) => !one.cancelled).length, 1);
  assert.equal(again.written.size, 0);
});

test("2.1 · The package names a plugin folder Claude Code accepts: its manifest, and hooks.json naming the hooks module that exports register", async () => {
  const manifest = JSON.parse(readFileSync(path.join(PLUGIN_FOLDER, ".claude-plugin", "plugin.json"), "utf8")) as { name: string };
  assert.equal(manifest.name, "storytree");
  const hooks = JSON.parse(readFileSync(path.join(PLUGIN_FOLDER, "hooks", "hooks.json"), "utf8")) as { modules: string[] };
  assert.equal(hooks.modules.length, 1, "one hooks module");
  const module = (await import(pathToFileURL(path.join(PLUGIN_FOLDER, "hooks", hooks.modules[0]!)).href)) as { register?: unknown };
  assert.equal(typeof module.register, "function");
  assert.deepEqual(FUNCTION_HOOKS, { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" });
});
