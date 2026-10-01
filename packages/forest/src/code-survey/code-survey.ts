/**
 * Capability 8 · Code survey (ADR-0804 D3, D4): a story's code files, each with its lines of code, the
 * capability it belongs to, and the relative imports between them.
 *
 * - A test titled "N.M …" pins capability N of its story. A test file reaches the source files it imports,
 *   every file those import in turn, through any number of ordinary imports (ADR-0838 D2), and through a
 *   re-export (`export … from`) the files the names it takes come from, so a test of the package's index
 *   reaches what it takes from there. A file belongs to the capability whose numbered tests reach it
 *   nearest (fewest ordinary imports away), then most; a tie goes to the lower number. So a test's own
 *   subject stays its own, and a file reached only through others goes to the capability nearest it.
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

/**
 * The source files a test file reaches, each with how near: what it imports (0), and through a re-export
 * the file the names it takes come from (as near as the file re-exporting them), and every file those
 * import in turn through any number of ordinary imports (one further for each).
 */
function reached(test: SourceFile, byPath: ReadonlyMap<string, SourceFile>, paths: ReadonlySet<string>): Map<string, number> {
  type Step = { readonly path: string; readonly wanted: readonly string[] | "all"; readonly depth: number };
  /** Each reached file: how near, and the names re-exports were followed for ("all" once every name was). */
  const taken = new Map<string, { readonly depth: number; names: Set<string> | "all" }>();
  // Nearest first: a re-export keeps its depth (to the front), an ordinary import is one further (to the back).
  const queue: Step[] = edgesOf(test, paths).filter((edge) => !edge.typeOnly && !edge.reexport).map((edge) => ({ path: edge.to, wanted: edge.names === "all" ? "all" : edge.names.map(([name]) => name), depth: 0 }));
  for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
    const file = byPath.get(step.path);
    if (file === undefined || TEST_FILE.test(step.path)) continue;
    const before = taken.get(step.path);
    if (before?.names === "all") continue;
    const fresh = step.wanted === "all" ? "all" : step.wanted.filter((name) => before === undefined || !(before.names as Set<string>).has(name));
    if (before !== undefined && fresh !== "all" && fresh.length === 0) continue;
    if (before === undefined) taken.set(step.path, { depth: step.depth, names: fresh === "all" ? "all" : new Set(fresh) });
    else before.names = fresh === "all" ? "all" : new Set([...before.names, ...fresh]);
    for (const edge of edgesOf(file, paths)) {
      if (edge.typeOnly) continue;
      // A file that runs runs its own imports, once; a re-export carries only the names asked of it.
      if (!edge.reexport) {
        if (before === undefined) queue.push({ path: edge.to, wanted: edge.names === "all" ? "all" : edge.names.map(([name]) => name), depth: step.depth + 1 });
        continue;
      }
      const onward = edge.names === "all" ? fresh : edge.names.filter(([, as]) => fresh === "all" || fresh.includes(as)).map(([name]) => name);
      if (onward === "all" || onward.length > 0) queue.unshift({ path: edge.to, wanted: onward, depth: step.depth });
    }
  }
  return new Map([...taken].map(([path, { depth }]) => [path, depth]));
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

  /** For each source file and capability number, how near that capability's numbered tests reach it, and how many reach it that near. */
  const reach = new Map<string, Map<number, { depth: number; count: number }>>();
  for (const test of code.filter((file) => TEST_FILE.test(file.path))) {
    const counts = new Map<number, number>();
    for (const [, number] of test.text.matchAll(NUMBERED_TEST)) if (byNumber.has(Number(number))) counts.set(Number(number), (counts.get(Number(number)) ?? 0) + 1);
    if (counts.size === 0) continue;
    for (const [path, depth] of reached(test, byPath, paths)) {
      const tally = reach.get(path) ?? new Map<number, { depth: number; count: number }>();
      for (const [number, count] of counts) {
        const was = tally.get(number);
        if (was === undefined || depth < was.depth) tally.set(number, { depth, count });
        else if (depth === was.depth) was.count += count;
      }
      reach.set(path, tally);
    }
  }

  const sources = code.filter((file) => !TEST_FILE.test(file.path));
  const files = sources.map((file): SurveyedFile => {
    const tally = [...(reach.get(file.path) ?? [])].sort(([a, near], [b, far]) => near.depth - far.depth || far.count - near.count || a - b);
    const folder = /^src\/([^/]+)\//.exec(file.path)?.[1];
    const capability = tally.length > 0 ? byNumber.get(tally[0]![0]) : folder === undefined ? undefined : bySlug.get(folder);
    return capability === undefined ? { path: file.path, lines: linesOf(file.text) } : { path: file.path, lines: linesOf(file.text), capability };
  });
  const imports = sources.flatMap((file) => edgesOf(file, paths).filter((edge) => !TEST_FILE.test(edge.to)).map((edge) => ({ from: file.path, to: edge.to })));
  return { files, imports };
}
