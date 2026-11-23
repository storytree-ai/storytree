// Capability 3 · Hooks
import { spawn } from "node:child_process";

import { storytreeHome } from "@storytree/project-and-caller";

import type { DeclaredCapabilities, ReadsCode } from "../claims/edit-gate.js";
import { deafIfHandingOffAtOnce } from "../hooks/at-once.js";
import { limitOf } from "../hooks/learned-limits.js";
import { remoteLibrary } from "../hooks/remote-turn.js";
import { OBSERVE_STEP } from "../hooks/shell-edits.js";
import { atDeadline, BACKGROUND, HANDED, HookClock, hookDeadline, recordHookTime, runHook, statusLine, UPKEEP, UPKEEP_DEADLINE_MS } from "../hooks/index.js";

export type { DeclaredCapabilities, ReadsCode };

export function hookCommand({ declaredCapabilities, readsCode, isCode, guardMs }: { declaredCapabilities?: DeclaredCapabilities; readsCode?: ReadsCode; isCode?: ReadsCode; guardMs?: number } = {}): void {
  const clock = new HookClock();
  if (process.argv[2] !== "statusline") process.on("exit", () => recordHookTime(storytreeHome(), clock.reading(process.argv[2] ?? "", process.argv.slice(3))));
  setTimeout(() => {
    atDeadline();
    process.exit(0);
  }, Math.max(process.argv.includes(UPKEEP) ? UPKEEP_DEADLINE_MS : hookDeadline(process.argv.slice(3), limitOf(storytreeHome(), OBSERVE_STEP), remoteLibrary(storytreeHome())), guardMs ?? 0)).unref();
  process.on("uncaughtException", () => process.exit(0));
  process.on("unhandledRejection", () => process.exit(0));
  const [harness = "", ...flags] = process.argv.slice(2);
  const atOnce = deafIfHandingOffAtOnce();

  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => (input += chunk));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    clock.add("startup", performance.now());
    if (process.argv[2] === "statusline") {
      void statusLine(input).then((line) => process.stdout.write(line, () => process.exit(0)));
      return;
    }
    if (atOnce) {
      void handOff(harness, input, flags.filter((flag) => flag !== BACKGROUND)).then(() => process.exit(0));
      return;
    }
    runHook({ argv: process.argv.slice(2), input, handOff, clock, ...(declaredCapabilities === undefined ? {} : { declaredCapabilities }), ...(readsCode === undefined ? {} : { readsCode }), ...(isCode === undefined ? {} : { isCode }), ...(guardMs === undefined ? {} : { guardMs }) }).then(
      (added) => (added === undefined ? process.exit(0) : process.stdout.write(added, () => process.exit(0))),
      () => process.exit(0),
    );
  });
}

export const HOOK_COMMANDS: readonly (typeof hookCommand)[] = [hookCommand];

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
