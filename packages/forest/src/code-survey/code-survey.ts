/**
 * Capability 8 · Code survey (ADR-0804 D3, D4): a story's code files, each with its lines of code, the
 * capability it belongs to, and the relative imports between them.
 *
 * - A test titled "N.M …" pins capability N of its story. A test file reaches the source files it imports,
 *   and through a re-export (`export … from`) the files that re-export names, so a test of the package's
 *   index reaches what it takes from there. A file belongs to the capability whose numbered tests reach it
 *   most; a tie goes to the lower number.
 * - A file no numbered test reaches falls back to its top source folder, when the folder is a capability's
 *   title slug. Otherwise it is Unclaimed: no capability.
 * - Lines are a file's non-blank lines. Test files are read for their titles and imports, never counted.
 * Capability records gain no file list: ownership is derived here, each time.
 */

/** A file of a story's package: its path from the package root, and its text. */
export type SourceFile = { readonly path: string; readonly text: string };

/** A capability as the survey needs it: its id and its numbered title ("3 · Claims"). */
export type SurveyCapability = { readonly id: string; readonly title: string };

/** A surveyed source file. `capability` is absent for Unclaimed ground. */
export type SurveyedFile = { readonly path: string; readonly lines: number; readonly capability?: string };

/** An import from one source file to another. */
export type FileImport = { readonly from: string; readonly to: string };

export type StorySurvey = { readonly files: readonly SurveyedFile[]; readonly imports: readonly FileImport[] };

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = { "command-line": "cli", "world": "forest-world", "local-database": "local-postgres", "process-ledger": "processes" };

/** The package a story's code lives in: named after its title ("The agent link" is packages/agent-link), but for a few named otherwise. */
export function packageOf(title: string): string {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return PACKAGE_NAMED_OTHERWISE[name] ?? name;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const NUMBERED_TEST = /\b(?:test|it|describe)\s*\(\s*["'`](\d+)\.\d+\b/g;
/** `import … from "./x.js"`, `export … from "./x.js"` and `import "./x.js"`: kind, names, specifier. */
const RELATIVE_IMPORT = /\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*\bfrom\s*["'](\.{1,2}\/[^"']+)["']|\bimport\s*["'](\.{1,2}\/[^"']+)["']/g;

/** The capability number a numbered title starts with ("3 · Claims" is 3). */
const numberOf = (title: string): number | undefined => {
  const match = /^\s*(\d+)\s*·/.exec(title);
  return match === null ? undefined : Number(match[1]);
};

/** A title's slug without its number: "3 · Agent claims" is "agent-claims". */
const slugOf = (title: string): string => title.replace(/^\s*\d+\s*·\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const linesOf = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;

/**
 * One relative import or re-export a file makes: the file it names, and the names it takes, each as that
 * file exports it (`names`) and as this file offers it on (`as`); "all" for `*` or a bare import.
 */
type Edge = { readonly to: string; readonly reexport: boolean; readonly typeOnly: boolean; readonly names: readonly (readonly [name: string, as: string])[] | "all" };

/** Resolve a relative specifier against the importing file, to a file the package holds. */
function resolve(from: string, specifier: string, paths: ReadonlySet<string>): string | undefined {
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  const target = parts.join("/");
  const stem = target.replace(/\.[cm]?jsx?$/, "");
  return [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${target}/index.ts`, `${target}/index.tsx`, `${target}/index.js`].find((candidate) => paths.has(candidate));
}

/** The names an import or export clause takes; "all" for `*` or no clause. */
function namesOf(clause: string): Edge["names"] {
  if (clause.includes("*") || clause.trim() === "") return "all";
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces === null) return [["default", "default"]];
  return braces[1]!.split(",").map((part) => part.trim().replace(/^type\s+/, "")).filter((part) => part !== "").map((part) => {
    const [name, as] = part.split(/\s+as\s+/);
    return [name!.trim(), (as ?? name!).trim()] as const;
  });
}

function edgesOf(file: SourceFile, paths: ReadonlySet<string>): Edge[] {
  return [...file.text.matchAll(RELATIVE_IMPORT)].flatMap((match): Edge[] => {
    const to = resolve(file.path, match[4] ?? match[5]!, paths);
    if (to === undefined) return [];
    return [{ to, reexport: match[1] === "export", typeOnly: match[2] !== undefined, names: match[5] !== undefined ? "all" : namesOf(match[3] ?? "") }];
  });
}

/** The source files a test file reaches: what it imports, and through re-exports the files the names it takes come from. */
function reached(test: SourceFile, byPath: ReadonlyMap<string, SourceFile>, paths: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const visit = (path: string, wanted: readonly string[] | "all", seen: ReadonlySet<string>): void => {
    const file = byPath.get(path);
    if (file === undefined || seen.has(path)) return;
    found.add(path);
    for (const edge of edgesOf(file, paths)) {
      if (!edge.reexport || edge.typeOnly) continue;
      const onward = edge.names === "all" ? wanted : edge.names.filter(([, as]) => wanted === "all" || wanted.includes(as)).map(([name]) => name);
      if (onward === "all" || onward.length > 0) visit(edge.to, onward, new Set([...seen, path]));
    }
  };
  for (const edge of edgesOf(test, paths)) {
    if (!edge.typeOnly && !edge.reexport && !TEST_FILE.test(edge.to)) visit(edge.to, edge.names === "all" ? "all" : edge.names.map(([name]) => name), new Set());
  }
  return found;
}

/** Survey one story's package: every source file with its lines and owner, and the imports between them. */
export function surveyStory(tree: readonly SourceFile[], capabilities: readonly SurveyCapability[]): StorySurvey {
  const code = tree.filter((file) => CODE_FILE.test(file.path) && !DECLARATION.test(file.path));
  const paths = new Set(code.map((file) => file.path));
  const byPath = new Map(code.map((file) => [file.path, file]));
  const byNumber = new Map(capabilities.flatMap((capability) => {
    const number = numberOf(capability.title);
    return number === undefined ? [] : [[number, capability.id] as const];
  }));
  const bySlug = new Map(capabilities.map((capability) => [slugOf(capability.title), capability.id]));

  /** For each source file, how many numbered tests of each capability number reach it. */
  const reach = new Map<string, Map<number, number>>();
  for (const test of code.filter((file) => TEST_FILE.test(file.path))) {
    const counts = new Map<number, number>();
    for (const [, number] of test.text.matchAll(NUMBERED_TEST)) if (byNumber.has(Number(number))) counts.set(Number(number), (counts.get(Number(number)) ?? 0) + 1);
    if (counts.size === 0) continue;
    for (const path of reached(test, byPath, paths)) {
      const tally = reach.get(path) ?? new Map<number, number>();
      for (const [number, count] of counts) tally.set(number, (tally.get(number) ?? 0) + count);
      reach.set(path, tally);
    }
  }

  const sources = code.filter((file) => !TEST_FILE.test(file.path));
  const files = sources.map((file): SurveyedFile => {
    const tally = [...(reach.get(file.path) ?? [])].sort(([a, countA], [b, countB]) => countB - countA || a - b);
    const folder = /^src\/([^/]+)\//.exec(file.path)?.[1];
    const capability = tally.length > 0 ? byNumber.get(tally[0]![0]) : folder === undefined ? undefined : bySlug.get(folder);
    return capability === undefined ? { path: file.path, lines: linesOf(file.text) } : { path: file.path, lines: linesOf(file.text), capability };
  });
  const imports = sources.flatMap((file) => edgesOf(file, paths).filter((edge) => !TEST_FILE.test(edge.to)).map((edge) => ({ from: file.path, to: edge.to })));
  return { files, imports };
}
