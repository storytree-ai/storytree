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
 * may run for UPKEEP_DEADLINE_MS. Every copy is started with `--handed`, so its time is read apart.
 *
 * However it exits, it records how long it took, and in which parts (hooks/timing.ts, ADR-1056 D1); the status line,
 * which is no hook event, is not timed.
 *
 * This module runs nothing by itself: an entry point calls hookCommand(), giving it what this story may not
 * import. The command setup registers is the app setup story's (packages/app-setup/src/bins/storytree-hook.ts),
 * which gives the gate before each edit the map's file-to-capability lookup; this story's own tests build
 * testing/storytree-hook.ts.
 */
import { spawn } from "node:child_process";

import { storytreeHome } from "@storytree/project-and-caller";

import type { DeclaredCapabilities } from "../claims/edit-gate.js";
import { AFTER_TOOL, BACKGROUND, DEADLINE_MS, HANDED, HookClock, recordHookTime, runHook, statusLine, UPKEEP, UPKEEP_DEADLINE_MS } from "../hooks/index.js";

export type { DeclaredCapabilities };

/** Run the hook command for this process: its harness and flags in argv, the hook's input on stdin. */
export function hookCommand({ declaredCapabilities, guardMs }: { declaredCapabilities?: DeclaredCapabilities; guardMs?: number } = {}): void {
  const clock = new HookClock();
  if (process.argv[2] !== "statusline") process.on("exit", () => recordHookTime(storytreeHome(), clock.reading(process.argv[2] ?? "", process.argv.slice(3))));
  setTimeout(() => process.exit(0), process.argv.includes(UPKEEP) ? UPKEEP_DEADLINE_MS : DEADLINE_MS).unref();
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));
  const [harness = "", ...flags] = process.argv.slice(2);
  const atOnce = handsOffAtOnce(harness, flags, process.env);
  // Claude Code stops such a hook by SIGTERM before it is done; it is not done until its copy has the input.
  if (atOnce) process.on("SIGTERM", () => undefined);

  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => (input += chunk));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    clock.add("startup", performance.now());
    // `storytree-hook statusline`: Claude Code's status line (hooks/status-line.ts), printed with no newline.
    if (process.argv[2] === "statusline") {
      void statusLine(input).then((line) => process.stdout.write(line, () => process.exit(0)));
      return;
    }
    if (atOnce) {
      void handOff(harness, input, flags.filter((flag) => flag !== BACKGROUND)).then(() => process.exit(0));
      return;
    }
    runHook({ argv: process.argv.slice(2), input, handOff, clock, ...(declaredCapabilities === undefined ? {} : { declaredCapabilities }), ...(guardMs === undefined ? {} : { guardMs }) }).then(
      (added) => (added === undefined ? process.exit(0) : process.stdout.write(added, () => process.exit(0))),
      () => process.exit(0),
    );
  });
}

/**
 * Whether Claude Code's hook hands its input to a copy of itself at once, deciding nothing first: its end hook, which
 * Claude Code cuts short at 1.5 s, and in a `claude -p` session (CLAUDE_CODE_ENTRYPOINT "sdk-…") every hook run after
 * a tool, which Claude Code stops by SIGTERM when the turn ends and its process exits, some 60 ms into its end-of-turn
 * hook. The copy, detached, outlives it and waits for the mod's note as the hook would have.
 */
function handsOffAtOnce(harness: string, flags: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (harness !== "claude-code" || flags.includes(HANDED)) return false;
  return flags.includes(BACKGROUND) || (flags.includes(AFTER_TOOL) && (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk"));
}

/** Start this script again for `harness` with `flags`, detached, with `input` on its stdin, and resolve once it has the input. */
function handOff(harness: string, input: string, flags: readonly string[] = []): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1]!, harness, ...flags, HANDED], { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true, shell: false });
    child.on("error", () => resolve());
    child.stdin.on("error", () => resolve());
    child.stdin.end(input, () => {
      child.unref();
      resolve();
    });
  });
}
