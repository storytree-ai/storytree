/**
 * Capability 8 · Code survey: tree-sitter's Python grammar loads from its bytes and parses, from source and from a
 * bundle built as the app's survey worker and the commands are, with no node_modules beside it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build, type BuildOptions } from "esbuild";
import { removeTemp } from "@storytree/test-waits";

import { embedTreeSitterWasm } from "./tree-sitter-bundle.js";
import { parsePython } from "./tree-sitter.js";

const PYTHON = "import os.path\nfrom .cart import Cart as Basket\n\n\ndef test_2_3_cart_keeps_items():\n    \"\"\"2.3 · the cart keeps its items\"\"\"\n    assert Basket()\n";

test("8.47 tree-sitter's Python grammar loads from its wasm bytes and parses a .py file's imports and definitions", async () => {
  const tree = await parsePython(PYTHON);
  const root = tree.rootNode;
  assert.equal(root.hasError, false);
  assert.deepEqual(root.namedChildren.map((node) => node?.type), ["import_statement", "import_from_statement", "function_definition"]);
  assert.equal(root.namedChildren[1]?.childForFieldName("module_name")?.text, ".cart");
  assert.equal(root.namedChildren[2]?.childForFieldName("name")?.text, "test_2_3_cart_keeps_items");
  tree.delete();
});

test("8.48 a bundle built with the survey's tree-sitter plugin carries the engine and the grammar in itself: as CommonJS, as the app's survey worker is, and as split ES modules, as the commands and hooks are, it parses a .py file from a folder with no node_modules", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "tree-sitter-bundle-"));
  try {
    const entry = path.join(folder, "entry.ts");
    const parser = fileURLToPath(new URL("./tree-sitter.js", import.meta.url)).replace(/\.js$/, ".ts");
    await writeFile(entry, `import { parsePython } from ${JSON.stringify(parser)};\nparsePython(${JSON.stringify(PYTHON)}).then((tree) => console.log(tree.rootNode.namedChildren.map((node) => node.type).join(",")));\n`);
    const common: BuildOptions = { entryPoints: { entry }, bundle: true, platform: "node", target: "node22", logLevel: "silent", plugins: [embedTreeSitterWasm()] };
    await build({ ...common, outdir: path.join(folder, "worker"), format: "cjs", outExtension: { ".js": ".cjs" } });
    await build({ ...common, outdir: path.join(folder, "commands"), format: "esm", splitting: true, chunkNames: "chunks/[name]-[hash]", outExtension: { ".js": ".mjs" } });
    for (const bundle of [path.join(folder, "worker", "entry.cjs"), path.join(folder, "commands", "entry.mjs")]) {
      const printed = execFileSync(process.execPath, [bundle], { cwd: folder, encoding: "utf8" }).trim();
      assert.equal(printed, "import_statement,import_from_statement,function_definition", bundle);
    }
  } finally {
    await removeTemp(folder);
  }
});
