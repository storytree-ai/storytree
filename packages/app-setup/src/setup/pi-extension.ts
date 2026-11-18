// Capability 2 · Connect an agent
import { CLOSE_OUT_REMINDER, EDIT_GATE, PI_EXTENSION_SCRIPT, STORYTREE_TOOLS } from "@storytree/session-management";

import type { HookCommand } from "./hooks-config.js";

export const PI_BUILT_AGAINST = "1.1.0";

export function piEvents(): readonly (readonly [event: string, tools: string | null, flags: readonly string[], waits: boolean])[] {
  return [
    ["session_start", null, [], false],
    ["before_agent_start", null, [], true],
    ["tool_call", `^${STORYTREE_TOOLS}`, [], true],
    ["tool_call", "^bash$", [], false],
    ["tool_call", "^(write|edit)$", [EDIT_GATE], true],
    ["tool_result", "^(bash|write|edit)$", [], false],
    ["agent_end", null, [], false],
    ["agent_before_settle", null, [CLOSE_OUT_REMINDER], true],
    ["session_shutdown", null, [], false],
  ];
}

export function piExtension({ node, script }: HookCommand): string {
  return `// storytree's Pi extension, written by storytree's setup check: do not edit, the next setup check rewrites it.
// Removing storytree deletes it. Built against Pi ${PI_BUILT_AGAINST} (@earendil-works/pi-coding-agent).
import { spawn } from "node:child_process";

const NODE = ${JSON.stringify(node)};
${PI_EXTENSION_SCRIPT}${JSON.stringify(script)};
const EVENTS = ${JSON.stringify(piEvents())};
/** Fields of Pi's events the hook does not read, left out so a long run's messages are not copied to it. */
const UNREAD = ["messages", "content", "structuredContent", "systemPrompt", "systemPromptOptions", "details", "context", "entries"];
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
        const answer = await forward(event, ctx, flags, waits);
        // Pi replaces a settling run's entries with the answer's, so the ones it came with are kept ahead of the hook's.
        if (Array.isArray(event.entries) && Array.isArray(answer?.entries)) return { ...answer, entries: [...event.entries, ...answer.entries] };
        return answer;
      } catch {
        return undefined;
      }
    });
  }
}
`;
}
