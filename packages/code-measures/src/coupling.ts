/**
 * Capability 1 · Base structure measures. Coupling and public surface (contract 1.4, B5 and B6).
 *
 * - Coupling is read from the imports in the source itself, never from package.json: Ce is the other workspace packages a
 *   story's source files import (type-only imports, re-exports and literal dynamic imports included), Ca the other
 *   workspace packages whose source files import one of the story's. Imports among a story's own packages, and from test
 *   files, count in neither. Instability is Ce/(Ca+Ce), none when both are zero.
 * - Public surface is the distinct names exported from every entry of a package's exports map, following export * and
 *   export { } from to their sources within the package (export * passes no default on).
 */
import { kindOf, parsed, walk, type Node, type SourceText } from "./source.js";

/** A workspace package as the readings take it: its folder under packages/, its npm name, its manifest and its files. */
export interface WorkspacePackage {
  readonly folder: string;
  readonly name: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly files: readonly SourceText[];
}

/** A story's coupling: the packages it uses and those using it, by folder, and its instability. */
export interface CouplingReading {
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly instability: number | null;
}

/** Every module specifier `file` names in an import, a re-export, a literal dynamic import or an import-equals require. */
export function specifiersOf(file: SourceText): string[] {
  const { program } = parsed(file);
  if (program === undefined) return [];
  const found: string[] = [];
  for (const node of walk(program)) {
    const source = node.source as Node | null | undefined;
    if ((node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && source?.type === "StringLiteral") found.push(source.value as string);
    else if (node.type === "CallExpression" && (node.callee as Node).type === "Import") {
      const first = (node.arguments as Node[])[0];
      if (first?.type === "StringLiteral") found.push(first.value as string);
    } else if (node.type === "TSExternalModuleReference") found.push((node.expression as Node).value as string);
    else if (node.type === "TSImportType" && (node.argument as Node | undefined)?.type === "StringLiteral") found.push((node.argument as Node).value as string);
  }
  return found;
}

/** The folder of the workspace package `specifier` names, if it names one. */
function packageNamed(specifier: string, workspace: readonly WorkspacePackage[]): string | undefined {
  return workspace.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))?.folder;
}

/** The workspace packages `files`' source imports, by folder. */
function importedBy(files: readonly SourceText[], workspace: readonly WorkspacePackage[]): Set<string> {
  const used = new Set<string>();
  for (const file of files) {
    if (kindOf(file) !== "source") continue;
    for (const specifier of specifiersOf(file)) {
      const folder = packageNamed(specifier, workspace);
      if (folder !== undefined) used.add(folder);
    }
  }
  return used;
}

/** The coupling of the story whose packages are `folders`, within `workspace` (B5). */
export function couplingOf(folders: readonly string[], workspace: readonly WorkspacePackage[]): CouplingReading {
  const own = new Set(folders);
  const ours = workspace.filter((pkg) => own.has(pkg.folder));
  const dependencies = [...importedBy(ours.flatMap((pkg) => pkg.files), workspace)].filter((folder) => !own.has(folder)).sort();
  const names = ours.map((pkg) => pkg.name);
  const dependents = workspace
    .filter((pkg) => !own.has(pkg.folder))
    // A file that never spells one of our names cannot import us: it is not parsed for it.
    .filter((pkg) => [...importedBy(pkg.files.filter((file) => names.some((name) => file.text.includes(name))), ours)].length > 0)
    .map((pkg) => pkg.folder)
    .sort();
  const total = dependencies.length + dependents.length;
  return { dependencies, dependents, instability: total === 0 ? null : dependencies.length / total };
}

/** Every file path an exports map names, conditions and all. */
function entriesOf(exports: unknown): string[] {
  if (typeof exports === "string") return [exports];
  if (Array.isArray(exports)) return exports.flatMap(entriesOf);
  if (typeof exports === "object" && exports !== null) return Object.values(exports).flatMap(entriesOf);
  return [];
}

/** The file of `files` a relative specifier from `from` names, trying TypeScript's extensions for a .js one. */
function resolve(from: string, specifier: string, byPath: ReadonlyMap<string, SourceText>): SourceText | undefined {
  const base = joinPath(from.slice(0, from.lastIndexOf("/") + 1), specifier);
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  const tries = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.js`, `${stem}.jsx`, `${stem}.mjs`, `${stem}.cjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  for (const path of tries) {
    const found = byPath.get(path);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `relative` read from the folder `folder` (ending in /), its . and .. steps taken. */
function joinPath(folder: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${folder}${relative}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const nameOf = (node: Node): string => (node.type === "StringLiteral" ? (node.value as string) : (node.name as string));

/** The names `file` exports, following re-exports within the package; `seen` stops a cycle. */
function exportedNames(file: SourceText, byPath: ReadonlyMap<string, SourceText>, seen: Set<string>, withDefault: boolean): Set<string> {
  const names = new Set<string>();
  if (seen.has(file.path)) return names;
  seen.add(file.path);
  const { program } = parsed(file);
  for (const node of (program?.body as Node[] | undefined) ?? []) {
    const source = (node.source as Node | null | undefined)?.value as string | undefined;
    if (node.type === "ExportAllDeclaration") {
      const exported = node.exported as Node | null | undefined;
      if (exported) names.add(nameOf(exported));
      else if (source?.startsWith(".")) {
        const target = resolve(file.path, source, byPath);
        if (target !== undefined) for (const name of exportedNames(target, byPath, seen, false)) names.add(name);
      }
    } else if (node.type === "ExportNamedDeclaration") {
      for (const specifier of (node.specifiers as Node[]) ?? []) names.add(nameOf(specifier.exported as Node));
      const declaration = node.declaration as Node | null | undefined;
      if (declaration) for (const name of declaredNames(declaration)) names.add(name);
    } else if (node.type === "ExportDefaultDeclaration" || node.type === "TSExportAssignment") {
      if (withDefault) names.add("default");
    } else if (node.type === "TSImportEqualsDeclaration" && node.isExport === true) names.add((node.id as Node).name as string);
  }
  seen.delete(file.path);
  if (!withDefault) names.delete("default");
  return names;
}

/** The names a declaration after `export` binds. */
function declaredNames(declaration: Node): string[] {
  if (declaration.type === "VariableDeclaration") return (declaration.declarations as Node[]).flatMap((one) => bound(one.id as Node));
  const id = declaration.id as Node | null | undefined;
  return id?.type === "Identifier" ? [id.name as string] : [];
}

/** The names a binding pattern binds. */
function bound(pattern: Node | null | undefined): string[] {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name as string];
    case "ObjectPattern":
      return (pattern.properties as Node[]).flatMap((property) => bound((property.type === "RestElement" ? property.argument : property.value) as Node));
    case "ArrayPattern":
      return (pattern.elements as (Node | null)[]).flatMap(bound);
    case "RestElement":
      return bound(pattern.argument as Node);
    case "AssignmentPattern":
      return bound(pattern.left as Node);
    default:
      return [];
  }
}

/** The distinct names exported from every entry of `pkg`'s exports map (B6). */
export function publicSurfaceOf(pkg: WorkspacePackage): number {
  const byPath = new Map(pkg.files.map((file) => [file.path, file]));
  const names = new Set<string>();
  for (const entry of new Set(entriesOf(pkg.manifest.exports))) {
    const file = byPath.get(joinPath(`packages/${pkg.folder}/`, entry));
    if (file === undefined) continue;
    for (const name of exportedNames(file, byPath, new Set(), true)) names.add(name);
  }
  return names.size;
}
