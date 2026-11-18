// Capability 1 · Lifecycle
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { locateApp, storytreeHome } from "@storytree/project-and-caller";

export type QuitResult = { state: "quit" } | { state: "not running" } | { state: "still running" } | { state: "no record"; message: string };

export interface QuitOptions {
  readonly home?: string;
  readonly locate?: () => { running: boolean };
  readonly open?: (command: string, args: readonly string[]) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => number;
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
  const child = spawn(command, args, { cwd: path.dirname(command), detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
