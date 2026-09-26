/**
 * `storytree-mcp`: the storytree tool server (capability 6 · Agent tools, stories/agent-link.md),
 * which Claude Code or Codex starts for each session and talks to over stdin and stdout. It works
 * in the session's folder: Claude Code names it in CLAUDE_PROJECT_DIR, and both harnesses start
 * the server there. Nothing but the protocol is ever written to stdout.
 *
 * Each start is a session start, so it runs the setup check (capability 8) beside serving: it opens
 * storytree if it is closed and registers the hooks if they are missing, with the hook script that
 * was built beside this one (`storytree-hook.mjs`). The agent's part comes through check_setup.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { runSetupCheck, type HookCommand } from "../setup/index.js";
import { createAgentTools } from "../tools/index.js";

const folder = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const script = fileURLToPath(new URL("./storytree-hook.mjs", import.meta.url));
const hook: HookCommand | undefined = existsSync(script) ? { node: process.execPath, script } : undefined;
// The `storytree` command goes on the user's own path, beside the hooks (ADR-0643 D1, 8).
const command = { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() };
const tools = createAgentTools({ folder, env: process.env, setup: hook === undefined ? {} : { hook, command } });

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  void tools.close().finally(() => process.exit(0));
}
process.stdin.on("close", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);

await tools.server.connect(new StdioServerTransport());
void runSetupCheck({ folder, ...(hook === undefined ? {} : { hook, command }) }).catch(() => {
  // The setup check at start is best effort: check_setup says what is wrong when the agent asks.
});
