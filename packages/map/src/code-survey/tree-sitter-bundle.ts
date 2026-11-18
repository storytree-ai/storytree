// Capability 8 · Code survey
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { Plugin } from "esbuild";

import { treeSitterWasmFiles } from "./tree-sitter-wasm.js";

const real = (file: string): string => realpathSync.native(file);

export function embedTreeSitterWasm(): Plugin {
  return {
    name: "embed-tree-sitter-wasm",
    setup(build) {
      const source = real(fileURLToPath(new URL("./tree-sitter-wasm.ts", import.meta.url)));
      const files = treeSitterWasmFiles();
      const wasm = new Set([real(files.engine), real(files.python)]);
      if (build.initialOptions.format === "cjs") {
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
