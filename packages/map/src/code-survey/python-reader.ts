/**
 * Capability 8 · Code survey: the reader of Python, the survey's second language (arc_1cb3e3979611). A Python
 * file is `.py`; a test file is pytest's `test_*.py` or `*_test.py`, and `conftest.py` is test support.
 *
 * - A file's imports are read from tree-sitter's syntax tree, nested ones too, so a comment or a string is none.
 *   `import a.b` reaches a/b.py or a/b/__init__.py; `from a import y` reaches the submodule a/y.py or
 *   a/y/__init__.py, else a itself; `from a import *` reaches a. A relative import of level n climbs n-1 folders
 *   from the importing file's. A folder with no __init__.py is a namespace package. An absolute import is searched
 *   from the src/ of the package holding the file, then its root; outside every package, from src/, then the top.
 * - A file declares its capability by an opening `# Capability N · …`, after an optional shebang (ADR-0925 D1).
 * - A package's pyproject.toml names its project and the projects it depends on, by [project].dependencies and by
 *   the workspace sources of [tool.uv.sources], each name normalised as PEP 503 does.
 * Its test titles are the test join's, the arc's later increment, so it reads none yet.
 */
import { parse as parseToml } from "smol-toml";
import type { Node } from "web-tree-sitter";

import type { Edge, LanguageReader, SourceFile, SurveyPackage } from "./language-reader.js";
import { parsePythonNow, pythonLanguage } from "./tree-sitter.js";

/** A pytest test file, by its path. */
export const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

/** The opening comment's "Capability N · …", after a shebang: a comment that begins with it, before any code. */
const DECLARED = /^(?:#![^\n]*\n)?\s*#[ \t]*Capability\s+(\d+)\s*·[ \t]*([^\n]*)/;

/** A project's name as PEP 503 compares it: lower case, with runs of - _ . alike. */
export const normalisedName = (name: string): string => name.trim().toLowerCase().replace(/[-_.]+/g, "-");

/** The file a dotted module names under `root` (a folder with a trailing slash, or ""), if `paths` holds it. */
function moduleFile(root: string, parts: readonly string[], paths: ReadonlySet<string>): string | undefined {
  if (parts.length === 0) return paths.has(`${root}__init__.py`) ? `${root}__init__.py` : undefined;
  const base = root + parts.join("/");
  return [`${base}.py`, `${base}/__init__.py`].find((file) => paths.has(file));
}

/** Where an absolute import of `file` is searched: its package's src/, then its root; outside every package, src/, then the top. */
function searchRoots(file: string, packages: readonly SurveyPackage[]): string[] {
  const holding = packages.filter((pkg) => file.startsWith(pkg.root)).sort((a, b) => b.root.length - a.root.length)[0];
  const root = holding?.root ?? "";
  return [`${root}src/`, root];
}

/** A dotted_name node's parts. */
const partsOf = (node: Node | null): string[] => node === null ? [] : node.text.split(".").map((part) => part.trim()).filter(Boolean);

/** The parts a name in an import names: a dotted_name's, or an aliased_import's own name's. */
const importedParts = (node: Node): string[] => partsOf(node.type === "aliased_import" ? node.childForFieldName("name") : node);

/** The imports a Python file makes of files `paths` holds. */
function edgesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[] {
  const tree = parsePythonNow(file.text);
  try {
    const roots = searchRoots(file.path, packages);
    const found = new Set<string>();
    const absolute = (parts: readonly string[]) => roots.map((root) => moduleFile(root, parts, paths)).find((to) => to !== undefined);
    for (const node of tree.rootNode.descendantsOfType(["import_statement", "import_from_statement"])) {
      if (node.type === "import_statement") {
        for (const name of node.childrenForFieldName("name")) {
          const to = absolute(importedParts(name));
          if (to !== undefined) found.add(to);
        }
        continue;
      }
      const module = node.childForFieldName("module_name");
      if (module === null) continue;
      let from: (parts: readonly string[]) => string | undefined;
      let base: string[];
      if (module.type === "relative_import") {
        const level = module.children.find((child) => child.type === "import_prefix")?.text.length ?? 0;
        const folder = file.path.split("/").slice(0, -1);
        if (level - 1 > folder.length) continue;
        const start = folder.slice(0, folder.length - (level - 1));
        const root = start.length === 0 ? "" : `${start.join("/")}/`;
        from = (parts) => moduleFile(root, parts, paths);
        base = partsOf(module.namedChildren.find((child) => child.type === "dotted_name") ?? null);
      } else {
        from = absolute;
        base = partsOf(module);
      }
      const names = node.childrenForFieldName("name");
      // A wildcard, or a name that is no submodule, reaches the module itself.
      if (names.length === 0) {
        const to = from(base);
        if (to !== undefined) found.add(to);
      }
      for (const name of names) {
        const to = from([...base, ...importedParts(name)]) ?? from(base);
        if (to !== undefined) found.add(to);
      }
    }
    found.delete(file.path);
    return [...found].map((to) => ({ to, reexport: false, typeOnly: false, names: "all" }));
  } finally {
    tree.delete();
  }
}

/** The table at `keys` inside a TOML value, or nothing. */
const tableAt = (value: unknown, ...keys: string[]): Record<string, unknown> | undefined => {
  let at = value;
  for (const key of keys) at = typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === "object" && at !== null && !Array.isArray(at) ? at as Record<string, unknown> : undefined;
};

/** A PEP 508 requirement's project name: its leading name, before any extras, version or marker. */
const requirementName = (requirement: string): string | undefined => /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(requirement)?.[1];

/**
 * A pyproject.toml's project, as the survey reads a package: its name and the projects it depends on, both
 * normalised; nothing when it is no TOML or names no project. Its exports and imports are none.
 */
export function pyprojectFrom(text: string): Omit<SurveyPackage, "root"> & { deps: string[] } | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const project = tableAt(parsed, "project");
  if (typeof project?.name !== "string") return undefined;
  const requirements = Array.isArray(project.dependencies) ? project.dependencies.filter((one): one is string => typeof one === "string") : [];
  const sources = Object.entries(tableAt(parsed, "tool", "uv", "sources") ?? {}).filter(([, source]) => tableAt(source)?.workspace === true).map(([name]) => name);
  const deps = [...requirements.flatMap((one) => requirementName(one) ?? []), ...sources].map(normalisedName);
  return { name: normalisedName(project.name), deps: [...new Set(deps)], exports: {} };
}

/** Python, its imports read from tree-sitter's syntax tree once the grammar has loaded. */
export const pythonReader: LanguageReader = {
  files: /\.py$/,
  tests: PYTEST_FILE,
  testSupport: /(?:^|\/)conftest\.py$/,
  titlesOf: () => [],
  edgesOf,
  registersTests: () => false,
  declarationOf: (text) => {
    const match = DECLARED.exec(text);
    return match === null ? undefined : { number: Number(match[1]), title: match[2]! };
  },
  ready: async () => {
    await pythonLanguage();
  },
};
