/**
 * Capability 1 · Running services, contract 1.1 (ADR-1180 D1, D2). One service's own child process: it loads the
 * service from its plugin or its package, hands its start what a service is handed (its folder, this machine's
 * settings, a logger to its output, and the stop signal, which the host's SIGTERM fires), and exits once start returns:
 * 0 when it returned, 1 when it threw. Run as a file it is the child; imported, it gives the command that runs it.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pluginServices, type ServiceHost } from "@storytree/plugin-loader";
import { readSettings } from "@storytree/project-and-caller";

import type { Declared } from "./declared.js";

/** What the child is told: the service, and the storytree home whose settings it reads. */
export interface ChildSpec {
  readonly service: Declared;
  readonly home: string;
}

const ENTRY = fileURLToPath(import.meta.url);

/** The node arguments that run `spec`'s service in a child process of its own, loading TypeScript as this process does. */
export function childArgs(spec: ChildSpec): string[] {
  return ["--import", import.meta.resolve("tsx"), ENTRY, JSON.stringify(spec)];
}

/** The service `service` names, as its start. */
async function load(service: Declared): Promise<(host: ServiceHost) => Promise<void> | void> {
  const { from } = service;
  if ("plugin" in from) {
    const found = pluginServices(from.factory, from.plugin).find((one) => one.name === service.name);
    if (found === undefined) throw new Error(`${from.plugin} declares no service called ${service.name}`);
    return (host) => found.start(host);
  }
  const file = createRequire(path.join(from.host, "package.json")).resolve(from.module);
  const exported = (await import(pathToFileURL(file).href) as Record<string, { start?: unknown } | undefined>)[from.export];
  if (typeof exported?.start !== "function") throw new Error(`${from.module} exports no { start(host) } called ${from.export}`);
  const start = exported.start as (host: ServiceHost) => Promise<void> | void;
  return (host) => start.call(exported, host);
}

/** Run `spec`'s service until its start returns, the stop signal handed to it firing on SIGTERM. */
async function runChild(spec: ChildSpec): Promise<number> {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  // A service waiting only on its stop signal holds nothing open, and node would end it there: the child lives until start returns.
  const living = setInterval(() => {}, 2 ** 30);
  try {
    const start = await load(spec.service);
    await start({ folder: spec.service.folder, settings: readSettings(spec.home), log: (line) => process.stdout.write(`${line}\n`), stopping: stop.signal });
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    return 1;
  } finally {
    clearInterval(living);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === ENTRY) {
  process.exitCode = await runChild(JSON.parse(process.argv[2]!) as ChildSpec);
  process.exit();
}
