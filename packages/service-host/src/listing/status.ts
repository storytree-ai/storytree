// Capability 2 · Listing and restarting services
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Service } from "../running/supervise.js";

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

export interface Status {
  readonly pid: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stopped?: true;
  readonly factory: { readonly folder: string; readonly commit?: string };
  readonly hostDir?: string;
  readonly declared?: readonly string[];
  readonly services: readonly StatusService[];
}

const folder = (home: string) => path.join(home, "service-host");
const restarts = (home: string) => path.join(folder(home), "restart");
const requestFile = (id: string) => id.replace("/", ".");

export function writeStatus(home: string, status: Status): void {
  mkdirSync(folder(home), { recursive: true });
  const file = path.join(folder(home), "status.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, file);
}

export function readStatus(home: string): Status | undefined {
  try {
    return JSON.parse(readFileSync(path.join(folder(home), "status.json"), "utf8")) as Status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function requestRestart(home: string, id: string): void {
  mkdirSync(restarts(home), { recursive: true });
  writeFileSync(path.join(restarts(home), requestFile(id)), new Date().toISOString());
}

const stopFile = (home: string) => path.join(folder(home), "stop");

export function requestStop(home: string): void {
  mkdirSync(folder(home), { recursive: true });
  writeFileSync(stopFile(home), new Date().toISOString());
}

export function takeStop(home: string): boolean {
  try {
    rmSync(stopFile(home));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

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
