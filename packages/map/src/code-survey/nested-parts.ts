/**
 * Capability 8 · Code survey: each capability's nested parts, and the imports reaching round a part's entry (ADR-1339 D1,
 * question_e92de69f7b2f's option A).
 *
 * - A part is a folder with its own entry file (index.ts or another index script, or Python's __init__.py), or a package
 *   nested inside the story's own. A Python folder without __init__.py (a namespace package) is no part, nor is a folder
 *   with no entry: its files belong to the part around it. Test files are never read for parts.
 * - The story's own top is no part: each of its package folders, its src, and a Python module's folder directly under src.
 *   A nested package is one part, its src included.
 * - Parts nest as deep as the code goes. A capability's parts are those holding its own files, each listing only them, so
 *   a part shared by several capabilities appears inside each, clipped to that capability's files.
 * - An import entering a part other than by its entry is a clash, reported with a suggested refactor and never hiding the
 *   part. It names the part it reaches (the innermost it enters) and each it enters on the way, so a drawing can label the
 *   line at an outer level as reaching into the inner part, which keeps its one home.
 * - Every list is sorted, so two surveys of the same code give the same parts.
 */
import type { PartClash, StorySurvey, SurveyedPart, SurveyedParts } from "@storytree/library";

const ENTRY = /^(?:index\.[cm]?[jt]sx?|__init__\.py)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
/** Whether `path` lies inside `folder` (`""` holds everything). */
const inside = (path: string, folder: string): boolean => folder === "" || path.startsWith(`${folder}/`);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A story survey's nested parts, by capability, and its clashes; undefined when it has neither. `roots` are the story's
 * package folders in the survey's coordinates (`""` for the package the paths are from); one inside another is a nested package.
 */
export function nestedParts(survey: Pick<StorySurvey, "files" | "imports">, roots: readonly string[]): SurveyedParts | undefined {
  const folders = [...new Set(roots.map((root) => root.replace(/\/+$/, "")))];
  const nested = folders.filter((root) => folders.some((other) => other !== root && inside(root, other)));
  const tops = folders.filter((root) => !nested.includes(root));
  const paths = survey.files.map((file) => file.path);
  const has = new Set(paths);
  const top = new Set(tops.flatMap((root) => {
    const src = root === "" ? "src" : `${root}/src`;
    // A Python module's own folder, directly under src, is the story's top too.
    const modules = paths.filter((path) => baseOf(path) === "__init__.py" && folderOf(folderOf(path)) === src).map(folderOf);
    return [root, src, ...modules];
  }).concat(nested.map((root) => `${root}/src`)));

  /** Each part's folder and its entry file, if any. */
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
  // A file's parts, outermost first.
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
