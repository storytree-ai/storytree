// Capability 2 · Connect an agent
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installedCodexVersion } from "../connect/codex.js";
import { putCommandOnPath, removeCommand } from "../setup/command.js";
import { defaultHomes, registerHooks, removeHooks } from "../setup/hooks-config.js";

function main(): void {
  const [command] = process.argv.slice(2);
  const homes = defaultHomes();
  const onPath = { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() };

  if (command === "remove") {
    const removed = removeHooks(homes);
    console.log(`Claude Code: ${removed["claude-code"] === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Codex: ${removed.codex === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Cursor: ${removed.cursor === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Pi: ${removed.pi === "removed" ? "storytree's extension removed" : "no storytree extension"}`);
    console.log(`Antigravity CLI: ${removed.antigravity === "removed" ? "storytree's hooks removed" : "no storytree hooks"}`);
    console.log(`Status line: ${removed.statusLine === "removed" ? "storytree's removed" : "not storytree's, left as it is"}`);
    console.log(`storytree command: ${removeCommand(onPath) === "removed" ? "taken off the path" : "none of storytree's on the path"}`);
  } else if (command === "install") {
    const script = fileURLToPath(new URL("./storytree-hook.mjs", import.meta.url));
    if (!existsSync(script)) {
      console.error(`no hook command beside this one (${script}): build storytree first`);
      process.exit(1);
    }
    const report = registerHooks(homes, { node: process.execPath, script }, undefined, installedCodexVersion());
    console.log(`Claude Code: ${report["claude-code"]}`);
    console.log(`Codex: ${report.codex}${report.codex === "registered" ? " (run `codex` in a terminal once and trust storytree's hooks when it asks)" : ""}`);
    console.log(`Cursor: ${report.cursor}`);
    console.log(`Pi: ${report.pi}`);
    console.log(`Antigravity CLI: ${report.antigravity}`);
    console.log(`Claude Code status line: ${report.statusLine}`);
    console.log(`storytree command: ${putCommandOnPath(onPath, process.execPath, path.join(path.dirname(script), "storytree.mjs"))}`);
  } else {
    console.error("usage: storytree-setup install | remove");
    process.exit(2);
  }
}

main();
