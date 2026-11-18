// Capability 1 · Running services
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CORE, hostOf, mount, partName, partsGraph, pluginServices, storyServices, type Composition, type ServiceRun, type SwitchedOff } from "@storytree/plugin-loader";
import { readPartsOff, readServicesOn, readStandIns, storytreeHome } from "@storytree/project-and-caller";

export interface Declared {
  readonly id: string;
  readonly part: string;
  readonly name: string;
  readonly run: ServiceRun;
  readonly folder: string;
  readonly from: { readonly plugin: string; readonly factory: string } | { readonly module: string; readonly export: string; readonly host: string };
}

export interface Mounted {
  readonly services: readonly (Declared & { readonly on: boolean })[];
  readonly off: readonly SwitchedOff[];
}

export function mountedServices(hostDir: string, home: string = storytreeHome()): Mounted {
  const off = readPartsOff(home);
  const graph: Record<string, readonly string[]> = { ...partsGraph(hostDir) };
  for (const part of off) if (!Object.hasOwn(graph, part) && !CORE.includes(part)) graph[part] = [];
  const require = createRequire(path.join(hostDir, "package.json"));
  const parts: Declared[] = storyServices(hostDir).map((service) => ({
    id: `${partName(service.package)}/${service.name}`,
    part: partName(service.package),
    name: service.name,
    run: service.run,
    folder: hostOf(path.dirname(require.resolve(service.module))),
    from: { module: service.module, export: service.export, host: hostDir },
  }));
  const owners = parts.map((service) => service.part);
  const fromPlugin: (string | undefined)[] = parts.map(() => undefined);
  const standsIn: Record<string, string> = {};
  const failed: Record<string, string> = {};
  const standIns = readStandIns(home);
  for (const [part, plugin] of Object.entries(standIns.plugins)) {
    if (!Object.hasOwn(graph, part)) continue;
    let declared: ReturnType<typeof pluginServices>;
    try {
      declared = pluginServices(standIns.folder, plugin);
    } catch (error) {
      failed[part] = `its stand-in ${plugin}'s services could not be read: ${(error as Error).message}`;
      continue;
    }
    standsIn[plugin] = part;
    for (const service of declared) {
      parts.push({ id: `${part}/${service.name}`, part, name: service.name, run: service.run, folder: path.join(standIns.folder, "plugins", plugin), from: { plugin, factory: standIns.folder } });
      owners.push(plugin);
      fromPlugin.push(plugin);
    }
  }
  const composition: Composition<Declared> = { parts, owners, graph, standsIn, fromPlugin, failed };
  const mounted = mount(composition, off);
  const on = new Set(readServicesOn(home));
  return { services: mounted.mounted.map((service) => ({ ...service, on: on.has(service.id) })), off: mounted.off };
}

const ENTRY = fileURLToPath(import.meta.url);

export async function freshMountedServices(hostDir: string, home: string): Promise<Mounted> {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), ENTRY, hostDir, home], { encoding: "utf8", env: { ...process.env, STORYTREE_HOME: home }, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout.trim().split("\n").at(-1)!) as Mounted;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === ENTRY) {
  process.stdout.write(`\n${JSON.stringify(mountedServices(process.argv[2]!, process.argv[3]))}\n`);
}
