// Capability 8 · Setup check.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { ConnectOptions } from "@storytree/library";

import { locateStorytree, readLibrary, storytreeHome } from "@storytree/project-and-caller";

export type StorytreeOpened =
  | { state: "running"; library: ConnectOptions }
  | { state: "opened"; library: ConnectOptions }
  | { state: "not running"; message: string };

export interface OpenOptions {
  readonly home?: string;
  readonly waitMs?: number;
}

export async function openStorytree(options: OpenOptions = {}): Promise<StorytreeOpened> {
  const home = options.home ?? storytreeHome();
  const dataDir = path.join(home, "pgdata");
  const deadline = Date.now() + (options.waitMs ?? 60_000);
  const setting = readLibrary(home);
  if (setting.location === "postgres") return { state: "running", library: { address: setting.address } };

  const now = locateStorytree({ dataDir });
  if (now.running) {
    while (!(await accepts(now.url))) {
      if (Date.now() >= deadline) return { state: "not running", message: "storytree is starting but its database isn't answering yet: try again in a moment" };
      await sleep(250);
    }
    return { state: "running", library: { url: now.url } };
  }

  const app = appRecord(home);
  if (app === undefined) {
    return { state: "not running", message: "storytree isn't running, and this machine has no record of how to open it: open the storytree app once" };
  }
  let failed: string | undefined;
  try {
    const child = spawn(app.command, app.args, { cwd: path.dirname(app.command), detached: true, stdio: "ignore" });
    child.on("error", (error) => (failed = error.message));
    child.unref();
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
  }
  while (failed === undefined && Date.now() < deadline) {
    await sleep(250);
    const at = locateStorytree({ dataDir });
    if (at.running && (await accepts(at.url))) return { state: "opened", library: { url: at.url } };
  }
  return {
    state: "not running",
    message: failed === undefined ? "storytree was opened but did not start in time: open the storytree app" : `storytree could not be opened (${failed}): open the storytree app`,
  };
}

function accepts(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port), timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function appRecord(home: string): { command: string; args: string[] } | undefined {
  try {
    const { command, args } = JSON.parse(readFileSync(path.join(home, "app.json"), "utf8")) as { command?: unknown; args?: unknown };
    if (typeof command !== "string" || command === "") return undefined;
    return { command, args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : [] };
  } catch {
    return undefined;
  }
}
