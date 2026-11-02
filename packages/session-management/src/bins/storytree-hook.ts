/**
 * Capability 3 · Hooks. `storytree-hook <harness>`: the command Claude Code (`claude-code`) and Codex (`codex`) run by
 * themselves at session start, at each prompt, before and after each shell command, after each file
 * edit and subagent start, before each call to storytree's own tools, at the end of each turn, and
 * at session end, with the hook's input on stdin (capability 3 · Hooks, the Session management story).
 *
 * It always exits 0, and prints only what the prompt hook adds for the agent (the project's
 * definitions for the prompt's terms) and, at session start in a folder that isn't a storytree
 * project, the setup question for the agent to ask: whatever happens, the agent it runs beside is untouched. It
 * also never outlives its deadline (hooks/deadlines.ts), whatever it is waiting on. With `--background` (Codex's hooks
 * before a shell command and at the end of a turn) it hands the writing to a copy of itself that it
 * leaves running, detached and with nothing of the harness's open, and exits at once. Claude Code's end hook, and in a
 * `claude -p` session each of its hooks after a tool, hand off so before anything else, deaf to the SIGTERM Claude Code
 * stops them with as its process exits (hooks/at-once.ts). The look around
 * the machine a hook hands on, once a minute, goes the same way, to a copy run with `--upkeep` that
 * may run for UPKEEP_DEADLINE_MS. Every copy is started with `--handed`, so its time is read apart.
 *
 * However it exits, it records how long it took, and in which parts (hooks/timing.ts, ADR-1056 D1); the status line,
 * which is no hook event, is not timed.
 *
 * This module runs nothing by itself: an entry point calls hookCommand(), giving it what this story may not
 * import. An entry point calls hooks/at-once.ts's deafIfHandingOffAtOnce() first and only then imports this module,
 * so a hook that hands off at once is deaf from its first statement, before the rest of the command loads. The command setup registers is the app setup story's (packages/app-setup/src/bins/storytree-hook.ts),
 * which gives the gate before each edit the map's file-to-capability lookup; this story's own tests build
 * testing/storytree-hook.ts.
 */
import { spawn } from "node:child_process";

import { storytreeHome } from "@storytree/project-and-caller";

import type { DeclaredCapabilities } from "../claims/edit-gate.js";
import { deafIfHandingOffAtOnce } from "../hooks/at-once.js";
import { limitOf } from "../hooks/learned-limits.js";
import { remoteLibrary } from "../hooks/remote-turn.js";
import { OBSERVE_STEP } from "../hooks/shell-edits.js";
import { atDeadline, BACKGROUND, HANDED, HookClock, hookDeadline, recordHookTime, runHook, statusLine, UPKEEP, UPKEEP_DEADLINE_MS } from "../hooks/index.js";

export type { DeclaredCapabilities };

/** Run the hook command for this process: its harness and flags in argv, the hook's input on stdin. */
export function hookCommand({ declaredCapabilities, guardMs }: { declaredCapabilities?: DeclaredCapabilities; guardMs?: number } = {}): void {
  const clock = new HookClock();
  if (process.argv[2] !== "statusline") process.on("exit", () => recordHookTime(storytreeHome(), clock.reading(process.argv[2] ?? "", process.argv.slice(3))));
  // A guard given longer than the hook may run (only a test gives one) is not cut off by the hook's own deadline.
  // At the deadline, what the hook has not yet written waits on this machine (3.14).
  setTimeout(() => {
    atDeadline();
    process.exit(0);
  }, Math.max(process.argv.includes(UPKEEP) ? UPKEEP_DEADLINE_MS : hookDeadline(process.argv.slice(3), limitOf(storytreeHome(), OBSERVE_STEP), remoteLibrary(storytreeHome())), guardMs ?? 0)).unref();
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));
  const [harness = "", ...flags] = process.argv.slice(2);
  // Claude Code stops such a hook by SIGTERM before it is done; an entry point that loads this module late is deaf already.
  const atOnce = deafIfHandingOffAtOnce();

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

/** The hook command as the part a hook entry mounts (ADR-1021): switched off with this story, an entry runs none of it (ADR-1095). */
export const HOOK_COMMANDS: readonly (typeof hookCommand)[] = [hookCommand];

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
