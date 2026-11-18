// Capability 1 · Running services
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pluginServices, type ServiceHost } from "@storytree/plugin-loader";
import { readSettings } from "@storytree/project-and-caller";

import type { Declared } from "./declared.js";

export interface ChildSpec {
  readonly service: Declared;
  readonly home: string;
}

const ENTRY = fileURLToPath(import.meta.url);

export const STOP = "storytree:stop";

export function childArgs(spec: ChildSpec): string[] {
  return ["--import", import.meta.resolve("tsx"), ENTRY, JSON.stringify(spec)];
}

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

async function runChild(spec: ChildSpec): Promise<number> {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  process.on("message", (message) => { if (message === STOP) stop.abort(); });
  process.channel?.unref();
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
