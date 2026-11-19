// Capability 8 · Code survey
import type { PartClash, StorySurvey, SurveyedPart, SurveyedParts } from "@storytree/library";

const ENTRY = /^(?:index\.[cm]?[jt]sx?|__init__\.py)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const inside = (path: string, folder: string): boolean => folder === "" || path.startsWith(`${folder}/`);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function nestedParts(survey: Pick<StorySurvey, "files" | "imports">, roots: readonly string[]): SurveyedParts | undefined {
  const folders = [...new Set(roots.map((root) => root.replace(/(?<!\/)\/+$/, "")))];
  const nested = folders.filter((root) => folders.some((other) => other !== root && inside(root, other)));
  const tops = folders.filter((root) => !nested.includes(root));
  const paths = survey.files.map((file) => file.path);
  const has = new Set(paths);
  const top = new Set(tops.flatMap((root) => {
    const src = root === "" ? "src" : `${root}/src`;
    const modules = paths.filter((path) => baseOf(path) === "__init__.py" && folderOf(folderOf(path)) === src).map(folderOf);
    return [root, src, ...modules];
  }).concat(nested.map((root) => `${root}/src`)));

  const entries = new Map<string, string | undefined>();
  for (const path of [...paths].sort(byText)) {
    const folder = folderOf(path);
    if (!ENTRY.test(baseOf(path)) || DECLARATION.test(path) || top.has(folder) || entries.has(folder)) continue;
    entries.set(folder, path);
  }
  for (const root of nested) {
    if (entries.has(root)) continue;
    const entry = [root, `${root}/src`].flatMap((folder) => [...has].filter((path) => folderOf(path) === folder && ENTRY.test(baseOf(path)) && !DECLARATION.test(path))).sort(byText)[0];
    entries.set(root, entry);
  }
  const chain = (path: string): string[] => [...entries.keys()].filter((folder) => inside(path, folder)).sort((a, b) => a.length - b.length);

  type Node = { folder: string; entry?: string; files: string[]; parts: Map<string, Node> };
  const trees = new Map<string, Map<string, Node>>();
  for (const file of survey.files) {
    if (file.capability === undefined) continue;
    let level = trees.get(file.capability) ?? new Map<string, Node>();
    trees.set(file.capability, level);
    let node: Node | undefined;
    for (const folder of chain(file.path)) {
      node = level.get(folder);
      if (node === undefined) {
        const entry = entries.get(folder);
        node = { folder, ...(entry === undefined ? {} : { entry }), files: [], parts: new Map() };
        level.set(folder, node);
      }
      level = node.parts;
    }
    node?.files.push(file.path);
  }
  const settle = (level: Map<string, Node>): SurveyedPart[] => [...level.values()].sort((a, b) => byText(a.folder, b.folder))
    .map(({ parts, files, ...part }) => ({ ...part, files: files.sort(byText), parts: settle(parts) }));
  const capabilities = Object.fromEntries([...trees].sort(([a], [b]) => byText(a, b)).flatMap(([id, level]) => level.size === 0 ? [] : [[id, settle(level)] as const]));

  const pairs = [...new Map(survey.imports.map(({ from, to }) => [`${from}\n${to}`, { from, to }])).values()];
  const clashes = pairs.flatMap(({ from, to }): PartClash[] => {
    const enters = chain(to).filter((folder) => !inside(from, folder));
    const around = enters.filter((folder) => entries.get(folder) !== to);
    if (around.length === 0) return [];
    const outer = around[0]!;
    const entry = entries.get(outer);
    const refactor = entry === undefined ? `give ${outer} an entry file that offers what it takes, and import it from there` : `have ${entry} offer what it takes, and import it from there`;
    const suggestion = `As per storytree guidelines, this is the way you could potentially refactor it: ${from} reaches into ${to} round the entry of ${outer}, so ${refactor}.`;
    return [{ from, to, part: enters.at(-1)!, enters, around, suggestion }];
  }).sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to));

  return Object.keys(capabilities).length === 0 && clashes.length === 0 ? undefined : { capabilities, clashes };
}
