/**
 * Capability 3 · Counts before detail: what crosses a line drawn round files of a mapped island (ADR-0993 D6, D10).
 *
 * - The line is a set of patterns relative to the import's folder (a folder takes everything under it, `*` stays
 *   within a segment, `**` crosses segments), or full paths. The island is the import the matched files belong to;
 *   patterns matching nothing, or files of two imports, are refused. A mapped story named keeps them to its files.
 * - `cap:<id|number>` in place of a pattern names an explored capability: the line takes the folders and files it
 *   covers (ADR-0993 D5), among its story's files only. One that covers nothing, or a number two stories share, is refused.
 * - In: the files outside the line that import files inside it, the island's apart from built stories'. Out: the
 *   files inside that import files outside. Each is a count of files and of imports first; show lists each import,
 *   or refuses above the ceiling with the counts.
 * - A specifier resolves against the island's mapped files and every built file: a relative path, the importer's
 *   nearest tsconfig.json `compilerOptions.paths` (from its baseUrl, else its folder; `extends` is not followed),
 *   or a mapped package's name with or without a subpath (its literal exports, else main, else its folder's index).
 * - The island's files are read for their imports only here, when asked: the black box stays cheap until someone looks.
 *   Code that uses the files through the database, events or a name this cannot resolve is not counted, and the answer says so.
 */
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf, specifiersOf, type StorySurvey } from "./code-survey.js";
import { manifestFrom } from "./survey-source.js";

export type CrossingOptions = {
  /** Folders or file patterns relative to the import's folder, full paths, or `cap:<id|number>` for an explored capability. */
  readonly patterns: readonly string[];
  /** A mapped story's id or title: the line is drawn among its files only. */
  readonly story?: string;
  readonly mode?: "counts" | "show";
};

/** Files on one side that import across the line, and how many imports they make across it. */
export type CrossingSide = { readonly files: number; readonly imports: number };

/** One import across the line: island paths are from the import's folder, built ones from the checkout. */
export type CrossingRow = { readonly direction: "in" | "out"; readonly side: "island" | "built"; readonly from: string; readonly to: string };

export type CrossingAnswer = {
  readonly mode: "counts" | "show";
  /** The folder this machine imports the island from. */
  readonly island: string;
  /** The mapped stories the line's files belong to. */
  readonly stories: readonly string[];
  readonly patterns: readonly string[];
  /** Files inside the line. */
  readonly inside: number;
  readonly in: { readonly island: CrossingSide; readonly built: CrossingSide };
  readonly out: { readonly island: CrossingSide; readonly built: CrossingSide };
  readonly rowCount: number;
  readonly refused: boolean;
  readonly ceiling: number;
  readonly note: string;
  readonly rows?: readonly CrossingRow[];
};

export const CROSSING_NOTE = "Code that uses these files through the database or events, or by a name the map cannot resolve, is not counted.";
const CEILING = 200;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const COMPILED = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] } as Record<string, string[]>;

const posix = (file: string): string => path.resolve(file).split(path.sep).join("/");

/** A known file of the line's world: where it is, which side it is on, and its path as rows show it. */
type Known = { readonly full: string; readonly side: "island" | "built"; readonly shown: string; readonly story: string };

/** The file `base` names, trying TypeScript's and Node's spellings, among `known`. */
function fileAt(base: string, known: ReadonlyMap<string, Known>): string | undefined {
  const ext = path.posix.extname(base);
  const tries = [base, ...(COMPILED[ext] ?? []).map((to) => base.slice(0, -ext.length) + to), ...EXTENSIONS.map((one) => base + one), ...EXTENSIONS.map((one) => `${base}/index${one}`)];
  return tries.find((one) => known.has(one));
}

/** JSON with comments and trailing commas, as tsconfig.json is written; undefined when it cannot be read. */
function jsonc(text: string): unknown {
  let plain = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === "\"") {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = at;
      const string = end.exec(text)?.[0] ?? text.slice(at);
      plain += string;
      at += string.length - 1;
    } else if (text.startsWith("//", at)) {
      at = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at) - 1;
    } else if (text.startsWith("/*", at)) {
      at = text.indexOf("*/", at) < 0 ? text.length : text.indexOf("*/", at) + 1;
    } else plain += char;
  }
  try {
    return JSON.parse(plain.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

/** A tsconfig's path aliases: each key's text before and after its `*`, and its targets as full paths, `*` kept. */
type Aliases = readonly { readonly before: string; readonly after?: string; readonly targets: readonly string[] }[];

/** Reads each folder's nearest tsconfig.json once, up to a root, for its path aliases. */
function aliasReader(readText: (file: string) => Promise<string>) {
  const at = new Map<string, Promise<Aliases>>();
  const own = async (dir: string): Promise<Aliases | undefined> => {
    const text = await readText(`${dir}/tsconfig.json`).catch(() => undefined);
    if (text === undefined) return undefined;
    const options = (jsonc(text) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | undefined)?.compilerOptions;
    const base = typeof options?.baseUrl === "string" ? path.posix.join(dir, options.baseUrl) : dir;
    const paths = typeof options?.paths === "object" && options.paths !== null ? Object.entries(options.paths) : [];
    return paths.map(([key, targets]) => {
      const star = key.indexOf("*");
      const listed = Array.isArray(targets) ? targets.filter((one): one is string => typeof one === "string") : [];
      return { before: star < 0 ? key : key.slice(0, star), ...(star < 0 ? {} : { after: key.slice(star + 1) }), targets: listed.map((one) => path.posix.join(base, one)) };
    }).sort((a, b) => b.before.length - a.before.length);
  };
  const of = (dir: string, root: string): Promise<Aliases> => {
    let found = at.get(dir);
    if (found === undefined) {
      found = own(dir).then((aliases) => aliases ?? (dir === root || !dir.startsWith(`${root}/`) ? [] : of(path.posix.dirname(dir), root)));
      at.set(dir, found);
    }
    return found;
  };
  return of;
}

/** A mapped package: its folder, name, literal exports and main. */
type MappedPackage = { readonly dir: string; readonly name: string; readonly exports: Readonly<Record<string, string>>; readonly main?: string };

/** The regex a pattern of the line matches paths from the import's folder with: a folder takes what is under it. */
function patternOf(pattern: string): RegExp {
  const parts = pattern.replace(/^\.\//, "").replace(/\/+$/, "").split("/").map((segment) => segment === "**" ? ".*" : segment.split("*").map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"));
  return new RegExp(`^${parts.join("/").replace(/^\.\*\//, "(?:.*/)?").replace(/\/\.\*\//g, "/(?:.*/)?")}(?:/.*)?$`);
}

/** What crosses the line `options` draws in a mapped island of `survey`, read from disk (`readText`) only now. */
export async function crossingsOf(
  tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>, checkout: string, options: CrossingOptions,
  { ceiling = CEILING, readText = async (file: string) => (await import("node:fs/promises")).readFile(file, "utf8") }: { ceiling?: number; readText?: (file: string) => Promise<string> } = {},
): Promise<CrossingAnswer> {
  const mode = options.mode ?? "counts";
  const mapped = tree.stories.filter((story) => story.mapped !== undefined && survey[story.id]?.mapped !== undefined);
  let candidates = mapped;
  if (options.story !== undefined) {
    const wanted = options.story.toLowerCase();
    candidates = mapped.filter((story) => story.id === options.story || story.title.toLowerCase() === wanted);
    if (candidates.length === 0) throw new Error(`${options.story} is not a mapped story this machine imports.`);
  }
  if (options.patterns.length === 0) throw new Error("Name the folders or file patterns the line is drawn round.");

  // An explored capability stands for the paths it covers, within its own story.
  const named = options.patterns.filter((pattern) => pattern.startsWith("cap:"));
  const covering = new Map<string, readonly string[]>();
  for (const pattern of named) {
    const wanted = pattern.slice(4);
    const found = candidates.flatMap((story) => story.capabilities
      .filter((capability) => capability.id === wanted || /^\s*(\d+)\s*·/.exec(capability.title)?.[1] === wanted)
      .map((capability) => ({ story, capability })));
    if (found.length === 0) throw new Error(`${pattern} is not a capability of a mapped story this machine imports.`);
    if (found.length > 1) throw new Error(`Ambiguous ${pattern}; use an id: ${found.map(({ story, capability }) => `${capability.id} (${story.title})`).join(", ")}`);
    const { story, capability } = found[0]!;
    if (capability.covers === undefined) throw new Error(`${pattern} (${capability.title}) covers no files: it is not an explored capability. Give its folders.`);
    covering.set(story.id, [...covering.get(story.id) ?? [], ...capability.covers]);
  }

  // The files the line takes, by full path, with the import each belongs to.
  const inside = new Map<string, { readonly folder: string; readonly story: string }>();
  for (const story of candidates) {
    const folder = posix(survey[story.id]!.mapped!.folder);
    const given = [...options.patterns.filter((pattern) => !pattern.startsWith("cap:")), ...covering.get(story.id) ?? []];
    const relative = given.flatMap((pattern) => {
      if (!path.isAbsolute(pattern)) return [pattern];
      const full = posix(pattern);
      return full === folder ? ["."] : full.startsWith(`${folder}/`) ? [full.slice(folder.length + 1)] : [];
    });
    const matchers = relative.map((pattern) => pattern === "." ? /^/ : patternOf(pattern));
    for (const file of survey[story.id]!.files) {
      if (matchers.some((matcher) => matcher.test(file.path))) inside.set(`${folder}/${file.path}`, { folder, story: story.id });
    }
  }
  if (inside.size === 0) throw new Error(`No mapped file matches ${options.patterns.join(", ")}.`);
  const folders = [...new Set([...inside.values()].map(({ folder }) => folder))];
  if (folders.length > 1) throw new Error(`The line takes files of two imports (${folders.join(", ")}); name a mapped story with --select story:<name>, or give full paths.`);
  const island = folders[0]!;
  const islandStories = mapped.filter((story) => posix(survey[story.id]!.mapped!.folder) === island);

  // Every file the line's world knows: the island's mapped files and every built story's files and tests.
  const known = new Map<string, Known>();
  for (const story of islandStories) {
    for (const file of survey[story.id]!.files) known.set(`${island}/${file.path}`, { full: `${island}/${file.path}`, side: "island", shown: file.path, story: story.id });
  }
  const root = posix(checkout);
  for (const story of tree.stories) {
    const read = survey[story.id];
    if (story.mapped !== undefined || read === undefined) continue;
    // A built story's paths are from its package's folder (packages/<package>); rows show them from the checkout.
    for (const file of [...read.files, ...read.tests ?? []]) {
      const shown = path.posix.normalize(`packages/${packageOf(story.title)}/${file.path}`);
      known.set(`${root}/${shown}`, { full: `${root}/${shown}`, side: "built", shown, story: story.id });
    }
  }

  const packages = (await Promise.all(islandStories.map(async (story): Promise<MappedPackage | undefined> => {
    const dir = path.posix.join(island, story.mapped!.package);
    const text = await readText(`${dir}/package.json`).catch(() => undefined);
    const manifest = text === undefined ? undefined : manifestFrom(text);
    if (manifest === undefined) return undefined;
    const main = (JSON.parse(text!) as { main?: unknown }).main;
    return { dir, name: manifest.name, exports: manifest.exports, ...(typeof main === "string" ? { main } : {}) };
  }))).filter((one): one is MappedPackage => one !== undefined);
  const aliases = aliasReader(readText);

  async function resolve(from: Known, specifier: string): Promise<string | undefined> {
    const dir = path.posix.dirname(from.full);
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") return fileAt(path.posix.join(dir, specifier), known);
    const pkg = packages.find(({ name }) => specifier === name || specifier.startsWith(`${name}/`));
    if (pkg !== undefined) {
      const subpath = specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
      const exported = pkg.exports[subpath];
      if (exported !== undefined) return fileAt(path.posix.join(pkg.dir, exported), known);
      if (subpath === ".") return (pkg.main === undefined ? undefined : fileAt(path.posix.join(pkg.dir, pkg.main), known)) ?? fileAt(`${pkg.dir}/index`, known);
      return fileAt(path.posix.join(pkg.dir, subpath), known);
    }
    for (const alias of await aliases(dir, from.side === "island" ? island : root)) {
      const star = alias.after === undefined ? undefined : specifier.startsWith(alias.before) && specifier.endsWith(alias.after) && specifier.length >= alias.before.length + alias.after.length
        ? specifier.slice(alias.before.length, specifier.length - alias.after.length) : undefined;
      if (alias.after === undefined ? specifier !== alias.before : star === undefined) continue;
      for (const target of alias.targets) {
        const found = fileAt(star === undefined ? target : target.replace("*", star), known);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  async function importsFrom(file: Known): Promise<string[]> {
    const text = await readText(file.full).catch(() => undefined);
    if (text === undefined) return [];
    const found = await Promise.all(specifiersOf({ path: file.full, text }).map((specifier) => resolve(file, specifier)));
    return found.filter((to): to is string => to !== undefined);
  }

  const rows: CrossingRow[] = [];
  const files = [...known.values()];
  for (let at = 0; at < files.length; at += 64) {
    await Promise.all(files.slice(at, at + 64).map(async (file) => {
      const within = inside.has(file.full);
      for (const to of new Set(await importsFrom(file))) {
        if (inside.has(to) === within) continue;
        const target = known.get(to)!;
        rows.push(within
          ? { direction: "out", side: target.side, from: file.shown, to: target.shown }
          : { direction: "in", side: file.side, from: file.shown, to: target.shown });
      }
    }));
  }
  rows.sort((a, b) => a.direction.localeCompare(b.direction) || a.side.localeCompare(b.side) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const side = (direction: CrossingRow["direction"], on: CrossingRow["side"]): CrossingSide => {
    const crossing = rows.filter((row) => row.direction === direction && row.side === on);
    return { files: new Set(crossing.map((row) => row.from)).size, imports: crossing.length };
  };
  const refused = mode === "show" && rows.length > ceiling;
  const lined = new Set([...inside.values()].map(({ story }) => story));
  return {
    // The island as this machine names it: native separators, not the posix form matching uses.
    mode, island: path.resolve(survey[islandStories[0]!.id]!.mapped!.folder), stories: islandStories.filter((story) => lined.has(story.id)).map((story) => story.title), patterns: options.patterns,
    inside: inside.size,
    in: { island: side("in", "island"), built: side("in", "built") },
    out: { island: side("out", "island"), built: side("out", "built") },
    rowCount: rows.length, refused, ceiling, note: CROSSING_NOTE,
    ...(mode === "show" && !refused ? { rows } : {}),
  };
}

/** The CLI and the focus tool share this readable answer as well as the JSON. */
export function formatCrossing(answer: CrossingAnswer): string {
  const count = ({ files, imports }: CrossingSide) => `${files} ${files === 1 ? "file" : "files"}, ${imports} ${imports === 1 ? "import" : "imports"}`;
  const lines = [
    `Line round ${answer.inside} ${answer.inside === 1 ? "file" : "files"} of ${answer.island} (${answer.stories.join(", ")}).`,
    `In, from the island's other files: ${count(answer.in.island)}; from built stories: ${count(answer.in.built)}.`,
    `Out, to the island's other files: ${count(answer.out.island)}; to built stories: ${count(answer.out.built)}.`,
    answer.note,
  ];
  if (answer.refused) lines.push(`Show refused: ${answer.rowCount} imports exceeds the ceiling of ${answer.ceiling}. Narrow the line.`);
  for (const row of answer.rows ?? []) lines.push(`${row.direction}  ${row.side}  ${row.from} -> ${row.to}`);
  if (answer.mode === "counts") lines.push("Use --show (the focus tool's mode show) to list each import.");
  return lines.join("\n");
}
