/**
 * Capability 2 · Build-time composition. An esbuild plugin that answers `import parts from "storytree:parts/<kind>"`
 * with a module importing each part the host's story packages' manifests name (capability 1) and exporting their
 * declarations as one list. The installed hosts are bundles that ship no node_modules, so the parts are composed at
 * build time rather than imported by a computed name at run time.
 */
import { storyParts } from "../manifests/manifests.js";

const NAMESPACE = "storytree-parts";

/** The slice of esbuild's plugin interface this uses, so the loader needs no esbuild of its own to run. */
export interface PartsPlugin {
  readonly name: string;
  setup(build: {
    onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void;
    onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; resolveDir: string; loader: "js" }): void;
  }): void;
}

/** The plugin for the host whose package.json is in `host`. */
export function partsPlugin({ host }: { readonly host: string }): PartsPlugin {
  return {
    name: "storytree-parts",
    setup(build) {
      build.onResolve({ filter: /^storytree:parts\/[\w-]+$/ }, (args) => ({ path: args.path.slice("storytree:parts/".length), namespace: NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const parts = storyParts(host, args.path);
        const imports = parts.map((part, index) => `import { ${part.export} as part${index} } from ${JSON.stringify(part.module)};`);
        const contents = `${imports.join("\n")}\nexport default [${parts.map((_, index) => `...part${index}`).join(", ")}];\n`;
        return { contents, resolveDir: host, loader: "js" };
      });
    },
  };
}
