/**
 * Capability 8 · Code survey: an imported story's capabilities and the links between them, drawn from its code
 * (ADR-1324 D1, D2). It writes nothing: what import does with the drawing is the import's.
 *
 * - Its source root is src/ for a JavaScript or TypeScript package that has one, the import package folder for Python
 *   (the one folder holding `__init__.py`, at the story's top or under src/, with code in it), else the story's folder.
 * - Below the source root, each folder holding code with no folder of code beneath it is a capability, and each code
 *   file in a folder that has a folder of code beneath it, or in the source root itself, is one of its own; a code file
 *   outside the source root (configuration at the package's top) is one of its own. The unit is set by the building
 *   increment's measure on both trials (increment_3a69d0fdce2e): the deepest folder of code, else the module.
 * - Test files, test support, declaration files and files with no non-blank line are no capability's: tests are
 *   contracts' proofs, and an empty `__init__.py` holds nothing to draw.
 * - One depends on another exactly when a file of the one imports a file of the other, as storyEdges resolves it: a name
 *   taken from a file that only passes it on (a package root's re-export) is followed to the file that binds it.
 * - Capabilities whose imports run round a loop (a strongly connected set) are one, titled by their paths joined
 *   with " + ". Everything is sorted by path, so the order the files come in changes nothing.
 */
import path from "node:path";

import type { CodeEdge } from "@storytree/library";

import { isCodeFile, isTestCode, storyEdges } from "./code-survey.js";
import type { SourceFile, SurveyPackage } from "./language-reader.js";
import { manifestFrom } from "./survey-source.js";
import { aliasesOf } from "./tsconfig.js";

/** A drawn capability: its title (each folder's and file's path from the story's folder, joined with " + "), and those folders and files from the import's top. */
export type DrawnCapability = { readonly title: string; readonly covers: readonly string[] };

/** The capabilities drawn from a story's code and the links between them, by title, from the dependent one. */
export type Drawing = { readonly capabilities: readonly DrawnCapability[]; readonly links: readonly { readonly from: string; readonly to: string }[] };

const JAVASCRIPT = /\.[cm]?[jt]sx?$/;
const MANIFEST = /(?:^|\/)(?:package|tsconfig)\.json$/;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The drawing of an imported story whose package is `folder` (from the import's top, "." the top itself), given its
 * files in the import's coordinates, its tests among them. The readers of its languages must
 * be ready (readersReady).
 */
export function drawImportedStory(story: { readonly folder: string; readonly files: readonly SourceFile[] }): Drawing {
  const top = story.folder === "." ? "" : `${path.posix.normalize(story.folder).replace(/\/$/, "")}/`;
  const files = story.files.filter((file) => file.path.startsWith(top));
  const drawn = files.filter((file) => isCodeFile(file.path) && !isTestCode(file) && file.text.trim() !== "").map((file) => file.path).sort(byText);
  const root = sourceRoot(top, files, drawn);

  const folderOf = (file: string): string => file.slice(0, file.lastIndexOf("/") + 1);
  const codeFolders = new Set(drawn.filter((file) => file.startsWith(root)).map(folderOf));
  const unitOf = (file: string): string => {
    const folder = folderOf(file);
    if (!file.startsWith(root) || folder === root || [...codeFolders].some((other) => other !== folder && other.startsWith(folder))) return file;
    return folder.slice(0, -1);
  };
  const owners = new Map(drawn.map((file) => [file, unitOf(file)] as const));

  const units = [...new Set(owners.values())].sort(byText);
  const after = new Map(units.map((unit) => [unit, new Set<string>()] as const));
  const above = story.files.filter((file) => !file.path.startsWith(top) && MANIFEST.test(file.path));
  for (const { from, to } of importedLinks(story.folder, [...files, ...above], owners)) if (from !== undefined && to !== undefined && from !== to) after.get(from)!.add(to);

  const merged = loops(units, after);
  const titleOf = (unit: string): string => unit.slice(top.length);
  const capabilityOf = new Map(merged.flatMap((members) => {
    const title = members.map(titleOf).join(" + ");
    return members.map((unit) => [unit, title] as const);
  }));
  const capabilities = merged.map((members) => ({ title: capabilityOf.get(members[0]!)!, covers: members }))
    .sort((a, b) => byText(a.title, b.title));
  const links = [...new Set(units.flatMap((unit) => [...after.get(unit)!].map((to) => JSON.stringify([capabilityOf.get(unit)!, capabilityOf.get(to)!]))))]
    .map((pair) => JSON.parse(pair) as [string, string])
    .filter(([from, to]) => from !== to)
    .sort(([a, x], [b, y]) => byText(a, b) || byText(x, y))
    .map(([from, to]) => ({ from, to }));
  return { capabilities, links };
}

/**
 * The links the imports of an imported story whose package is `folder` make between the capabilities `owners` gives its
 * files, each with the imports behind it: the drawing's, and the links check's (3.15), so the two read imports alike.
 * Each package.json among `files` is a package an import reaches by its name, and each tsconfig.json gives the files
 * beneath it its path aliases, the nearest one winning (8.62); the story's folder is a package whether or not it has one.
 */
export function importedLinks(folder: string, files: readonly SourceFile[], owners: ReadonlyMap<string, string>): CodeEdge[] {
  const top = folder === "." ? "" : `${path.posix.normalize(folder).replace(/\/$/, "")}/`;
  const tsconfigs = files.filter((file) => path.posix.basename(file.path) === "tsconfig.json")
    .map((file) => ({ dir: path.posix.dirname(file.path), aliases: aliasesOf(path.posix.dirname(file.path), file.text) }));
  const packages: SurveyPackage[] = files.filter((file) => path.posix.basename(file.path) === "package.json").flatMap((file) => {
    const manifest = manifestFrom(file.text);
    if (manifest === undefined) return [];
    const dir = path.posix.dirname(file.path);
    const { main } = JSON.parse(file.text) as { main?: unknown };
    return [{ root: dir === "." ? "" : `${dir}/`, name: manifest.name, exports: manifest.exports, imports: manifest.imports, ...(typeof main === "string" ? { main } : {}) }];
  });
  if (!packages.some((pkg) => pkg.root === top)) packages.push({ root: top, name: folder, exports: {} });
  packages[0] = { ...packages[0]!, tsconfigs };
  return storyEdges([{ id: "drawn", files, packages, owners }]).get("drawn")!;
}

/**
 * The package.json and tsconfig.json files an imported story's imports are resolved with (8.62): those in each folder
 * holding one of `code` and each folder above it to the import's top, by their paths from that top, read by `read`
 * (undefined for one that is not there).
 */
export async function manifestsOf(code: readonly SourceFile[], read: (file: string) => Promise<string | undefined>): Promise<SourceFile[]> {
  const folders = new Set<string>();
  for (const file of code) {
    for (let folder = path.posix.dirname(file.path); !folders.has(folder); folder = path.posix.dirname(folder)) {
      folders.add(folder);
      if (folder === ".") break;
    }
  }
  const found = await Promise.all([...folders].flatMap((folder) => ["package.json", "tsconfig.json"].map(async (name): Promise<SourceFile | undefined> => {
    const file = folder === "." ? name : `${folder}/${name}`;
    const text = await read(file);
    return text === undefined ? undefined : { path: file, text };
  })));
  return found.filter((file): file is SourceFile => file !== undefined).sort((a, b) => byText(a.path, b.path));
}

/** The source root under `top`: its one Python import package holding code, else its src/ holding JavaScript or TypeScript, else `top`. */
function sourceRoot(top: string, files: readonly SourceFile[], drawn: readonly string[]): string {
  const packages = new Set(files.flatMap(({ path: file }) => [top, `${top}src/`].flatMap((base) => {
    const rest = file.slice(base.length).split("/");
    const folder = `${base}${rest[0]}/`;
    return file.startsWith(base) && rest.length === 2 && rest[1] === "__init__.py" && drawn.some((code) => code.startsWith(folder)) ? [folder] : [];
  })));
  if (packages.size === 1) return [...packages][0]!;
  return drawn.some((file) => file.startsWith(`${top}src/`) && JAVASCRIPT.test(file)) ? `${top}src/` : top;
}

/** The strongly connected sets of `nodes` (Tarjan's), each sorted, visited in sorted order so the result is the same every run. */
function loops(nodes: readonly string[], after: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of [...after.get(node)!].sort(byText)) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
    }
    if (low.get(node) !== index.get(node)) return;
    const members: string[] = [];
    for (let member = stack.pop()!; ; member = stack.pop()!) {
      onStack.delete(member);
      members.push(member);
      if (member === node) break;
    }
    found.push(members.sort(byText));
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return found;
}
