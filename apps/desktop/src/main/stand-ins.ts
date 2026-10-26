/**
 * Capability 1 · Lifecycle. The factory plugins standing in for switched-off parts, in the window (plugin loader capability 5,
 * question_5867f490cdd6: run-time loading). The main process composes them into its page answers, page channels and
 * surfaces as the command line composes its verbs, so a stand-in is mounted where its part was while that part is off.
 * The page is sandboxed and its script bundled, so it cannot read the factory: the preload asks for the stand-ins' page
 * channels, and a surface's view, an ES module the plugin exports, reaches the page over the window's own scheme,
 * which serves only a mounted stand-in's exported files.
 */
import { readFileSync } from "node:fs";

import type { SurfaceDeclaration } from "@storytree/app";
import type { PluginRecordKind } from "@storytree/library";
import { pluginExport, recordKinds, standIn, type StandIns } from "@storytree/plugin-loader/factory";
import { mount, offSaid, switchedOff, type Composition, type PartsGraph } from "@storytree/plugin-loader/switch";

import type { PageChannelMap, PagePart, PageStandIns } from "../page-operations.js";

/** The window's own scheme, which serves a stand-in's view modules to the page. */
export const PLUGIN_SCHEME = "storytree-plugin";

/** A surface, which a factory plugin's may give a view: a name its package.json exports, an ES module whose `mount(host, context)` draws it. */
export type WindowSurface = SurfaceDeclaration & { readonly view?: string };

/** The window's parts, as `#parts/<kind>` composes them. */
export interface WindowParts {
  readonly surfaces: Composition<WindowSurface>;
  readonly pageAnswers: Composition<PagePart>;
  readonly pageChannels: Composition<PageChannelMap>;
}

/**
 * The kinds of record the factory plugins the app mounts declare (ADR-1178 D3), for `graph`, `standIns` and `off`, which
 * the page's reads open each project with; each plugin whose kinds could not be read is logged as a stand-in that
 * failed is said.
 */
export function windowKinds(graph: PartsGraph, standIns: StandIns, off: readonly string[], log: (line: string) => void): PluginRecordKind[] {
  const { kinds, failed } = recordKinds(graph, standIns, off);
  const because = switchedOff(graph, off);
  for (const [part, why] of Object.entries(failed)) log(offSaid({ part, because: because.get(part) ?? part, failed: why }));
  return kinds;
}

/** What the window's scheme may serve: files of the factory's plugins standing in for a switched-off part. */
export interface Served {
  readonly folder?: string;
  readonly plugins: ReadonlySet<string>;
}

/**
 * The window's parts with the stand-ins `standIns` names composed in, what the page is offered of those `off` mounts,
 * and what the window's scheme serves.
 */
export function windowStandIns(parts: WindowParts, standIns: StandIns, off: readonly string[]): WindowParts & { page: PageStandIns; served: Served } {
  const surfaces = standIn(parts.surfaces, "surfaces", standIns);
  const pageAnswers = standIn(parts.pageAnswers, "pageAnswers", standIns);
  const pageChannels = standIn(parts.pageChannels, "pageChannels", standIns);
  const switched = switchedOff(surfaces.graph, off);
  const plugins = new Set(Object.entries(surfaces.standsIn ?? {}).filter(([, part]) => switched.has(part)).map(([plugin]) => plugin));
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

/** The declarations of `composition` a stand-in adds that are mounted when `off` names parts off, each with its plugin. */
function standing<Part>(composition: Composition<Part>, off: readonly string[]): { plugin: string; part: Part }[] {
  const mounted = new Set(mount(composition, off).mounted);
  const standsIn = composition.standsIn ?? {};
  return composition.parts.flatMap((part, index) => {
    const plugin = composition.owners[index]!;
    return Object.hasOwn(standsIn, plugin) && mounted.has(part) ? [{ plugin, part }] : [];
  });
}

/** The window scheme's answer to `url`: the file a mounted stand-in exports under that name, as JavaScript, or not found with why. */
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
