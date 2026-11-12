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
 * - A test file's titles are its pytest tests', read from the syntax tree: each `test*` function at the top of the file,
 *   and each `test*` method of a `Test*` class, nested classes too (8.54). A test whose docstring's first line starts
 *   with a number, perhaps after a package (`2.3 · …`, `shop 2.3 · …`), is titled by that line; else by its name,
 *   `test_2_3_cart_keeps_items` as `2.3 · cart keeps items` and `test_shop_2_3_…` as `shop 2.3 · …` (the package's
 *   hyphens as underscores), as python-tests.ts reads them for the landing check (ADR-1189).
 * - Its parser is given it (usePythonParser) by the survey's Node-only reader, read-survey.ts.
 */
import type { Node, Tree } from "web-tree-sitter";

import type { Edge, LanguageReader, Offers, SourceFile, SurveyPackage } from "./language-reader.js";

/** A pytest test file, by its path. */
export const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

/** The opening comment's "Capability N · …", after a shebang: a comment that begins with it, before any code. */
const DECLARED = /^(?:#![^\n]*\n)?\s*#[ \t]*Capability\s+(\d+)\s*·[ \t]*([^\n]*)/;

/**
 * The parser the reader reads with: tree-sitter's (tree-sitter.ts), given by the survey's Node-only reader, so a
 * browser bundle that holds the survey's readers (the page, through the package's index) holds no wasm loader.
 */
let parser: { readonly load: () => Promise<unknown>; readonly parse: (text: string) => Tree } | undefined;

/** Gives the reader its parser: `load` loads the grammar once, and `parse` parses at once after it has. */
export function usePythonParser(given: NonNullable<typeof parser>): void {
  parser = given;
}

/** The parser given, or a throw: a survey that reads Python with none must fail, never draw a file with no imports. */
function givenParser(): NonNullable<typeof parser> {
  if (parser === undefined) throw new Error("the Python reader has no parser: usePythonParser was never called");
  return parser;
}

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

/** The name an import binds a name it takes on: its alias, else its own. */
const boundAs = (node: Node): string => node.type === "aliased_import" ? node.childForFieldName("alias")?.text ?? "" : node.text.trim();

/**
 * One import statement as written: `import a.b` (no level) or `from <level dots><base> import …`, with the names it
 * takes and binds (each as written and as bound), "all" for a wildcard; whether it is at the module's own level.
 */
type Statement = { readonly level?: number; readonly base: readonly string[]; readonly names: readonly (readonly [name: string, as: string])[] | "all"; readonly top: boolean };

/** What a Python file says, read once from its syntax: its import statements, and the names it binds itself at its own level. */
type Reading = { readonly statements: readonly Statement[]; readonly local: ReadonlySet<string> };

/** Parse each unchanged file once; resolution against a story's paths happens each time. */
const readings = new WeakMap<SourceFile, Reading>();

/** Statements run when the module loads hold the module's names: a block of an if, try or with does, a function's or class's body does not. */
const OPEN = new Set(["block", "if_statement", "elif_clause", "else_clause", "try_statement", "except_clause", "finally_clause", "with_statement", "decorated_definition"]);

/** The names an assignment's left side binds. */
const targetsOf = (node: Node | null): string[] => node === null ? []
  : node.type === "identifier" ? [node.text]
  : ["pattern_list", "tuple_pattern", "list_pattern"].includes(node.type) ? node.namedChildren.flatMap(targetsOf) : [];

function readingOf(file: SourceFile): Reading {
  const cached = readings.get(file);
  if (cached !== undefined) return cached;
  const tree = givenParser().parse(file.text);
  try {
    const statements: Statement[] = [];
    const local = new Set<string>();
    const moduleLevel = new Set<number>();
    const visit = (block: Node): void => {
      for (const child of block.namedChildren) {
        moduleLevel.add(child.id);
        if (child.type === "function_definition" || child.type === "class_definition") {
          const name = child.childForFieldName("name")?.text;
          if (name !== undefined) local.add(name);
        } else if (child.type === "expression_statement") {
          for (const assignment of child.namedChildren) if (assignment.type === "assignment" || assignment.type === "augmented_assignment") targetsOf(assignment.childForFieldName("left")).forEach((name) => local.add(name));
        }
        if (OPEN.has(child.type)) visit(child);
      }
    };
    visit(tree.rootNode);
    for (const node of tree.rootNode.descendantsOfType(["import_statement", "import_from_statement"])) {
      const top = moduleLevel.has(node.id);
      if (node.type === "import_statement") {
        for (const name of node.childrenForFieldName("name")) statements.push({ base: importedParts(name), names: "all", top });
        continue;
      }
      const module = node.childForFieldName("module_name");
      if (module === null) continue;
      const relative = module.type === "relative_import";
      const level = relative ? module.children.find((child) => child.type === "import_prefix")?.text.length ?? 0 : 0;
      const base = partsOf(relative ? module.namedChildren.find((child) => child.type === "dotted_name") ?? null : module);
      const names = node.childrenForFieldName("name");
      statements.push({ level, base, names: names.length === 0 ? "all" : names.map((name) => [importedParts(name).join("."), boundAs(name)] as const), top });
    }
    const read = { statements, local };
    readings.set(file, read);
    return read;
  } finally {
    tree.delete();
  }
}

/** The file a statement's module, extended by `parts`, names for `file`, if `paths` holds it. */
function resolver(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): (statement: Statement, parts: readonly string[]) => string | undefined {
  const roots = searchRoots(file.path, packages);
  const folder = file.path.split("/").slice(0, -1);
  return (statement, parts) => {
    const named = [...statement.base, ...parts];
    if (statement.level === undefined || statement.level === 0) return roots.map((root) => moduleFile(root, named, paths)).find((to) => to !== undefined);
    // A relative import of level n climbs n-1 folders from the importing file's.
    if (statement.level - 1 > folder.length) return undefined;
    const start = folder.slice(0, folder.length - (statement.level - 1));
    return moduleFile(start.length === 0 ? "" : `${start.join("/")}/`, named, paths);
  };
}

/**
 * The imports a Python file makes of files `paths` holds: a submodule a `from` names is taken whole; a name that is no
 * submodule is taken from the module, by its name and the name it is bound on here; a wildcard or `import a.b` takes the
 * whole file. A file taken whole by one statement and by name by another is taken whole.
 */
function edgesOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Edge[] {
  const resolve = resolver(file, paths, packages);
  const found = new Map<string, Map<string, readonly [string, string]> | "all">();
  const add = (to: string | undefined, name?: readonly [string, string]): void => {
    if (to === undefined || to === file.path) return;
    const before = found.get(to);
    if (name === undefined) found.set(to, "all");
    else if (before !== "all") found.set(to, (before ?? new Map()).set(name.join(" "), name));
  };
  for (const statement of readingOf(file).statements) {
    if (statement.names === "all") add(resolve(statement, []));
    else for (const name of statement.names) {
      const submodule = resolve(statement, name[0].split("."));
      if (submodule !== undefined) add(submodule);
      else add(resolve(statement, []), name);
    }
  }
  return [...found].map(([to, names]) => ({ to, reexport: false, typeOnly: false, names: names === "all" ? "all" : [...names.values()] }));
}

/**
 * The names a Python module binds at its own level, by where they come from (8.64): the names it binds itself, by a
 * definition or an assignment; and, for a package's `__init__.py`, which passes on what it imports (ADR-1324 D5, as
 * increment_50b0c46778aa settles it), each it binds by its own `from` import, to the file it takes it from and its name
 * there (none for a submodule, taken whole), and the modules its own wildcards take every name of. Any other module's
 * imports are its own to use: a name taken from it is taken from it.
 */
function offersOf(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): Offers {
  const resolve = resolver(file, paths, packages);
  const { statements, local } = readingOf(file);
  const from = new Map<string, { readonly to: string; readonly name?: string }>();
  const star: string[] = [];
  if (!/(?:^|\/)__init__\.py$/.test(file.path)) return { local, from, star };
  for (const statement of statements) {
    if (!statement.top || statement.level === undefined) continue;
    if (statement.names === "all") {
      const to = resolve(statement, []);
      if (to !== undefined) star.push(to);
      continue;
    }
    for (const [name, as] of statement.names) {
      const submodule = resolve(statement, name.split("."));
      const to = submodule ?? resolve(statement, []);
      if (to !== undefined && to !== file.path) from.set(as, submodule === undefined ? { to, name } : { to });
    }
  }
  return { local, from, star };
}

/** A test's name: `test_`, then perhaps a package (words of letters and digits), then the number's two parts and the rest. */
const NUMBERED_NAME = /^test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])_?(.*)$/i;
/** A docstring's first line that starts with a number, perhaps after a package's name. */
const NUMBERED_DOCSTRING = /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+(?![0-9])/i;

/** A function's docstring: its body's opening string, as written between its quotes; none for an f-string or a concatenation. */
function docstringOf(definition: Node): string | undefined {
  const opening = definition.childForFieldName("body")?.namedChildren[0];
  const string = opening?.type === "expression_statement" && opening.namedChildCount === 1 ? opening.namedChildren[0] : undefined;
  if (string?.type !== "string" || string.namedChildren.some((part) => part.type === "interpolation")) return undefined;
  return string.namedChildren.filter((part) => part.type === "string_content").map((part) => part.text).join("");
}

/** The title of one test function: its numbered docstring's first line, else its name, numbered when it carries one. */
function testTitle(definition: Node): string {
  const name = definition.childForFieldName("name")?.text ?? "";
  const line = docstringOf(definition)?.trim().split("\n")[0]!.trim();
  if (line !== undefined && NUMBERED_DOCSTRING.test(line)) return line;
  const numbered = NUMBERED_NAME.exec(name);
  if (numbered === null) return name;
  const [, prefix, major, minor, rest] = numbered;
  const named = prefix!.replace(/_$/, "").toLowerCase().replaceAll("_", "-");
  return `${named === "" ? "" : `${named} `}${major}.${minor} · ${rest!.replaceAll("_", " ")}`.trim();
}

/** The definitions in a block (a module's or a class's), seen through their decorators. */
const definitionsIn = (block: Node): Node[] => block.namedChildren.map((child) => child.type === "decorated_definition" ? child.childForFieldName("definition") : child).filter((child): child is Node => child !== null);

/** The tests pytest collects from a block: its `test*` functions, and those of its `Test*` classes. */
function testsIn(block: Node): Node[] {
  return definitionsIn(block).flatMap((definition) => {
    const name = definition.childForFieldName("name")?.text ?? "";
    if (definition.type === "function_definition") return name.startsWith("test") ? [definition] : [];
    const body = definition.childForFieldName("body");
    return definition.type === "class_definition" && name.startsWith("Test") && body !== null ? testsIn(body) : [];
  });
}

/** The titles of a pytest file's tests. */
function titlesOf(file: SourceFile): string[] {
  const tree = givenParser().parse(file.text);
  try {
    return testsIn(tree.rootNode).map(testTitle);
  } finally {
    tree.delete();
  }
}

/** Python, its imports read from tree-sitter's syntax tree once its parser has loaded the grammar. */
export const pythonReader: LanguageReader = {
  files: /\.py$/,
  tests: PYTEST_FILE,
  testSupport: /(?:^|\/)conftest\.py$/,
  titlesOf,
  edgesOf,
  offersOf,
  registersTests: () => false,
  declarationOf: (text) => {
    const match = DECLARED.exec(text);
    return match === null ? undefined : { number: Number(match[1]), title: match[2]! };
  },
  ready: async () => {
    await givenParser().load();
  },
};
