// Capability 8 · Code survey
import type { Node, Tree } from "web-tree-sitter";

import type { Edge, LanguageReader, Offers, SourceFile, SurveyPackage } from "./language-reader.js";

export const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

const DECLARED = /^(?:#![^\n]*\n)?\s*#[ \t]*Capability\s+(\d+)\s*·[ \t]*([^\n]*)/;

let parser: { readonly load: () => Promise<unknown>; readonly parse: (text: string) => Tree } | undefined;

export function usePythonParser(given: NonNullable<typeof parser>): void {
  parser = given;
}

function givenParser(): NonNullable<typeof parser> {
  if (parser === undefined) throw new Error("the Python reader has no parser: usePythonParser was never called");
  return parser;
}

function moduleFile(root: string, parts: readonly string[], paths: ReadonlySet<string>): string | undefined {
  if (parts.length === 0) return paths.has(`${root}__init__.py`) ? `${root}__init__.py` : undefined;
  const base = root + parts.join("/");
  return [`${base}.py`, `${base}/__init__.py`].find((file) => paths.has(file));
}

function searchRoots(file: string, packages: readonly SurveyPackage[]): string[] {
  const holding = packages.filter((pkg) => file.startsWith(pkg.root)).sort((a, b) => b.root.length - a.root.length)[0];
  const root = holding?.root ?? "";
  return [`${root}src/`, root];
}

const partsOf = (node: Node | null): string[] => node === null ? [] : node.text.split(".").map((part) => part.trim()).filter(Boolean);

const importedParts = (node: Node): string[] => partsOf(node.type === "aliased_import" ? node.childForFieldName("name") : node);

const boundAs = (node: Node): string => node.type === "aliased_import" ? node.childForFieldName("alias")?.text ?? "" : node.text.trim();

type Statement = { readonly level?: number; readonly base: readonly string[]; readonly names: readonly (readonly [name: string, as: string])[] | "all"; readonly top: boolean };

type Reading = { readonly statements: readonly Statement[]; readonly local: ReadonlySet<string> };

const readings = new WeakMap<SourceFile, Reading>();

const OPEN = new Set(["block", "if_statement", "elif_clause", "else_clause", "try_statement", "except_clause", "finally_clause", "with_statement", "decorated_definition"]);

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

function resolver(file: SourceFile, paths: ReadonlySet<string>, packages: readonly SurveyPackage[]): (statement: Statement, parts: readonly string[]) => string | undefined {
  const roots = searchRoots(file.path, packages);
  const folder = file.path.split("/").slice(0, -1);
  return (statement, parts) => {
    const named = [...statement.base, ...parts];
    if (statement.level === undefined || statement.level === 0) return roots.map((root) => moduleFile(root, named, paths)).find((to) => to !== undefined);
    if (statement.level - 1 > folder.length) return undefined;
    const start = folder.slice(0, folder.length - (statement.level - 1));
    return moduleFile(start.length === 0 ? "" : `${start.join("/")}/`, named, paths);
  };
}

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

const NUMBERED_NAME = /^test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])_?(.*)$/i;
const NUMBERED_DOCSTRING = /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+(?![0-9])/i;

function docstringOf(definition: Node): string | undefined {
  const opening = definition.childForFieldName("body")?.namedChildren[0];
  const string = opening?.type === "expression_statement" && opening.namedChildCount === 1 ? opening.namedChildren[0] : undefined;
  if (string?.type !== "string" || string.namedChildren.some((part) => part.type === "interpolation")) return undefined;
  return string.namedChildren.filter((part) => part.type === "string_content").map((part) => part.text).join("");
}

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

const definitionsIn = (block: Node): Node[] => block.namedChildren.map((child) => child.type === "decorated_definition" ? child.childForFieldName("definition") : child).filter((child): child is Node => child !== null);

function testsIn(block: Node): Node[] {
  return definitionsIn(block).flatMap((definition) => {
    const name = definition.childForFieldName("name")?.text ?? "";
    if (definition.type === "function_definition") return name.startsWith("test") ? [definition] : [];
    const body = definition.childForFieldName("body");
    return definition.type === "class_definition" && name.startsWith("Test") && body !== null ? testsIn(body) : [];
  });
}

function titlesOf(file: SourceFile): string[] {
  const tree = givenParser().parse(file.text);
  try {
    return testsIn(tree.rootNode).map(testTitle);
  } finally {
    tree.delete();
  }
}

export const pythonReader: LanguageReader = {
  files: /\.py$/,
  tests: PYTEST_FILE,
  testSupport: /(?:^|\/)(?:conftest\.py|tests?\/.*\.py)$/,
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
