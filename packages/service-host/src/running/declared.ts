/**
 * Capability 1 · Running services, contract 1.1 (ADR-1180 D2). The services the host runs: each declared service of each
 * part `mount()` mounts, a built-in part's while it is on and the factory plugin's standing in for it while it is off,
 * named `<part>/<service>` by the part either stands as, and only those this machine's settings turn on. A part that
 * has left the base (voice) is in no host's parts, so one the setting names off is put in the graph as a part of its own,
 * standing on nothing, for its stand-in to mount. A stand-in whose services cannot be read mounts none, said with why.
 */
import { createRequire } from "node:module";
import path from "node:path";

import { CORE, hostOf, mount, partName, partsGraph, pluginServices, storyServices, type Composition, type ServiceRun, type SwitchedOff } from "@storytree/plugin-loader";
import { readPartsOff, readServicesOn, readStandIns, storytreeHome } from "@storytree/project-and-caller";

/** One service a mounted part declares, and where its code is: a built-in part's module and export, or a factory plugin. */
export interface Declared {
  /** `<part>/<service>`, as `settings set service` names it. */
  readonly id: string;
  readonly part: string;
  readonly name: string;
  readonly run: ServiceRun;
  /** The folder the service is handed as its own: its plugin's, or its package's. */
  readonly folder: string;
  readonly from: { readonly plugin: string; readonly factory: string } | { readonly module: string; readonly export: string; readonly host: string };
}

/** The services the parts mounted on this machine declare, each turned `on` or not here, and the parts left off with why. */
export interface Mounted {
  readonly services: readonly (Declared & { readonly on: boolean })[];
  readonly off: readonly SwitchedOff[];
}

/** The services the parts `hostDir` stands on mount, as the settings of storytree home `home` switch them and turn them on. */
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
    }
  }
  const composition: Composition<Declared> = { parts, owners, graph, standsIn, failed };
  const mounted = mount(composition, off);
  const on = new Set(readServicesOn(home));
  return { services: mounted.mounted.map((service) => ({ ...service, on: on.has(service.id) })), off: mounted.off };
}
