/**
 * Capability 8 · Code survey: the bytes of tree-sitter's engine and of each grammar the survey parses with, read from
 * the installed packages. A bundle never runs this file: embedTreeSitterWasm (tree-sitter-bundle.ts) puts the same
 * bytes in its place, inside the bundle.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/** Where each wasm file is, by the package that ships it. */
export function treeSitterWasmFiles(from: string | URL = import.meta.url): { readonly engine: string; readonly python: string } {
  const require = createRequire(from);
  return {
    engine: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    // The grammar's package maps no subpath, and its main is the native binding its install script would build.
    python: path.join(path.dirname(require.resolve("tree-sitter-python/package.json")), "tree-sitter-python.wasm"),
  };
}

/** The engine's wasm and the Python grammar's, as bytes. */
export async function treeSitterWasm(): Promise<{ readonly engine: Uint8Array; readonly python: Uint8Array }> {
  const files = treeSitterWasmFiles();
  const [engine, python] = await Promise.all([readFile(files.engine), readFile(files.python)]);
  return { engine, python };
}
