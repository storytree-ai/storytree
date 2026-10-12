/**
 * Capability 8 · Setup check. Storytree's Pi extension: Pi runs no hook command, only TypeScript extensions it loads from
 * `<agent dir>/extensions/` (PI_CODING_AGENT_DIR, else ~/.pi/agent), with no trust prompt at the user level.
 * So storytree's hook registration for Pi is one generated file there, `storytree.ts`, written whole: the
 * Node and hook script it runs, and a table of which of Pi's events it forwards, with which flags, and
 * whether Pi waits for the answer. It holds no storytree logic: it forwards each event, with the session's
 * id, folder and transcript, to `storytree-hook pi` (hooks/pi.ts in Session management reads it) and hands
 * Pi back what the hook prints, so the edit gate's `{block, reason}` refuses an edit. Pi blocks a tool whose
 * handler throws, so every handler catches everything and answers nothing.
 *
 * Built against Pi 1.1.0 (`@earendil-works/pi-coding-agent`), measured on the Mint box on 2026-10-12. When a
 * later Pi no longer loads it, Pi reports the extension's load error at startup and the session runs unwatched:
 * the setup check, run in that session, then says no storytree hook was received from it.
 */
import { EDIT_GATE, PI_EXTENSION_SCRIPT, STORYTREE_TOOLS } from "@storytree/session-management";

import type { HookCommand } from "./hooks-config.js";

/** Pi's version the extension was built against. */
export const PI_BUILT_AGAINST = "1.1.0";

/**
 * Each forwarded event: Pi's event, the tools it is for (a pattern on `toolName`, any when absent), the hook's
 * flags, and whether Pi waits for the hook and takes its answer. A hook Pi does not wait for runs on in its own
 * process, so it outlives a session that is quitting.
 */
export function piEvents(): readonly (readonly [event: string, tools: string | null, flags: readonly string[], waits: boolean])[] {
  return [
    ["session_start", null, [], false],
    // Once per run, before the model: its answer adds the definitions the prompt names (ADR-0636 D1).
    ["before_agent_start", null, [], true],
    // Before a call to storytree's own tools, so its line is there when the call reaches the tool server (6.68).
    ["tool_call", `^${STORYTREE_TOOLS}`, [], true],
    ["tool_call", "^bash$", [], false],
    // Before each file edit, waited for: an edit to a capability the session may not write is refused (ADR-0949 D3).
    ["tool_call", "^(write|edit)$", [EDIT_GATE], true],
    ["tool_result", "^(bash|write|edit)$", [], false],
    ["agent_end", null, [], false],
    ["session_shutdown", null, [], false],
  ];
}

/** The extension's whole text for `hook`: the same text for the same hook command, so registering again changes nothing. */
export function piExtension({ node, script }: HookCommand): string {
  return `// storytree's Pi extension, written by storytree's setup check: do not edit, the next setup check rewrites it.
// Removing storytree deletes it. Built against Pi ${PI_BUILT_AGAINST} (@earendil-works/pi-coding-agent).
import { spawn } from "node:child_process";

const NODE = ${JSON.stringify(node)};
${PI_EXTENSION_SCRIPT}${JSON.stringify(script)};
const EVENTS = ${JSON.stringify(piEvents())};
/** Fields of Pi's events the hook does not read, left out so a long run's messages are not copied to it. */
const UNREAD = ["messages", "content", "structuredContent", "systemPrompt", "systemPromptOptions", "details"];
const WAIT_MS = 10_000;

function forward(event, ctx, flags, waits) {
  const input = { ...event, hook_event_name: event.type, session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, transcript_path: ctx.sessionManager.getSessionFile?.() };
  for (const field of UNREAD) delete input[field];
  const child = spawn(NODE, [SCRIPT, "pi", ...flags], { stdio: [ "pipe", waits ? "pipe" : "ignore", "ignore" ], detached: !waits, windowsHide: true });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(input));
  if (!waits) return void child.unref();
  return new Promise((resolve) => {
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve(undefined); }, WAIT_MS);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve(out.trim() === "" ? undefined : JSON.parse(out)); } catch { resolve(undefined); }
    });
  });
}

export default function storytree(pi) {
  for (const [name, tools, flags, waits] of EVENTS) {
    const only = tools === null ? undefined : new RegExp(tools);
    pi.on(name, async (event, ctx) => {
      try {
        if (only !== undefined && !only.test(String(event.toolName))) return undefined;
        return await forward(event, ctx, flags, waits);
      } catch {
        return undefined;
      }
    });
  }
}
`;
}
