/**
 * Capability 8 · Setup check. `storytree-setup install | remove`: register storytree's hooks for Claude Code and Codex now,
 * outside any session, or take out exactly what storytree added (capability 8 · Setup check,
 * the app setup story). The hook registered is the `storytree-hook.mjs` built beside this script.
 * Claude Code's settings are CLAUDE_CONFIG_DIR's or ~/.claude's, Codex's CODEX_HOME's or ~/.codex's.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultHomes, putCommandOnPath, registerHooks, removeCommand, removeHooks } from "../setup/index.js";

/** Install or remove, as the command line says. */
function main(): void {
  const [command] = process.argv.slice(2);
  const homes = defaultHomes();
  const onPath = { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() };

  if (command === "remove") {
    const removed = removeHooks(homes);
    console.log(`Claude Code: ${removed["claude-code"] === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Codex: ${removed.codex === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Status line: ${removed.statusLine === "removed" ? "storytree's removed" : "not storytree's, left as it is"}`);
    console.log(`storytree command: ${removeCommand(onPath) === "removed" ? "taken off the path" : "none of storytree's on the path"}`);
  } else if (command === "install") {
    const script = fileURLToPath(new URL("./storytree-hook.mjs", import.meta.url));
    if (!existsSync(script)) {
      console.error(`no hook command beside this one (${script}): build storytree first`);
      process.exit(1);
    }
    const report = registerHooks(homes, { node: process.execPath, script });
    console.log(`Claude Code: ${report["claude-code"]}`);
    console.log(`Codex: ${report.codex}${report.codex === "registered" ? " (run `codex` in a terminal once and trust storytree's hooks when it asks)" : ""}`);
    console.log(`Claude Code status line: ${report.statusLine}`);
    console.log(`storytree command: ${putCommandOnPath(onPath, process.execPath, path.join(path.dirname(script), "storytree.mjs"))}`);
  } else {
    console.error("usage: storytree-setup install | remove");
    process.exit(2);
  }
}

main();
