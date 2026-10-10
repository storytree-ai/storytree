/**
 * Capability 8 · Setup check. Opening storytree when it is closed. The storytree app records how it was started, in
 * `<storytree home>/app.json` (`{ "command": ..., "args": [...] }`), each time it starts; opening
 * storytree is starting that again, and waiting until its Postgres accepts connections.
 *
 * Waiting for the owner record alone is not enough: the app's Postgres writes where it will listen
 * before it starts listening, and a call made in between reads as "not running" (seen in the agent
 * link's live check). So storytree counts as up once its owner record is live and its port accepts
 * a connection.
 *
 * With the library set to a Cloud SQL instance (capability 10, ADR-0734), there is nothing to open:
 * the library is the instance, and reaching it (and saying plainly when it cannot be) is the
 * library's connection's job.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { ConnectOptions } from "@storytree/library";

import { locateStorytree, readLibrary, storytreeHome } from "@storytree/agent-link";

/** Where the library is once storytree is up (the local app's database, the Cloud SQL instance, or the Postgres address), or why it is not. */
export type StorytreeOpened =
  | { state: "running"; library: ConnectOptions }
  | { state: "opened"; library: ConnectOptions }
  | { state: "not running"; message: string };

export interface OpenOptions {
  /** The storytree home. By default, storytreeHome(). */
  readonly home?: string;
  /** How long to wait for storytree to come up once opened. By default, 60 s: a first start makes its database. */
  readonly waitMs?: number;
}

/** Open storytree if it is closed, and say where it listens, or why it isn't running. */
export async function openStorytree(options: OpenOptions = {}): Promise<StorytreeOpened> {
  const home = options.home ?? storytreeHome();
  const dataDir = path.join(home, "pgdata");
  const deadline = Date.now() + (options.waitMs ?? 60_000);
  const setting = readLibrary(home);
  if (setting.location === "cloudsql") return { state: "running", library: { cloudSql: { instance: setting.instance, user: setting.user } } };
  if (setting.location === "postgres") return { state: "running", library: { address: setting.address } };

  const now = locateStorytree({ dataDir });
  if (now.running) {
    // Running, as its owner record says; if it has only just started, it may not answer yet.
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
    // Started from its own program's folder: a process working in the storytree home would keep
    // Windows from ever removing it.
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

/** Whether the server at `url` accepts a connection within half a second. */
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

/** How the app was last started, as it recorded it; undefined when it never recorded it. */
function appRecord(home: string): { command: string; args: string[] } | undefined {
  try {
    const { command, args } = JSON.parse(readFileSync(path.join(home, "app.json"), "utf8")) as { command?: unknown; args?: unknown };
    if (typeof command !== "string" || command === "") return undefined;
    return { command, args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : [] };
  } catch {
    return undefined;
  }
}
