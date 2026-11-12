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
 * - One depends on another exactly when a file of the one imports a file of the other, as storyEdges resolves it.
 * - Capabilities whose imports run round a loop (a strongly connected set) are one, titled by their paths joined
 *   with " + ". Everything is sorted by path, so the order the files come in changes nothing.
 */
import path from "node:path";

import { isCodeFile, isTestCode, storyEdges } from "./code-survey.js";
import type { SourceFile } from "./language-reader.js";

/** A drawn capability: its title (each folder's and file's path from the story's folder, joined with " + "), and those folders and files from the import's top. */
export type DrawnCapability = { readonly title: string; readonly covers: readonly string[] };

/** The capabilities drawn from a story's code and the links between them, by title, from the dependent one. */
export type Drawing = { readonly capabilities: readonly DrawnCapability[]; readonly links: readonly { readonly from: string; readonly to: string }[] };

const JAVASCRIPT = /\.[cm]?[jt]sx?$/;

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
  const edges = storyEdges([{ id: "drawn", files, packages: [{ root: top, name: story.folder, exports: {} }], owners }]).get("drawn")!;
  for (const { from, to } of edges) if (from !== undefined && to !== undefined && from !== to) after.get(from)!.add(to);

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
