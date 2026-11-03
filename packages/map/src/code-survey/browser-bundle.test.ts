/**
 * Capability 8 · Code survey: the map's index, which re-exports the survey and with it every language reader, bundles
 * for the browser as the desktop page bundles it (apps/desktop/src/renderer/page-build.ts), reaching no Node module.
 */
import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "esbuild";

const NODE_MODULES = new Set(builtinModules);

test("8.56 the map's index bundles for the browser, as the desktop page does, with no Node module reachable from it: a reader importing one goes red here, naming the import and its importer", async () => {
  const index = fileURLToPath(new URL("../index.ts", import.meta.url));
  const reached: string[] = [];
  const nodeModules: Plugin = {
    name: "node-modules",
    setup(bundle) {
      bundle.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith("node:") && !NODE_MODULES.has(args.path.split("/")[0] ?? "")) return undefined;
        reached.push(`${args.path} from ${path.relative(path.dirname(index), args.importer)}`);
        return { path: args.path, external: true };
      });
    },
  };
  await build({ entryPoints: [index], bundle: true, write: false, platform: "browser", format: "iife", target: "es2023", logLevel: "silent", plugins: [nodeModules] });
  assert.deepEqual(reached, []);
});
