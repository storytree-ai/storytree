/**
 * Capability 2 · Listing and restarting services, contracts 2.1 and 2.2 (ADR-1180 D4). The host writes how each service
 * stands to `service-host/status.json` in this machine's storytree home, and the command line reads it there. A restart
 * by name is a file the command line leaves in `service-host/restart`, which the host takes on its next tick, so the
 * command line never signals another process; a stop is `service-host/stop`, which `services run` takes (contract 3.4). The status names the services the host mounted, so the listing can say when a
 * part switch has not taken in it (contract 2.4).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Service } from "../running/supervise.js";

/** How one service stood when the host last wrote, its times as ISO strings. */
export interface StatusService {
  readonly id: string;
  readonly run: Service["run"];
  readonly state: "running" | "waiting" | "failed";
  readonly pid?: number;
  readonly since: string;
  readonly nextAt?: string;
  readonly lastExit?: { readonly code: number | null; readonly signal: string | null };
  readonly lastLines: readonly string[];
}

/** What the host last wrote: its process, the factory commit it ran, and each service it runs. */
export interface Status {
  readonly pid: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stopped?: true;
  readonly factory: { readonly folder: string; readonly commit?: string };
  /** Every service the parts the host mounted declare, as `<part>/<service>`: what it can run until its next start. A host from before this was written leaves it out. */
  readonly declared?: readonly string[];
  readonly services: readonly StatusService[];
}

const folder = (home: string) => path.join(home, "service-host");
const restarts = (home: string) => path.join(folder(home), "restart");
/** A restart request's file name: the service's name with its slash a dot, which no part or service name holds. */
const requestFile = (id: string) => id.replace("/", ".");

/** Write `status` whole, so a reader never sees half of it. */
export function writeStatus(home: string, status: Status): void {
  mkdirSync(folder(home), { recursive: true });
  const file = path.join(folder(home), "status.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, file);
}

/** What the host last wrote, or nothing when no host has run here. */
export function readStatus(home: string): Status | undefined {
  try {
    return JSON.parse(readFileSync(path.join(folder(home), "status.json"), "utf8")) as Status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Whether the process `pid` still runs on this machine. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Ask the host to start `id` again. */
export function requestRestart(home: string, id: string): void {
  mkdirSync(restarts(home), { recursive: true });
  writeFileSync(path.join(restarts(home), requestFile(id)), new Date().toISOString());
}

const stopFile = (home: string) => path.join(folder(home), "stop");

/** Ask the running host to stop every service and exit 0, as a stop signal would: on Windows no signal reaches it unheard. */
export function requestStop(home: string): void {
  mkdirSync(folder(home), { recursive: true });
  writeFileSync(stopFile(home), new Date().toISOString());
}

/** Whether a stop was asked for since the last take; the request is removed as it is taken. */
export function takeStop(home: string): boolean {
  try {
    rmSync(stopFile(home));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The restarts asked for since the last take, each removed as it is taken. */
export function takeRestarts(home: string): string[] {
  let names: string[];
  try {
    names = readdirSync(restarts(home));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => !name.endsWith(".tmp")).map((name) => {
    rmSync(path.join(restarts(home), name));
    return name.replace(".", "/");
  });
}
