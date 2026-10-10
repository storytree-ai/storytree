/**
 * Capability 1 · Lifecycle, contract 1.7 (ADR-0656 D1): asking the app to quit from outside, as the
 * tray's Quit does. The app can be controlled from outside (ADR-0656 D0), so agents testing it and
 * scripts that need its database never force-kill it.
 *
 * The request is a second start of the app, with `--quit`, from the record of how to open it
 * (app.json): the running app is handed the start and quits. A stopped app is never started. The
 * answer comes once the app's database has stopped (its owner record is gone), or says it is still
 * running when that takes longer than `waitMs`.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { locateApp, storytreeHome } from "@storytree/session-management";

export type QuitResult = { state: "quit" } | { state: "not running" } | { state: "still running" } | { state: "no record"; message: string };

export interface QuitOptions {
  /** The storytree home: STORYTREE_HOME, else ~/.storytree/0.3. */
  readonly home?: string;
  /** Whether the app is running. By default, Session management's reading of its owner or launch record (1.11). */
  readonly locate?: () => { running: boolean };
  /** Starts a program, detached. */
  readonly open?: (command: string, args: readonly string[]) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => number;
  /** How long to wait for the app to stop. By default, 60 s. */
  readonly waitMs?: number;
}

export async function quitApp(options: QuitOptions = {}): Promise<QuitResult> {
  const home = options.home ?? storytreeHome();
  const locate = options.locate ?? (() => locateApp(home));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = options.clock ?? Date.now;
  if (!locate().running) return { state: "not running" };

  let record: { command: string; args: string[] };
  try {
    const { command, args } = JSON.parse(readFileSync(path.join(home, "app.json"), "utf8")) as { command?: unknown; args?: unknown };
    if (typeof command !== "string" || command === "") throw new Error("it names no program");
    record = { command, args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : [] };
  } catch (error) {
    return { state: "no record", message: `storytree is running, but ${path.join(home, "app.json")} cannot say how to reach it (${error instanceof Error ? error.message : String(error)}): quit it from its tray icon` };
  }
  (options.open ?? openDetached)(record.command, [...record.args, "--quit"]);

  const deadline = clock() + (options.waitMs ?? 60_000);
  while (clock() < deadline) {
    await sleep(250);
    if (!locate().running) return { state: "quit" };
  }
  return { state: "still running" };
}

function openDetached(command: string, args: readonly string[]): void {
  // From the program's own folder: a process working in the storytree home would keep it busy.
  const child = spawn(command, args, { cwd: path.dirname(command), detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
