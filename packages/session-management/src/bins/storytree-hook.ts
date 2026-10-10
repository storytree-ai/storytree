/**
 * Capability 3 · Hooks. `storytree-hook <harness>`: the command Claude Code (`claude-code`) and Codex (`codex`) run by
 * themselves at session start, at each prompt, before and after each shell command, after each file
 * edit and subagent start, before each call to storytree's own tools, at the end of each turn, and
 * at session end, with the hook's input on stdin (capability 3 · Hooks, the Session management story).
 *
 * It always exits 0, and prints only what the prompt hook adds for the agent (the project's
 * definitions for the prompt's terms) and, at session start in a folder that isn't a storytree
 * project, the setup question for the agent to ask: whatever happens, the agent it runs beside is untouched. It
 * also never outlives DEADLINE_MS, whatever it is waiting on. With `--background` (Codex's hooks
 * before a shell command and at the end of a turn) it hands the writing to a copy of itself that it
 * leaves running, detached and with nothing of the harness's open, and exits at once. The look around
 * the machine a hook hands on, once a minute, goes the same way, to a copy run with `--upkeep` that
 * may run for UPKEEP_DEADLINE_MS.
 *
 * This module runs nothing by itself: an entry point calls hookCommand(), giving it what this story may not
 * import. The command setup registers is the app setup story's (packages/app-setup/src/bins/storytree-hook.ts),
 * which gives the gate before each edit the map's file-to-capability lookup; this story's own tests build
 * testing/storytree-hook.ts.
 */
import { spawn } from "node:child_process";

import type { DeclaredCapabilities } from "../claims/edit-gate.js";
import { DEADLINE_MS, runHook, statusLine, UPKEEP, UPKEEP_DEADLINE_MS } from "../hooks/index.js";

export type { DeclaredCapabilities };

/** Run the hook command for this process: its harness and flags in argv, the hook's input on stdin. */
export function hookCommand({ declaredCapabilities }: { declaredCapabilities?: DeclaredCapabilities } = {}): void {
  setTimeout(() => process.exit(0), process.argv.includes(UPKEEP) ? UPKEEP_DEADLINE_MS : DEADLINE_MS).unref();
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));

  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => (input += chunk));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    // `storytree-hook statusline`: Claude Code's status line (hooks/status-line.ts), printed with no newline.
    if (process.argv[2] === "statusline") {
      void statusLine(input).then((line) => process.stdout.write(line, () => process.exit(0)));
      return;
    }
    runHook({ argv: process.argv.slice(2), input, handOff, ...(declaredCapabilities === undefined ? {} : { declaredCapabilities }) }).then(
      (added) => (added === undefined ? process.exit(0) : process.stdout.write(added, () => process.exit(0))),
      () => process.exit(0),
    );
  });
}

/** Start this script again for `harness` with `flags`, detached, with `input` on its stdin, and resolve once it has the input. */
function handOff(harness: string, input: string, flags: readonly string[] = []): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1]!, harness, ...flags], { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true, shell: false });
    child.on("error", () => resolve());
    child.stdin.on("error", () => resolve());
    child.stdin.end(input, () => {
      child.unref();
      resolve();
    });
  });
}
