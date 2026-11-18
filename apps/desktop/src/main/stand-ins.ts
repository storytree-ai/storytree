// Capability 8 · Page bridge
import { readFileSync } from "node:fs";

import type { SurfaceDeclaration } from "@storytree/app";
import type { PluginRecordKind } from "@storytree/library";
import { pluginExport, recordKinds, standIn, type StandIns } from "@storytree/plugin-loader/factory";
import { mount, offSaid, pluginAt, standInPlaces, switchedOff, type Composition, type PartsGraph } from "@storytree/plugin-loader/switch";

import type { PageChannelMap, PagePart, PageStandIns } from "../page-operations.js";

export const PLUGIN_SCHEME = "storytree-plugin";

export type WindowSurface = SurfaceDeclaration & { readonly view?: string };

export interface WindowParts {
  readonly surfaces: Composition<WindowSurface>;
  readonly pageAnswers: Composition<PagePart>;
  readonly pageChannels: Composition<PageChannelMap>;
}

export function windowKinds(graph: PartsGraph, standIns: StandIns, off: readonly string[], log: (line: string) => void): PluginRecordKind[] {
  const { kinds, failed } = recordKinds(graph, standIns, off);
  const because = switchedOff(graph, off);
  for (const [part, why] of Object.entries(failed)) log(offSaid({ part, because: because.get(part) ?? part, failed: why }));
  return kinds;
}

export function windowProjectRecords<Records>(records: Composition<Records>, standIns: StandIns, off: readonly string[]): Records[] {
  return mount(standIn(records, "projectRecords", standIns), off).mounted;
}

export interface Served {
  readonly folder?: string;
  readonly plugins: ReadonlySet<string>;
}

export function windowStandIns(parts: WindowParts, standIns: StandIns, off: readonly string[]): WindowParts & { page: PageStandIns; served: Served } {
  const surfaces = standIn(parts.surfaces, "surfaces", standIns);
  const pageAnswers = standIn(parts.pageAnswers, "pageAnswers", standIns);
  const pageChannels = standIn(parts.pageChannels, "pageChannels", standIns);
  const places = standInPlaces(surfaces.graph, off);
  const plugins = new Set(Object.entries(surfaces.standsIn ?? {}).filter(([, part]) => places.has(part)).map(([plugin]) => plugin));
  const views = standing(surfaces, off).flatMap(({ plugin, part }) =>
    part.view === undefined ? [] : [{ surface: part.id, url: `${PLUGIN_SCHEME}://factory/${encodeURIComponent(plugin)}/${part.view.replace(/^\.\//, "")}` }]);
  return {
    surfaces,
    pageAnswers,
    pageChannels,
    page: { channels: standing(pageChannels, off).map(({ part }) => part), views },
    served: { ...(standIns.folder === undefined ? {} : { folder: standIns.folder }), plugins },
  };
}

function standing<Part>(composition: Composition<Part>, off: readonly string[]): { plugin: string; part: Part }[] {
  const mounted = new Set(mount(composition, off).mounted);
  return composition.parts.flatMap((part, index) => {
    const plugin = pluginAt(composition, index);
    return plugin !== undefined && mounted.has(part) ? [{ plugin, part }] : [];
  });
}

export function pluginResponse(url: string, served: Served): Response {
  let file: string;
  try {
    file = pluginFile(url, served);
  } catch (error) {
    return new Response((error as Error).message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(readFileSync(file), { headers: { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*" } });
}

function pluginFile(url: string, served: Served): string {
  const { protocol, host, pathname } = new URL(url);
  if (protocol !== `${PLUGIN_SCHEME}:` || host !== "factory") throw new Error(`${url} is not a factory plugin's file`);
  const [plugin = "", ...rest] = pathname.slice(1).split("/").map(decodeURIComponent);
  if (!served.plugins.has(plugin)) throw new Error(`${plugin} stands in for no switched-off part`);
  return pluginExport(served.folder, plugin, `./${rest.join("/")}`);
}
