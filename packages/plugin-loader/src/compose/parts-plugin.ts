/**
 * Capability 2 · Build-time composition. An esbuild plugin that answers `import parts from "#parts/<kind>"` with a
 * module importing each part the host's story packages' manifests name (capability 1) and exporting their declarations
 * as one list, with the part each came from and the host's parts graph (a composition, capability 4). The host is the package of the file that imports it. The installed hosts are bundles that ship no
 * node_modules, so the parts are composed at build time rather than imported by a computed name at run time; run
 * unbundled, the host's package.json `imports` answers the same import (capability 3).
 */
import { createHash } from "node:crypto";

import { hostOf, partsGraph, storyParts } from "../manifests/manifests.js";
import { partName } from "../switch/switch.js";

const NAMESPACE = "storytree-parts";

/** The slice of esbuild's plugin interface this uses, so the loader needs no esbuild of its own to run. */
export interface PartsPlugin {
  readonly name: string;
  setup(build: {
    onResolve(options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path: string; namespace: string; pluginData: string }): void;
    onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string; pluginData?: unknown }) => { contents: string; resolveDir: string; loader: "js" }): void;
  }): void;
}

/** The plugin, for every host the bundle holds: each `#parts/<kind>` is composed for the package that imports it. */
export function partsPlugin(): PartsPlugin {
  return {
    name: "storytree-parts",
    setup(build) {
      // The module's path names its host as well as its kind: esbuild loads one module per path, and two hosts in one
      // bundle (the command line and the MCP server it carries) compose a kind each from their own dependencies. The
      // host is a hash of its folder, since a path esbuild names a chunk after holds no folder.
      build.onResolve({ filter: /^#parts\/[\w-]+$/ }, (args) => {
        const host = hostOf(args.resolveDir);
        const tag = createHash("sha256").update(host).digest("hex").slice(0, 12);
        return { path: `${args.path.slice("#parts/".length)}-${tag}`, namespace: NAMESPACE, pluginData: host };
      });
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const host = String(args.pluginData);
        const parts = storyParts(host, args.path.slice(0, args.path.lastIndexOf("-")));
        const imports = parts.map((part, index) => `import { ${part.export} as part${index} } from ${JSON.stringify(part.module)};`);
        const list = parts.map((_, index) => `...part${index}`).join(", ");
        const owners = parts.map((part, index) => `...part${index}.map(() => ${JSON.stringify(partName(part.package))})`).join(", ");
        const contents = `${imports.join("\n")}\nexport default { parts: [${list}], owners: [${owners}], graph: ${JSON.stringify(partsGraph(host))} };\n`;
        return { contents, resolveDir: host, loader: "js" };
      });
    },
  };
}
