/**
 * Capability 8 · Code survey: tree-sitter, the parser engine the survey reads a language other than JavaScript and
 * TypeScript with (arc_1cb3e3979611). web-tree-sitter's engine and the Python grammar are loaded as bytes, never
 * from a path beside the running code, so the survey parses alike from source, in the app's survey worker and in
 * the commands and hooks, an asar and Windows paths included. The engine and the grammar are pinned together in
 * package.json: a grammar loads only when its ABI is one its engine reads.
 */
import { Language, Parser, type Tree } from "web-tree-sitter";

import { treeSitterWasm } from "./tree-sitter-wasm.js";

let python: Promise<Language> | undefined;
let loaded: Language | undefined;

/** tree-sitter's Python grammar, its engine started first; loaded once. */
export function pythonLanguage(): Promise<Language> {
  python ??= treeSitterWasm().then(async (wasm) => {
    await Parser.init({ wasmBinary: wasm.engine });
    loaded = await Language.load(wasm.python);
    return loaded;
  });
  return python;
}

/** The syntax tree of a Python file's text. */
export async function parsePython(text: string): Promise<Tree> {
  await pythonLanguage();
  return parsePythonNow(text);
}

/** The syntax tree of a Python file's text, parsed at once: the grammar must have loaded ({@link pythonLanguage}), or it throws. */
export function parsePythonNow(text: string): Tree {
  if (loaded === undefined) throw new Error("tree-sitter's Python grammar is not loaded: await pythonLanguage() first");
  const parser = new Parser();
  try {
    parser.setLanguage(loaded);
    const tree = parser.parse(text);
    if (tree === null) throw new Error("tree-sitter parsed no tree");
    return tree;
  } finally {
    parser.delete();
  }
}
