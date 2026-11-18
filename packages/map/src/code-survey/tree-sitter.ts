// Capability 8 · Code survey
import { Language, Parser, type Tree } from "web-tree-sitter";

import { treeSitterWasm } from "./tree-sitter-wasm.js";

let python: Promise<Language> | undefined;
let loaded: Language | undefined;

export function pythonLanguage(): Promise<Language> {
  python ??= treeSitterWasm().then(async (wasm) => {
    await Parser.init({ wasmBinary: wasm.engine });
    loaded = await Language.load(wasm.python);
    return loaded;
  });
  return python;
}

export async function parsePython(text: string): Promise<Tree> {
  await pythonLanguage();
  return parsePythonNow(text);
}

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
