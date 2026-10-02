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
 * - A package-prefixed title proves that package's numbered contracts (ADR-0845). A foreign prefix
 *   never assigns the importing package's code to a same-numbered local capability.
 * - Where no import leads, because a test runs the code in a process it starts, the package's coverage
 *   map (ADR-0838 D3, written by the dev loop's `pnpm survey:coverage`) says which numbered tests
 *   executed it. Executed ranks after a direct import and before a further one: a file a test imports
 *   is its subject, and code a test ran is nearer to it than code only imported along the way.
 * - A file reached only through type imports (a file of types) goes, after every other reach, to the
 *   capability whose tests reach it so nearest (ADR-0838 D4). A literal `import("./x.js")` is an import.
 * - A file nothing reaches is Unclaimed: no capability. Its folder's name allocates nothing, since name
 *   matching is brittle (ADR-0838 D3 retired the fallback).
 * - Lines are a file's non-blank lines. Test files, and test helpers under a testing/ folder, are read for
 *   their titles and imports, never counted. They remain as tagged tests in the survey (ADR-0864).
 * Capability records gain no file list: ownership is derived here, each time.
 */
import { parse } from "@babel/parser";

/** A file of a story's package: its path from the package root, and its text. */
export type SourceFile = { readonly path: string; readonly text: string };

/** A capability as the survey needs it: its id and its numbered title ("3 · Claims"). */
export type SurveyCapability = { readonly id: string; readonly title: string };

/** A surveyed source file. `capability` is absent for Unclaimed ground. */
export type SurveyedFile = { readonly path: string; readonly lines: number; readonly capability?: string };

/** An import from one source file to another. */
export type FileImport = { readonly from: string; readonly to: string };

/** A test or test helper, kept apart from source-line counts with its numbered identities and imports. */
export type SurveyedTest = {
  readonly kind: "test";
  readonly path: string;
  readonly titles: readonly { readonly number: string; readonly title: string; readonly package?: string }[];
  readonly imports: readonly FileImport[];
};

export type StorySurvey = {
  readonly files: readonly SurveyedFile[];
  readonly imports: readonly FileImport[];
  /** Numbered tests and helpers; absent only in older saved surveys. */
  readonly tests?: readonly SurveyedTest[];
  /** The stories whose packages this story's package depends on, through any field of its package.json; absent when it has none (ADR-0840 D2). */
  readonly dependsOn?: readonly string[];
};

/** A package's coverage map: for each source file, how many numbered tests of each capability number executed it. */
export type CoverageMap = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Where executed code ranks among import depths: after a direct import (0), before a further one (1). */
const EXECUTED = 0.5;

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = { "command-line": "cli", "world": "forest-world", "local-database": "local-postgres", "process-ledger": "processes" };

/** The package a story's code lives in: named after its title ("The agent link" is packages/agent-link), but for a few named otherwise. */
export function packageOf(title: string): string {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return PACKAGE_NAMED_OTHERWISE[name] ?? name;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** A test file, or a test helper under a testing/ folder: never counted as source, though a test reaches through a helper. */
const TEST_SUPPORT = /(?:^|\/)testing\//;
const isTestCode = (path: string): boolean => TEST_FILE.test(path) || TEST_SUPPORT.test(path);
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const NUMBERED_TITLE = /^(?:([a-z][a-z0-9-]*)\s+)?(\d+)\.\d+\b/;
/** `import … from "./x.js"`, `export … from "./x.js"`, `import "./x.js"` and `import("./x.js")`: kind, names, specifier. */
const RELATIVE_IMPORT = /\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*\bfrom\s*["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** Where a reach by types alone ranks: after every reach by a value or by running (ADR-0838 D4). */
const BY_TYPES = 1000;

/** The capability number a numbered title starts with ("3 · Claims" is 3). */
const numberOf = (title: string): number | undefined => {
  const match = /^\s*(\d+)\s*·/.exec(title);
  return match === null ? undefined : Number(match[1]);
};

/** First-argument title strings, including helpers and local constants, without reading comments or quoted examples as calls. */
function calledTitles(file: SourceFile): readonly string[] {
  let text = file.text;
  // Regex quotes and call-looking text are inert; keep offsets for the existing title scan.
  for (const token of syntaxOf(file, true)?.tokens ?? []) {
    if (typeof token.type === "string" || token.type.label !== "regexp") continue;
    text = text.slice(0, token.start) + text.slice(token.start, token.end).replace(/[^\r\n]/g, " ") + text.slice(token.end);
  }
  const strings: { at: number; quote: string; value: string }[] = [];
  const code = text.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (token: string, quote: string | undefined, at: number) => {
    if (quote !== undefined) strings.push({ at, quote, value: token.slice(1, -1) });
    return token.replace(/[^\r\n]/g, " ");
  });
  const constants = new Map<string, string>();
  for (const { at, value } of strings) {
    const name = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(code.slice(0, at))?.[1];
    if (name !== undefined) constants.set(name, value);
  }
  const titles: { at: number; title: string }[] = [];
  for (const { at, quote, value } of strings) {
    if (!/[\w$.]\s*\(\s*$/.test(code.slice(0, at))) continue;
    const template = quote === "`" ? /^\$\{\s*([A-Za-z_$][\w$]*)\s*\}([\s\S]*)$/.exec(value) : null;
    const prefix = template === null ? undefined : constants.get(template[1]!);
    const title = template === null ? value : prefix === undefined ? undefined : prefix + template[2];
    if (title !== undefined) titles.push({ at, title });
  }
  for (const call of code.matchAll(/[\w$.]\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    const title = constants.get(call[1]!);
    if (title !== undefined) titles.push({ at: call.index, title });
  }
  return titles.sort((a, b) => a.at - b.at).map(({ title }) => title);
}

/** ADR-0845 proof identities: an optional package, then the leading contract list used by own-health. */
function proofTitles(titles: readonly string[]): SurveyedTest["titles"] {
  return titles.flatMap(title => {
    const lead = /^(?:([a-z][a-z0-9-]*)\s+)?(\d+\.\d+(?:–\d+\.\d+)?(?:(?:\s*[,/]\s*|\s+and\s+)\d+\.\d+(?:–\d+\.\d+)?)*):?(?=\s|$)/.exec(title!);
    if (!lead) return [];
    const numbers = new Set<string>();
    for (const [, first, last] of lead[2]!.matchAll(/(\d+\.\d+)(?:–(\d+\.\d+))?/g)) {
      numbers.add(first!);
      if (last === undefined) continue;
      const [capability, start] = first!.split(".");
      const [endCapability, end] = last.split(".");
      if (capability !== endCapability || !Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end)) || Number(end) < Number(start)) return [];
      for (let number = Number(start) + 1; number <= Number(end); number++) numbers.add(`${capability}.${number}`);
    }
    return [...numbers].map(number => ({ number, title: title!, ...(lead[1] === undefined ? {} : { package: lead[1] }) }));
  });
}

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
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
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

/** Parse each unchanged source once; the ownership walk can visit it from many tests. */
const importSyntax = new WeakMap<SourceFile, readonly RegExpExecArray[]>();

/** Keep the parseable prefix while a file is being edited; never fall back to raw-text edges. */
function syntaxOf(file: SourceFile, tokens = false): ReturnType<typeof parse> | undefined {
  let text = file.text;
  for (;;) {
    try {
      return parse(text, {
        sourceType: "unambiguous", errorRecovery: true, allowUndeclaredExports: true,
        createImportExpressions: true, attachComment: false, tokens,
        plugins: ["decorators-legacy", ...(/\.[cm]?tsx?$/.test(file.path) ? ["typescript" as const] : []), ...(/\.[jt]sx$/.test(file.path) ? ["jsx" as const] : [])],
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const at = (error as SyntaxError & { pos?: number }).pos ?? text.length;
      const end = Math.max(text.lastIndexOf("\n", at - 1), text.lastIndexOf(";", at - 1));
      if (end < 0) return undefined;
      text = text.slice(0, end);
    }
  }
}

/** Only syntax nodes can start an edge. Strings, comments, regexes and template text cannot. */
function importsOf(file: SourceFile): readonly RegExpExecArray[] {
  const cached = importSyntax.get(file);
  if (cached !== undefined) return cached;
  const syntax = syntaxOf(file);
  const starts: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as { type: string; start?: number; source?: unknown };
    if (node.start !== undefined && (node.type === "ImportDeclaration" || node.type === "ImportExpression" || node.type === "TSImportType"
      || ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source))) starts.push(node.start);
    Object.values(value).forEach(visit);
  };
  visit(syntax?.program);
  let text = file.text;
  for (const comment of [...syntax?.comments ?? []].reverse()) {
    text = text.slice(0, comment.start) + text.slice(comment.start, comment.end).replace(/[^\r\n]/g, " ") + text.slice(comment.end);
  }
  const pattern = new RegExp(RELATIVE_IMPORT.source, "y");
  const imports = starts.sort((a, b) => a - b).flatMap(at => {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    return match === null ? [] : [match];
  });
  importSyntax.set(file, imports);
  return imports;
}

function edgesOf(file: SourceFile, paths: ReadonlySet<string>): Edge[] {
  return importsOf(file).flatMap((match): Edge[] => {
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
  // Then what is reached only by types: through any import, type ones included, from what was reached.
  const typed = new Map<string, number>();
  const frontier: [string, number][] = [[test.path, 0], ...[...taken].map(([path, { depth }]) => [path, depth] as [string, number])];
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    const [path, depth] = next;
    for (const edge of edgesOf(byPath.get(path)!, paths)) {
      if (taken.has(edge.to) || typed.has(edge.to) || TEST_FILE.test(edge.to)) continue;
      typed.set(edge.to, BY_TYPES + depth);
      frontier.push([edge.to, depth + 1]);
    }
  }
  return new Map([...[...taken].map(([path, { depth }]) => [path, depth] as const), ...typed]);
}

/** Survey one story's package: source files, ownership and imports. `ownPackage` also accepts its own prefixed proofs. */
export function surveyStory(tree: readonly SourceFile[], capabilities: readonly SurveyCapability[], coverage: CoverageMap = {}, ownPackage?: string): StorySurvey {
  const code = tree.filter((file) => CODE_FILE.test(file.path) && !DECLARATION.test(file.path));
  const paths = new Set(code.map((file) => file.path));
  const byPath = new Map(code.map((file) => [file.path, file]));
  const calls = new Map(code.filter((file) => isTestCode(file.path)).map((file) => [file.path, calledTitles(file)]));
  const byNumber = new Map(capabilities.flatMap((capability) => {
    const number = numberOf(capability.title);
    return number === undefined ? [] : [[number, capability.id] as const];
  }));

  /** For each source file and capability number, how near that capability's numbered tests reach it, and how many reach it that near. */
  const reach = new Map<string, Map<number, { depth: number; count: number }>>();
  for (const test of code.filter((file) => TEST_FILE.test(file.path))) {
    const counts = new Map<number, number>();
    for (const title of calls.get(test.path) ?? []) {
      const named = NUMBERED_TITLE.exec(title);
      if (named === null || (named[1] !== undefined && named[1] !== ownPackage)) continue;
      const number = Number(named[2]);
      if (byNumber.has(number)) counts.set(number, (counts.get(number) ?? 0) + 1);
    }
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

  for (const [path, counts] of Object.entries(coverage)) {
    if (!byPath.has(path)) continue;
    const tally = reach.get(path) ?? new Map<number, { depth: number; count: number }>();
    for (const [number, count] of Object.entries(counts)) {
      const was = tally.get(Number(number));
      if (!byNumber.has(Number(number))) continue;
      if (was === undefined || EXECUTED < was.depth) tally.set(Number(number), { depth: EXECUTED, count });
      else if (was.depth === EXECUTED) was.count += count;
    }
    reach.set(path, tally);
  }

  const sources = code.filter((file) => !isTestCode(file.path));
  const files = sources.map((file): SurveyedFile => {
    const tally = [...(reach.get(file.path) ?? [])].sort(([a, near], [b, far]) => near.depth - far.depth || far.count - near.count || a - b);
    const capability = tally.length > 0 ? byNumber.get(tally[0]![0]) : undefined;
    return capability === undefined ? { path: file.path, lines: linesOf(file.text) } : { path: file.path, lines: linesOf(file.text), capability };
  });
  const imports = sources.flatMap((file) => edgesOf(file, paths).filter((edge) => !isTestCode(edge.to)).map((edge) => ({ from: file.path, to: edge.to })));
  const tests = code.filter((file) => isTestCode(file.path)).map((file): SurveyedTest => ({
    kind: "test",
    path: file.path,
    titles: proofTitles(calls.get(file.path) ?? []),
    imports: edgesOf(file, paths).map((edge) => ({ from: file.path, to: edge.to })),
  }));
  return { files, imports, tests };
}
