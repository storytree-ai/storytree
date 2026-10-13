/**
 * Capability 2 · Build-time composition. An esbuild plugin that answers `import parts from "#parts/<kind>"` with a
 * module importing each part the host's story packages' manifests name (capability 1) and exporting their declarations
 * as one list. The host is the package of the file that imports it. The installed hosts are bundles that ship no
 * node_modules, so the parts are composed at build time rather than imported by a computed name at run time; run
 * unbundled, the host's package.json `imports` answers the same import (capability 3).
 */
import { hostOf, storyParts } from "../manifests/manifests.js";

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
      build.onResolve({ filter: /^#parts\/[\w-]+$/ }, (args) => ({ path: args.path.slice("#parts/".length), namespace: NAMESPACE, pluginData: hostOf(args.resolveDir) }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const host = String(args.pluginData);
        const parts = storyParts(host, args.path);
        const imports = parts.map((part, index) => `import { ${part.export} as part${index} } from ${JSON.stringify(part.module)};`);
        const contents = `${imports.join("\n")}\nexport default [${parts.map((_, index) => `...part${index}`).join(", ")}];\n`;
        return { contents, resolveDir: host, loader: "js" };
      });
    },
  };
}
