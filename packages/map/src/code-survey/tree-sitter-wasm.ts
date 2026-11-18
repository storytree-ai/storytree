// Capability 8 · Code survey
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export function treeSitterWasmFiles(from: string | URL = import.meta.url): { readonly engine: string; readonly python: string } {
  const require = createRequire(from);
  return {
    engine: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    python: path.join(path.dirname(require.resolve("tree-sitter-python/package.json")), "tree-sitter-python.wasm"),
  };
}

export async function treeSitterWasm(): Promise<{ readonly engine: Uint8Array; readonly python: Uint8Array }> {
  const files = treeSitterWasmFiles();
  const [engine, python] = await Promise.all([readFile(files.engine), readFile(files.python)]);
  return { engine, python };
}
