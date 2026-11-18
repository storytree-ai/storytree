// Capability 8 · Code survey
import path from "node:path";

import type { CodeEdge } from "@storytree/library";

import { isCodeFile, isTestCode, storyEdges } from "./code-survey.js";
import type { SourceFile, SurveyPackage } from "./language-reader.js";
import { manifestFrom } from "./survey-source.js";
import { aliasesOf } from "./tsconfig.js";

export type DrawnCapability = { readonly title: string; readonly covers: readonly string[] };

export type Drawing = { readonly capabilities: readonly DrawnCapability[]; readonly links: readonly { readonly from: string; readonly to: string }[] };

const JAVASCRIPT = /\.[cm]?[jt]sx?$/;
const MANIFEST = /(?:^|\/)(?:package|tsconfig)\.json$/;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

function sourceRoot(top: string, files: readonly SourceFile[], drawn: readonly string[]): string {
  const packages = new Set(files.flatMap(({ path: file }) => [top, `${top}src/`].flatMap((base) => {
    const rest = file.slice(base.length).split("/");
    const folder = `${base}${rest[0]}/`;
    return file.startsWith(base) && rest.length === 2 && rest[1] === "__init__.py" && drawn.some((code) => code.startsWith(folder)) ? [folder] : [];
  })));
  if (packages.size === 1) return [...packages][0]!;
  return drawn.some((file) => file.startsWith(`${top}src/`) && JAVASCRIPT.test(file)) ? `${top}src/` : top;
}

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
