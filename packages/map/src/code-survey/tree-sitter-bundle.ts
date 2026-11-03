/**
 * Capability 8 · Code survey: the esbuild plugin every bundle that holds the code survey is built with. It copies
 * tree-sitter's wasm into the bundle at build time, as bytes in place of tree-sitter-wasm.ts, so the bundle needs no
 * node_modules and reads no file beside itself; and a CommonJS bundle (the app's survey worker) gets the engine's
 * CommonJS build, whose ES module build needs an import.meta.url a CommonJS bundle has not got.
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { Plugin } from "esbuild";

import { treeSitterWasmFiles } from "./tree-sitter-wasm.js";

const real = (file: string): string => realpathSync.native(file);

/** The plugin: give it to every esbuild build whose bundle holds the code survey. */
export function embedTreeSitterWasm(): Plugin {
  return {
    name: "embed-tree-sitter-wasm",
    setup(build) {
      const source = real(fileURLToPath(new URL("./tree-sitter-wasm.ts", import.meta.url)));
      const files = treeSitterWasmFiles();
      const wasm = new Set([real(files.engine), real(files.python)]);
      if (build.initialOptions.format === "cjs") {
        // Resolved as `require` resolves it, by the package's "require" condition.
        const commonjs = createRequire(import.meta.url).resolve("web-tree-sitter");
        build.onResolve({ filter: /^web-tree-sitter$/ }, () => ({ path: real(commonjs) }));
      }
      build.onLoad({ filter: /[\\/]tree-sitter-wasm\.ts$/ }, (args) => real(args.path) !== source ? undefined : {
        contents: `import engine from ${JSON.stringify(files.engine)};\nimport python from ${JSON.stringify(files.python)};\nexport async function treeSitterWasm() { return { engine, python }; }\n`,
        loader: "js",
      });
      build.onLoad({ filter: /\.wasm$/ }, async (args) => wasm.has(real(args.path)) ? { contents: await readFile(args.path), loader: "binary" } : undefined);
    },
  };
}
