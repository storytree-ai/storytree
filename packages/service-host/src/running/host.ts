/**
 * Capability 1 · Running services, contract 1.1 (ADR-1180 D2, D4). The service host: it reads the services the parts it
 * stands on mount once, as it starts, and on each tick runs exactly those this machine's settings turn on, so turning
 * one on or off takes within seconds, takes the restarts asked for by name, and writes how each service stands. A part
 * switched on or off takes at the host's next start. Stopping it stops every service, as the supervisor stops them.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readServicesOn, readStandIns, storytreeHome } from "@storytree/project-and-caller";

import { takeRestarts, writeStatus, type Status } from "../listing/status.js";
import { mountedServices, type Declared } from "./declared.js";
import { startChild } from "./spawn.js";
import { realClock, Supervisor, type Child, type Clock } from "./supervise.js";

/** This package's own folder: the host whose package.json names the built-in parts it hosts. */
export const HOST_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** How often the host reads the settings and the restarts asked for. */
export const TICK_MS = 2_000;

export interface HostOptions {
  readonly home?: string;
  readonly hostDir?: string;
  readonly log?: (line: string) => void;
  readonly clock?: Clock;
  readonly tickMs?: number;
  readonly start?: (service: Declared, home: string, log: (line: string) => void) => Child;
}

/** A running service host. */
export interface RunningHost {
  readonly supervisor: Supervisor;
  /** Stop every service and the host's ticks; resolves when every child has ended. */
  stop(): Promise<void>;
}

/** The commit `folder` (the factory) is at, when it is a git checkout. */
function commitOf(folder: string): string | undefined {
  try {
    return execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** Start the service host for storytree home `home`. */
export function startHost({ home = storytreeHome(), hostDir = HOST_DIR, log = (line) => process.stdout.write(`${line}\n`), clock = realClock, tickMs = TICK_MS, start = startChild }: HostOptions = {}): RunningHost {
  const mounted = mountedServices(hostDir, home);
  for (const part of mounted.off) if (part.failed !== undefined) log(`service host: ${part.part} hosts no services: ${part.failed}`);
  const declared = new Map(mounted.services.map((service) => [service.id, service]));
  const factoryFolder = readStandIns(home).folder;
  const commit = commitOf(factoryFolder);
  const startedAt = new Date().toISOString();
  let stopped = false;
  const write = () => {
    const status: Status = {
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(stopped ? { stopped: true as const } : {}),
      factory: { folder: factoryFolder, ...(commit === undefined ? {} : { commit }) },
      services: supervisor.states().map(({ since, nextAt, ...state }) => ({ ...state, since: new Date(since).toISOString(), ...(nextAt === undefined ? {} : { nextAt: new Date(nextAt).toISOString() }) })),
    };
    writeStatus(home, status);
  };
  const supervisor = new Supervisor({ clock, log, start: (service) => start(declared.get(service.id)!, home, log), changed: () => write() });
  log(`service host: ${declared.size} service${declared.size === 1 ? "" : "s"} declared by the mounted parts${commit === undefined ? "" : `; factory at ${commit.slice(0, 12)}`}`);
  let cancel: () => void = () => {};
  const tick = () => {
    try {
      const on = new Set(readServicesOn(home));
      supervisor.set([...declared.values()].filter((service) => on.has(service.id)).map(({ id, run }) => ({ id, run })));
      for (const id of takeRestarts(home)) if (!supervisor.restart(id)) log(`service host: a restart of ${id} was asked for, but it is not a service running here`);
    } catch (error) {
      log(`service host: ${(error as Error).message}`);
    }
    write();
    if (!stopped) cancel = clock.after(tickMs, tick);
  };
  tick();
  return {
    supervisor,
    async stop() {
      stopped = true;
      cancel();
      await supervisor.stop();
      write();
    },
  };
}
