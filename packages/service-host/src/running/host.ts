// Capability 1 · Running services
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readServicesOn, readStandIns, storytreeHome } from "@storytree/project-and-caller";

import { ownCodeVersion } from "../factory/own-code.js";
import { pnpmInstall, pullFactory, type Install } from "../factory/pull.js";
import { readStatus, takeRestarts, writeStatus, type Status } from "../listing/status.js";
import { freshMountedServices, mountedServices, type Declared } from "./declared.js";
import { startChild } from "./spawn.js";
import { realClock, Supervisor, type Child, type Clock } from "./supervise.js";

export const HOST_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function hostFolder(home: string, own: string = HOST_DIR): string {
  if (existsSync(path.join(own, "package.json"))) return own;
  const recorded = readStatus(home)?.hostDir;
  if (recorded !== undefined && existsSync(path.join(recorded, "package.json"))) return recorded;
  throw new Error("this storytree command is a build with no service host beside it, and no service host has run here to say where its own is: start one with `storytree services run` from storytree's checkout, or run this command there with `pnpm storytree`.");
}

export const TICK_MS = 2_000;

export const PULL_MS = 15 * 60_000;

export const RESTART = 3;

export interface HostOptions {
  readonly home?: string;
  readonly hostDir?: string;
  readonly log?: (line: string) => void;
  readonly clock?: Clock;
  readonly tickMs?: number;
  readonly start?: (service: Declared, home: string, log: (line: string) => void) => Child;
  readonly pullMs?: number;
  readonly install?: Install;
  readonly ownCode?: () => string | undefined;
  readonly exit?: (code: number) => void;
}

export interface RunningHost {
  readonly supervisor: Supervisor;
  stop(): Promise<void>;
}

function commitOf(folder: string): string | undefined {
  try {
    return execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function startHost({
  home = storytreeHome(), hostDir = HOST_DIR, log = (line) => process.stdout.write(`${line}\n`), clock = realClock, tickMs = TICK_MS, start = startChild,
  pullMs = PULL_MS, install = pnpmInstall, ownCode = () => ownCodeVersion(hostDir), exit = (code) => process.exit(code),
}: HostOptions = {}): RunningHost {
  const sayOff = (off: ReturnType<typeof mountedServices>["off"]) => {
    for (const part of off) if (part.failed !== undefined) log(`service host: ${part.part} hosts no services: ${part.failed}`);
  };
  const mounted = mountedServices(hostDir, home);
  sayOff(mounted.off);
  let declared = new Map(mounted.services.map((service) => [service.id, service]));
  const factoryFolder = readStandIns(home).folder;
  let commit = commitOf(factoryFolder);
  const began = ownCode();
  const startedAt = new Date().toISOString();
  let stopped = false;
  const write = () => {
    const status: Status = {
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(stopped ? { stopped: true as const } : {}),
      factory: { folder: factoryFolder, ...(commit === undefined ? {} : { commit }) },
      hostDir,
      declared: [...declared.keys()].sort(),
      services: supervisor.states().map(({ since, nextAt, ...state }) => ({ ...state, since: new Date(since).toISOString(), ...(nextAt === undefined ? {} : { nextAt: new Date(nextAt).toISOString() }) })),
    };
    writeStatus(home, status);
  };
  const supervisor = new Supervisor({ clock, log, start: (service) => start(declared.get(service.id)!, home, log), changed: () => write() });
  log(`service host: ${declared.size} service${declared.size === 1 ? "" : "s"} declared by the mounted parts${commit === undefined ? "" : `; factory at ${commit.slice(0, 12)}`}`);
  let cancel: () => void = () => {};
  let cancelPull: () => void = () => {};
  const apply = () => {
    const on = new Set(readServicesOn(home));
    supervisor.set([...declared.values()].filter((service) => on.has(service.id)).map(({ id, run }) => ({ id, run })));
  };
  const tick = () => {
    try {
      apply();
      for (const id of takeRestarts(home)) if (!supervisor.restart(id)) log(`service host: a restart of ${id} was asked for, but it is not a service running here`);
    } catch (error) {
      log(`service host: ${(error as Error).message}`);
    }
    write();
    if (!stopped) cancel = clock.after(tickMs, tick);
  };
  const restartMoved = async (plugins: readonly string[]) => {
    if (plugins.length === 0) return;
    let fresh: Awaited<ReturnType<typeof freshMountedServices>>;
    try {
      fresh = await freshMountedServices(hostDir, home);
    } catch (error) {
      log(`service host: the services could not be read again after the move, so every service keeps its code from before: ${(error as Error).message.split("\n")[0]}`);
      return;
    }
    if (stopped) return;
    sayOff(fresh.off);
    const running = new Set(supervisor.states().map((state) => state.id));
    declared = new Map(fresh.services.map((service) => [service.id, service]));
    apply();
    for (const service of declared.values()) {
      if (!running.has(service.id) || !("plugin" in service.from) || !plugins.includes(service.from.plugin)) continue;
      supervisor.restart(service.id, { run: service.run, because: "its code moved; starting it on the new code" });
    }
  };
  const stop = async () => {
    stopped = true;
    cancel();
    cancelPull();
    await supervisor.stop();
    write();
  };
  const keep = async () => {
    try {
      const pulled = await pullFactory(factoryFolder, install);
      if (stopped) return;
      if (!pulled.updated) log(`service host: the factory was not updated: ${pulled.reason}`);
      else if (pulled.moved) {
        commit = pulled.to;
        log(`service host: the factory moved from ${pulled.from.slice(0, 12)} to ${pulled.to.slice(0, 12)}${pulled.reinstalled ? ", reinstalled" : ""}; its plugins moved: ${pulled.plugins.length === 0 ? "none" : pulled.plugins.join(", ")}`);
        await restartMoved(pulled.plugins);
      }
    } catch (error) {
      log(`service host: the factory was not updated: ${(error as Error).message.split("\n")[0]}`);
    }
    if (stopped) return;
    const now = ownCode();
    if (began !== undefined && now !== undefined && now !== began) {
      log(`service host: its own code moved (${began} to ${now}); stopping every service and exiting ${RESTART}, to start again on the new code`);
      await stop();
      exit(RESTART);
      return;
    }
    write();
    cancelPull = clock.after(pullMs, () => void keep());
  };
  tick();
  cancelPull = clock.after(pullMs, () => void keep());
  return { supervisor, stop };
}
