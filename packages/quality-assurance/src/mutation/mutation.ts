/**
 * Capability 7 · Mutation report (ADR-1153 D1). Each change gets a small mutation report: at most one deliberate break per
 * changed source line, about 15 in all, each run against only the tests that reach its file; a break no test notices
 * survives, and each survivor is a hit recorded with the review, ranked by how many files depend on its file.
 *
 * - A break is planted only on a line the change adds, in a source file (never a test or a test helper), one per line at the
 *   first place on it a break fits; with more than the cap, they are spread evenly across the change (7.1). A line it adds just
 *   as a line it deletes, ignoring indentation, in its own diff or another half's, was moved, not written, and gets none (7.11).
 * - Arid lines get none (7.1): a logging or output call, the setting of an upper-case constant, and every line on the arid
 *   list, which a rejected survivor's line joins (7.4).
 * - The tests that reach a file are the test files whose imports lead to it in its own package (or its own infra/ folder, a
 *   unit `pnpm test` runs though no package), a file an esbuild build names under `entryPoints` counting as imported by the file
 *   naming it (the capture kit's bundle of the desktop page, 7.2), with the test files numbered for the capabilities its package's
 *   coverage map credits it to, the map that follows the processes a test starts (a hook or a command run as a child, 7.2),
 *   every one of them however many, or, when none there does, in the packages downstream of it, nearest first and
 *   at most {@link TEST_CAP}. A break is caught when a test that passed with nothing broken
 *   no longer passes with it planted, so a test that fails unbroken is left out and its file's other tests still count (7.6); a break with
 *   no test left that passes unbroken is not run and says why; a file no test reaches at all survives untried (7.2). A break its own package's tests miss, or cannot
 *   judge because they all fail unbroken, is run against the tests downstream that reach its file before it survives, and one
 *   those cannot judge either, or the report's time runs out on there, is not run, never a survivor (7.5).
 * - The report runs with the brief read from a change's worktree and is kept with that review; taking the review's return
 *   records each survivor as a hit found by the mutation report (7.3). It never blocks: a report that cannot run says why and
 *   the brief goes on, and a rejected survivor needs no reviewer to accept it (7.4). Each outside checkout the brief reads, the
 *   factory worktree or a checkout named as the change's other half, gets its own report on its diff, kept with the same review and
 *   shown under its folder, its survivors recorded the same way, naming it (7.10).
 * - Breaks are never written into the checkout the report is given: its tests run in a throwaway copy of it in the temp
 *   folder, holding its own copy of each package a break or a test is in and links to the rest, so a reader of the checkout
 *   (a reviewer, or another report beside it) only ever sees its own files. A report killed outright leaves its copy, which
 *   the next report removes (7.8).
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "@babel/parser";
import { dependenciesOf, specifiersOf, type SourceFile, type SurveyPackage } from "@storytree/map";
import { SESSION_ENV, WATCHED_HARNESSES } from "@storytree/project-and-caller/caller";
import type { Storytree } from "@storytree/library";

import { inTransaction, ledgerDatabase, writeReview, type HitRow } from "../ledger/ledger.js";
import { briefText, outsideCheckouts, packageOf, type Brief, type Reviews, type Taken } from "../review/review.js";
import { folderOf, PackageGraph, readPackages } from "../risk/risk.js";

/** The most breaks one change gets (ADR-1153 D1: "about 15"). */
export const BREAK_CAP = 15;

/** The most test files downstream of its package one changed file's breaks run against, nearest first; its own package's are not capped. */
export const TEST_CAP = 20;

/** The check a survivor is recorded under in the QA ledger. */
export const MUTATION_SURVIVOR = "mutation-survivor";

/** The signals that end a report, after which it puts back what it changed. */
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** The start of a throwaway Postgres folder's name, followed by the pid of the report that made it. */
const PG_FOLDER = "st-mutation-pg-";

/** The start of a report's copy of its checkout's name, followed by the pid of the report that made it. */
const COPY_FOLDER = "st-mutation-copy-";

/** How long one report may run before the breaks left are not run. */
const REPORT_BUDGET_MS = 5 * 60_000;

/** A line on the arid list: its file and its text, trimmed, so it is known again wherever the line moves. */
export interface AridLine {
  readonly file: string;
  readonly source: string;
}

/** One deliberate break: where, what it changes, and the file's text with it planted. */
export interface Break {
  readonly file: string;
  readonly line: number;
  /** The line's text, trimmed: the arid list's key when its survivor is rejected. */
  readonly source: string;
  /** What the break does, as "`===` to `!==`". */
  readonly what: string;
  readonly at: number;
  readonly length: number;
  readonly replacement: string;
}

/** A break no test noticed. */
export interface Survivor {
  readonly file: string;
  readonly line: number;
  readonly source: string;
  readonly what: string;
  /** How many files depend on its file, through any number of imports: the damage it could do. */
  readonly damage: number;
  /** True when no test reaches its file at all, so it was never run. */
  readonly untried?: true;
}

/** A change's mutation report: what was planted, caught and survived, ranked by damage, and what was not run and why. */
export type MutationReport =
  | {
    readonly ran: true;
    readonly planted: number;
    readonly caught: number;
    readonly survivors: readonly Survivor[];
    readonly notRun: readonly { readonly file: string; readonly line: number; readonly why: string }[];
    /** How many breaks the change had room for before the cap spread them. */
    readonly candidates: number;
    readonly ms: number;
  }
  | { readonly ran: false; readonly reason: string };

const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUPPORT = /(?:^|\/)testing\//;
const DECLARATION = /\.d\.[cm]?ts$/;
/** A numbered test's title, `N.M · …`, optionally after the story it proves (packages/dev-loop/src/survey-coverage.mjs). */
const NUMBERED_TEST = /\b(?:test|it|describe)\s*\(\s*["'`](?:([a-z][a-z0-9-]*)\s+)?(\d+)\.\d+\b/g;
/** A package's coverage map, measured with the processes its tests start followed (ADR-0838 D3). */
const COVERAGE_MAP = "survey-coverage.json";
const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

/**
 * Whether a repository path is source a break may go in: code, and not a test, a test helper, a declaration or a file in a
 * folder the reach walk skips (a hand-run evidence script no test reaches by design, ADR-0794).
 */
export function mutable(file: string): boolean {
  return CODE.test(file) && !TEST.test(file) && !TEST_SUPPORT.test(file) && !DECLARATION.test(file)
    && !file.split("/").slice(0, -1).some((folder) => SKIPPED.has(folder));
}

/** The lines a unified diff adds, by the file they end up in, numbered as there. */
export function addedLines(diff: string): Map<string, number[]> {
  const added = new Map<string, number[]>();
  let file: string | undefined;
  let line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) {
      const named = text.slice(4).trim();
      file = named === "/dev/null" ? undefined : named.replace(/^b\//, "");
      continue;
    }
    if (text.startsWith("--- ") || text.startsWith("diff --git")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      line = Number(hunk[1]);
      continue;
    }
    if (file === undefined || line === 0) continue;
    if (text.startsWith("+")) {
      added.set(file, [...(added.get(file) ?? []), line]);
      line++;
    } else if (text.startsWith(" ")) {
      line++;
    }
  }
  return added;
}

/**
 * The lines `diffs` delete, by their text without its indentation, each with how many times it is deleted: a line a change adds
 * as one of these is one it moved, not wrote (7.11). Each half of a change counts, so a file moved from one checkout into
 * another is a move in both.
 */
export function deletedLines(diffs: readonly string[]): Map<string, number> {
  const deleted = new Map<string, number>();
  for (const diff of diffs) {
    let inHunk = false;
    for (const text of diff.split("\n")) {
      if (text.startsWith("diff --git")) inHunk = false;
      else if (text.startsWith("@@ ")) inHunk = true;
      else if (inHunk && text.startsWith("-")) deleted.set(text.slice(1).trim(), (deleted.get(text.slice(1).trim()) ?? 0) + 1);
    }
  }
  return deleted;
}

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const FLIP: Readonly<Record<string, string>> = {
  "===": "!==", "!==": "===", "==": "!=", "!=": "==",
  "<": ">=", ">=": "<", ">": "<=", "<=": ">",
  "+": "-", "-": "+", "&&": "||", "||": "&&", "??": "&&",
};

/** A call that only logs or writes output: `console.*`, `process.stdout.write`, a logger's or a `log`/`debug`/`warn` call. */
const LOGGING = /^(?:console\.\w+|process\.(?:stdout|stderr)\.write|(?:[\w$]+\.)*(?:log|logger|debug|info|warn|trace)(?:\.\w+)?)$/;
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
/** The TypeScript wrappers round an ordinary expression: only their expression is walked; every other TS node is a type. */
const TS_EXPRESSIONS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"]);
const TYPE_KEYS = new Set(["typeAnnotation", "typeParameters", "typeArguments", "returnType", "superTypeParameters", "implements", "loc", "extra", "comments", "leadingComments", "trailingComments", "innerComments"]);

/**
 * The breaks `text` (the file `file`) has room for on `lines`, one per line at the first place on it a break fits, none on an
 * arid line (7.1). A file that does not parse has none.
 */
export function fileBreaks(file: string, text: string, lines: readonly number[], arid: readonly AridLine[] = []): Break[] {
  let program: Node;
  try {
    program = parse(text, {
      sourceType: "unambiguous", errorRecovery: false,
      plugins: /\.[cm]?tsx?$/.test(file) ? (file.endsWith("x") ? ["typescript", "jsx"] : ["typescript"]) : ["jsx"],
    }).program as unknown as Node;
  } catch {
    return [];
  }
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const sourceOf = (line: number): string => text.slice(starts[line - 1], starts[line] ?? text.length).trim();
  const dry: [number, number][] = [];
  const found: Break[] = [];
  const add = (at: number, length: number, replacement: string, what: string): void => {
    const line = lineOf(at);
    found.push({ file, line, source: sourceOf(line), what, at, length, replacement });
  };
  const visit = (node: Node): void => {
    if (TS_EXPRESSIONS.has(node.type)) {
      visit(node["expression"] as Node);
      return;
    }
    if (node.type.startsWith("TS")) return;
    if (node.type === "CallExpression" && LOGGING.test(text.slice((node["callee"] as Node).start, (node["callee"] as Node).end))) dry.push([node.start, node.end]);
    if (node.type === "VariableDeclarator" && (node["id"] as Node).type === "Identifier" && CONSTANT.test((node["id"] as unknown as { name: string }).name) && node["init"] != null) dry.push([node.start, node.end]);
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      const operator = node["operator"] as string;
      const left = node["left"] as Node;
      const right = node["right"] as Node;
      const words = (side: Node): boolean => side.type === "StringLiteral" || side.type === "TemplateLiteral";
      const flipped = FLIP[operator];
      if (flipped !== undefined && !((operator === "+" || operator === "-") && (words(left) || words(right)))) {
        const at = text.indexOf(operator, left.end);
        if (at !== -1 && at < right.start) add(at, operator.length, flipped, `\`${operator}\` to \`${flipped}\``);
      }
    }
    if (node.type === "BooleanLiteral") add(node.start, node.end - node.start, String(!node["value"]), `\`${String(node["value"])}\` to \`${String(!node["value"])}\``);
    if (node.type === "UnaryExpression" && node["operator"] === "!") add(node.start, 1, "", "`!` dropped");
    for (const [key, child] of Object.entries(node)) {
      if (TYPE_KEYS.has(key)) continue;
      for (const one of Array.isArray(child) ? child : [child]) {
        if (one !== null && typeof one === "object" && typeof (one as Node).type === "string" && typeof (one as Node).start === "number") visit(one as Node);
      }
    }
  };
  visit(program);
  const wanted = new Set(lines);
  const aridHere = new Set(arid.filter((entry) => entry.file === file).map((entry) => entry.source));
  const taken = new Set<number>();
  return found
    .filter((one) => wanted.has(one.line) && !aridHere.has(one.source) && !dry.some(([start, end]) => one.at >= start && one.at < end))
    .sort((a, b) => a.at - b.at)
    .filter((one) => !taken.has(one.line) && taken.add(one.line) !== undefined);
}

/** At most `cap` of `breaks`, spread evenly across them in their order. */
export function spread<T>(breaks: readonly T[], cap = BREAK_CAP): T[] {
  if (breaks.length <= cap) return [...breaks];
  return Array.from({ length: cap }, (_, index) => breaks[Math.floor((index * breaks.length) / cap)]!);
}

/**
 * The breaks a change's diff has room for, read from the files in `root`, spread to the cap (7.1), none on a line added as one
 * of the `moved` lines deleted, each deleted line excusing one added line (7.11).
 */
export function changeBreaks(root: string, diff: string, arid: readonly AridLine[] = [], cap = BREAK_CAP, moved: ReadonlyMap<string, number> = deletedLines([diff])): { breaks: Break[]; candidates: number } {
  const left = new Map(moved);
  const all = [...addedLines(diff)].sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, lines]) => {
    if (!mutable(file) || !existsSync(path.join(root, file))) return [];
    const text = readFileSync(path.join(root, file), "utf8");
    const rows = text.split("\n");
    const written = lines.filter((line) => {
      const source = (rows[line - 1] ?? "").trim();
      const count = left.get(source) ?? 0;
      if (count === 0) return true;
      left.set(source, count - 1);
      return false;
    });
    return fileBreaks(file, text, written, arid);
  });
  return { breaks: spread(all, cap), candidates: all.length };
}

/** Who imports whom among the code files of some packages: each file's dependents. */
export interface Reach {
  /** The test files that reach `file`, nearest first: every one in its own package, or, when none there does, at most `cap` downstream. */
  tests(file: string, cap?: number): string[];
  /** The test files in other packages than `file`'s that reach it, nearest first, at most `cap`. */
  downstream(file: string, cap?: number): string[];
  /** How many source files depend on `file` through any number of imports. */
  damage(file: string): number;
}

/**
 * The test unit a repository path is in, as `pnpm test` scopes them: its package's folder, or its folder under infra/, which holds
 * tests but is no package (packages/dev-loop/src/test-scope.mjs), or, in a user's factory checkout, its plugin's folder under
 * plugins/, whose promises its own tests prove.
 */
function unitOf(file: string): string | undefined {
  return folderOf(file) ?? /^(?:infra|plugins)\/[^/]+(?=\/)/.exec(file.replace(/\\/g, "/"))?.[0];
}

/** The import graph of the packages under `folders` of the checkout at `root`, each file to the files importing it. */
export function readReach(root: string, folders: readonly string[]): Reach {
  const packages: SurveyPackage[] = readPackages(root).map(({ folder, name }) => {
    let exports: Record<string, string> = {};
    try {
      const json = JSON.parse(readFileSync(path.join(root, folder, "package.json"), "utf8")) as { exports?: unknown };
      const raw = typeof json.exports === "string" ? { ".": json.exports } : json.exports;
      if (typeof raw === "object" && raw !== null) exports = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch {
      // A package with no readable manifest exports nothing.
    }
    return { root: `${folder}/`, name, exports };
  });
  const files: SourceFile[] = folders.flatMap((folder) => codeUnder(root, folder)).map((file) => ({ path: file, text: readFileSync(path.join(root, file), "utf8") }));
  const paths = new Set(files.map((file) => file.path));
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const dependents = new Map<string, Set<string>>();
  // The file a package specifier names through its package's exports, and that package's root.
  const exported = (specifier: string): { root: string; to: string | undefined } | undefined => {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
    const pkg = byName.get(name);
    if (pkg === undefined) return undefined;
    const target = pkg.exports[specifier === name ? "." : `.${specifier.slice(name.length)}`];
    return { root: pkg.root, to: target === undefined ? undefined : located(path.posix.normalize(pkg.root + target), paths) };
  };
  for (const file of files) {
    const targets = [...dependenciesOf(file, paths, packages)];
    // An import of another package by its name reaches the file its exports name.
    for (const specifier of specifiersOf(file)) {
      const found = exported(specifier);
      if (found?.to !== undefined && !file.path.startsWith(found.root)) targets.push(found.to);
    }
    // A file an esbuild build bundles by its path is reached by the file naming it, as the capture kit bundles the desktop page.
    targets.push(...bundledBy(file, paths));
    // A reporter a `node --test` run loads is reached by the file naming it: that run writes no coverage from its reporters' process.
    targets.push(...reportedBy(file, exported));
    for (const to of targets) dependents.set(to, (dependents.get(to) ?? new Set()).add(file.path));
  }
  // A file a test runs only in a process it starts is reached by no import: its package's coverage map credits it to the
  // capabilities whose tests ran it, and those are the package's test files numbered with them, the most credited first.
  const maps = new Map<string, Record<string, Record<string, number>>>();
  const mapOf = (folder: string): Record<string, Record<string, number>> => {
    let map = maps.get(folder);
    if (map === undefined) {
      try {
        map = JSON.parse(readFileSync(path.join(root, folder, COVERAGE_MAP), "utf8")) as Record<string, Record<string, number>>;
      } catch {
        map = {}; // A package with no readable map credits nothing.
      }
      maps.set(folder, map);
    }
    return map;
  };
  const numbersOf = new Map(files.filter((file) => TEST.test(file.path)).map((file) => {
    const story = path.posix.basename(folderOf(file.path) ?? "");
    return [file.path, new Set([...file.text.matchAll(NUMBERED_TEST)].filter(([, prefix]) => prefix === undefined || prefix === story).map(([, , number]) => number!))];
  }));
  const measured = (file: string): string[] => {
    const folder = folderOf(file);
    if (folder === undefined) return [];
    const credit = mapOf(folder)[file.slice(folder.length + 1)] ?? {};
    const numbers = Object.keys(credit).sort((a, b) => credit[b]! - credit[a]!);
    return numbers.flatMap((number) => [...numbersOf].filter(([test, carried]) => folderOf(test) === folder && carried.has(number)).map(([test]) => test));
  };
  const closure = (file: string): string[] => {
    const seen = new Set([file]);
    const order: string[] = [];
    for (let queue = [file]; queue.length > 0;) {
      const next: string[] = [];
      for (const one of queue) for (const user of dependents.get(one) ?? []) if (!seen.has(user)) {
        seen.add(user);
        order.push(user);
        next.push(user);
      }
      queue = next;
    }
    return order;
  };
  return {
    // Every test of its own package that reaches it, nearest first, however many (a killing test may sit past the nearest in a
    // sibling folder); those downstream, capped, only when its own package has none that reach it.
    tests: (file, cap = TEST_CAP) => {
      const reached = closure(file).filter((one) => TEST.test(one));
      const own = [...new Set([...reached.filter((one) => unitOf(one) === unitOf(file)), ...measured(file)])];
      return own.length > 0 ? own : reached.slice(0, cap);
    },
    downstream: (file, cap = TEST_CAP) => closure(file).filter((one) => TEST.test(one) && unitOf(one) !== unitOf(file)).slice(0, cap),
    damage: (file) => closure(file).filter((one) => !TEST.test(one) && !TEST_SUPPORT.test(one)).length,
  };
}

/**
 * The code files a file bundles by path: each string literal under an `entryPoints` key naming one, read from its folder or from
 * the checkout's root, so `path.join(import.meta.dirname, "page.ts")` and `path.join(root, "apps/…/page.ts")`
 * are both read. A literal anywhere else (a fixture read, a script spawned) names none.
 */
function bundledBy(file: SourceFile, paths: ReadonlySet<string>): string[] {
  if (!file.text.includes("entryPoints")) return [];
  let program: unknown;
  try {
    program = parse(file.text, { sourceType: "unambiguous", plugins: /\.[cm]?tsx?$/.test(file.path) ? (file.path.endsWith("x") ? ["typescript", "jsx"] : ["typescript"]) : ["jsx"] }).program;
  } catch {
    return [];
  }
  const found = new Set<string>();
  const bases = [path.posix.dirname(file.path), ""];
  const visit = (value: unknown, entry: boolean): void => {
    if (Array.isArray(value)) { value.forEach((one) => visit(one, entry)); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as { type: string; value?: unknown; key?: { name?: string; value?: unknown } };
    if (entry && node.type === "StringLiteral" && typeof node.value === "string" && CODE.test(node.value)) {
      const to = bases.map((base) => located(path.posix.normalize(path.posix.join(base, node.value as string)), paths)).find((one) => one !== undefined);
      if (to !== undefined && to !== file.path) found.add(to);
    }
    const opens = node.type === "ObjectProperty" && (node.key?.name === "entryPoints" || node.key?.value === "entryPoints");
    for (const [key, child] of Object.entries(value)) if (key !== "loc" && key !== "leadingComments" && key !== "trailingComments") visit(child, entry || (opens && key === "value"));
  };
  visit(program, false);
  return [...found];
}

/**
 * The code files a file names as a node:test reporter by a package specifier, through that package's exports (its own package's
 * included): each `--test-reporter=<spec>` or `"--test-reporter", "<spec>"` in its text. A built-in reporter names none.
 */
function reportedBy(file: SourceFile, exported: (specifier: string) => { to: string | undefined } | undefined): string[] {
  const found = new Set<string>();
  for (const [, spec] of file.text.matchAll(/--test-reporter(?:=|["'`]\s*,\s*["'`])([^"'`\s,]+)/g)) {
    const to = exported(spec!)?.to;
    if (to !== undefined && to !== file.path) found.add(to);
  }
  return [...found];
}

/** The file a resolved import path names, trying the extensions TypeScript would. */
function located(target: string, paths: ReadonlySet<string>): string | undefined {
  const stem = target.replace(/\.[cm]?jsx?$/, "");
  return [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${target}/index.ts`].find((candidate) => paths.has(candidate));
}

/** The code files under a folder of the checkout, as repository paths. */
function codeUnder(root: string, folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIPPED.has(entry.name) && !entry.name.startsWith(".")) walk(`${dir}/${entry.name}`);
      else if (entry.isFile() && CODE.test(entry.name) && !DECLARATION.test(entry.name)) found.push(`${dir}/${entry.name}`);
    }
  };
  walk(folder);
  return found;
}

/**
 * Run test files from `root` with node's test runner under tsx, with `env`: whether all passed, how long it took, whether `limitMs`
 * cut it short, and, when the run can tell, each test that passed, named by {@link testName}.
 */
export type TestRun = (root: string, tests: readonly string[], limitMs: number, env?: NodeJS.ProcessEnv) => Promise<{ passed: boolean; ms: number; timedOut?: boolean; passing?: string[] }>;

/** A test's name across runs: its file from the checkout's root, where in the file it is declared, and its title. */
export function testName(file: string, line: number | undefined, column: number | undefined, title: string): string {
  return `${file.split(path.sep).join("/")}:${line}:${column} ${title}`;
}

/** A node test reporter writing each test that passes as one JSON line: its file, line, column and title. */
const PASS_REPORTER = `export default async function* (source) {
  for await (const { type, data } of source) if (type === "test:pass") yield JSON.stringify([data.file ?? "", data.line, data.column, data.name]) + "\\n";
}
`;

/** The variables naming an agent's session, which `pnpm test` keeps from its units (packages/dev-loop/src/unit-run.mjs). */
const SESSION_VARIABLES = [...WATCHED_HARNESSES.flatMap((harness) => ("shellSession" in harness ? [harness.shellSession] : [])), SESSION_ENV];

/** The real test run: one node process for the files, in a temp folder of its own, killed with its children at `limitMs`. */
export const runTests: TestRun = (root, tests, limitMs, given = process.env) => new Promise((resolve) => {
  const tsx = import.meta.resolve("tsx");
  const temp = mkdtempSync(path.join(tmpdir(), "st-mutation-"));
  const started = Date.now();
  // A report run from inside a test run must not hand its tests' results to that run's parent instead of exiting with them.
  const { NODE_TEST_CONTEXT: _parent, ...env } = given;
  // Its tests get what `pnpm test` gives a unit: no agent's session for a command they run to record on, and no embedding model.
  for (const name of SESSION_VARIABLES) delete env[name];
  env["STORYTREE_EMBEDDER"] = "off";
  const reporter = path.join(temp, "st-mutation-reporter.mjs");
  const results = path.join(temp, "st-mutation-passing.jsonl");
  writeFileSync(reporter, PASS_REPORTER);
  const child = spawn(process.execPath, ["--import", tsx, "--test", `--test-reporter=${pathToFileURL(reporter).href}`, `--test-reporter-destination=${results}`, ...tests], {
    cwd: root, env: { ...env, TMPDIR: temp, TMP: temp, TEMP: temp }, stdio: "ignore", detached: process.platform !== "win32", windowsHide: true,
  });
  const kill = (): void => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    kill();
  }, limitMs);
  child.once("close", (code) => {
    clearTimeout(deadline);
    kill();
    // The reporter names a file by its real path, so the root is resolved too: macOS's temp folder sits behind a symlink.
    const real = (where: string): string => existsSync(where) ? realpathSync(where) : where;
    const realRoot = real(root);
    const passing = existsSync(results) ? readFileSync(results, "utf8").split("\n").filter(Boolean).map((one) => {
      const [file, line, column, title] = JSON.parse(one) as [string, number | undefined, number | undefined, string];
      return testName(file === "" ? "" : path.relative(realRoot, real(file.startsWith("file:") ? fileURLToPath(file) : file)), line, column, title);
    }) : [];
    // Best effort: on Windows a test process may still hold a file in it (ENOTEMPTY); the run's result never depends on
    // this folder, so a leftover reporter folder in the temp folder is better than a brief that crashes.
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Left behind.
    }
    resolve({ passed: code === 0 && !timedOut, ms: Date.now() - started, ...(timedOut ? { timedOut } : {}), passing });
  });
});

/**
 * The mutation report on the change whose diff is `diff`, in the checkout at `root` (7.1, 7.2): each break planted in a copy
 * of the checkout, run against the tests that reach its file there, and its file written back (7.8). Undefined `reach` reads
 * the import graph of the changed files' packages and those downstream; undefined `now` reads the real clock. Its copy and
 * its throwaway Postgres are made in, and orphaned ones swept from, `scratch`: the system's temp folder unless given.
 */
export async function mutationReport(root: string, diff: string, arid: readonly AridLine[] = [], options: { run?: TestRun; reach?: Reach; cap?: number; budgetMs?: number; now?: () => number; scratch?: string; moved?: ReadonlyMap<string, number> } = {}): Promise<MutationReport> {
  const scratch = options.scratch ?? tmpdir();
  TestPostgres.sweep(scratch);
  sweepCopies(scratch);
  const now = options.now ?? Date.now;
  const started = now();
  const run = options.run ?? runTests;
  const { breaks, candidates } = changeBreaks(root, diff, arid, options.cap, options.moved);
  if (breaks.length === 0) return { ran: true, planted: 0, caught: 0, survivors: [], notRun: [], candidates, ms: now() - started };
  const reach = options.reach ?? (() => {
    const graph = new PackageGraph(readPackages(root));
    const own = [...new Set(breaks.map((one) => unitOf(one.file)).filter((folder): folder is string => folder !== undefined))];
    return readReach(root, [...own, ...graph.downstream(own)]);
  })();
  const survivors: Survivor[] = [];
  const notRun: { file: string; line: number; why: string }[] = [];
  let caught = 0;
  const byFile = new Map<string, Break[]>();
  for (const one of breaks) byFile.set(one.file, [...(byFile.get(one.file) ?? []), one]);
  const budget = options.budgetMs ?? REPORT_BUDGET_MS;
  const left = (): number => budget - (now() - started);
  const OUT_OF_TIME = "the report's time ran out first";
  // How each test file ran with nothing broken, and which of its tests passed when the run can tell, kept across the changed files that share it.
  const unbroken = new Map<string, { passed: boolean; ms: number; passing: string[] | undefined }>();
  const passingIn = (test: string, passing: readonly string[] | undefined): string[] | undefined => passing?.filter((name) => name.startsWith(`${test}:`));
  // A test file counts when it passed unbroken, or when some of its tests did: only those are looked at with a break planted (7.6).
  const counts = (test: string): boolean => {
    const known = unbroken.get(test)!;
    return known.passed || (known.passing?.length ?? 0) > 0;
  };
  // The copy holds every package a break or a test that may run is in; the tests run there, never in `root` (7.8).
  const unit = (file: string): string => unitOf(file) ?? file.split("/")[0]!;
  const copied = new Set([...byFile.keys()].flatMap((file) => [file, ...reach.tests(file), ...reach.downstream(file)]).map(unit));
  const copy = copyCheckout(root, copied, scratch);
  const postgres = new TestPostgres(options.run === undefined, scratch);
  try {
    for (const [file, planted] of byFile) {
      const damage = reach.damage(file);
      const tests = reach.tests(file);
      if (tests.length === 0) {
        survivors.push(...planted.map(({ line, source, what }) => ({ file, line, source, what, damage, untried: true as const })));
        continue;
      }
      const env = await postgres.env();
      // Tests that fail with nothing broken cannot tell a break apart: they are left out (7.2, 7.6).
      const passingOf = async (some: readonly string[]): Promise<string[] | undefined> => {
        const unknown = some.filter((test) => !unbroken.has(test));
        if (unknown.length > 0 && left() > 0) {
          const whole = await run(copy, unknown, left(), env);
          // One the report's own time cut short is not known to fail.
          if (whole.passed) for (const test of unknown) unbroken.set(test, { passed: true, ms: whole.ms / unknown.length, passing: passingIn(test, whole.passing) });
          else for (const test of unknown) {
            if (left() <= 0) break;
            const alone = await run(copy, [test], left(), env);
            if (!alone.timedOut || left() > 0) unbroken.set(test, { passed: alone.passed, ms: alone.ms, passing: passingIn(test, alone.passing) });
          }
        }
        return some.every((test) => unbroken.has(test)) ? some.filter(counts) : undefined;
      };
      const original = readFileSync(path.join(root, file), "utf8");
      // Whether `one`, planted, is caught by `passing`, survives them, or is not run for lack of time.
      const tried = async (one: Break, passing: readonly string[]): Promise<"caught" | "survived" | "out"> => {
        if (left() <= 0) return "out";
        try {
          writeFileSync(path.join(copy, file), original.slice(0, one.at) + one.replacement + original.slice(one.at + one.length));
          // A break that makes the tests hang is caught, as one that makes them fail is.
          const slowest = passing.reduce((sum, test) => sum + unbroken.get(test)!.ms, 0);
          const result = await run(copy, passing, Math.min(left(), Math.max(20_000, 3 * slowest + 5_000)), env);
          if (result.timedOut) return left() <= 0 ? "out" : "caught";
          // Caught when a test that passed unbroken no longer passes; a run that cannot name its tests is judged by the whole (7.6).
          const before = passing.map((test) => unbroken.get(test)!.passing);
          if (result.passing === undefined || before.some((names) => names === undefined)) return result.passed ? "survived" : "caught";
          const now = new Set(result.passing);
          return before.flat().some((name) => !now.has(name!)) ? "caught" : "survived";
        } finally {
          writeFileSync(path.join(copy, file), original);
        }
      };
      const passing = await passingOf(tests);
      if (passing === undefined) {
        notRun.push(...planted.map(({ line }) => ({ file, line, why: OUT_OF_TIME })));
        continue;
      }
      const failing = (some: readonly string[]): string => `the ${some.length} test file${some.length === 1 ? "" : "s"} reaching ${file} fail with nothing broken (${some.join(", ")})`;
      // Tests that all fail unbroken judge none of its breaks: each goes on to the tests downstream as one they missed.
      const missed: Break[] = passing.length === 0 ? [...planted] : [];
      if (passing.length > 0) for (const one of planted) {
        const outcome = await tried(one, passing);
        if (outcome === "out") notRun.push({ file, line: one.line, why: OUT_OF_TIME });
        else if (outcome === "survived") missed.push(one);
        else caught++;
      }
      // A break its own package's tests miss is run against the tests downstream that reach its file before it survives (7.5).
      const further = missed.length === 0 ? [] : reach.downstream(file).filter((test) => !tests.includes(test));
      const downstream = further.length === 0 ? [] : await passingOf(further);
      // With none left that passes unbroken, a break is not run and says why; it survives only tests that could have told.
      const unjudged = passing.length === 0 ? failing([...tests, ...further])
        : further.length > 0 && downstream?.length === 0 ? `the tests in its own package miss it, and ${failing(further)}` : undefined;
      for (const one of missed) {
        const outcome = downstream === undefined ? "out" : downstream.length === 0 ? (unjudged === undefined ? "survived" : "unjudged") : await tried(one, downstream);
        if (outcome === "out") notRun.push({ file, line: one.line, why: OUT_OF_TIME });
        else if (outcome === "unjudged") notRun.push({ file, line: one.line, why: unjudged! });
        else if (outcome === "survived") survivors.push({ file, line: one.line, source: one.source, what: one.what, damage });
        else caught++;
      }
    }
  } finally {
    await postgres.stop();
    rmSync(copy, { recursive: true, force: true });
  }
  survivors.sort((a, b) => b.damage - a.damage || a.file.localeCompare(b.file) || a.line - b.line);
  return { ran: true, planted: breaks.length, caught, survivors, notRun, candidates, ms: now() - started };
}

/**
 * The Postgres the report's tests run against, as `pnpm test` hands one to them: the server STORYTREE_TEST_PG_URL names, or, when
 * none is named and `start` allows, a throwaway one started in a temp folder the first time a test runs, and stopped with the
 * report. One that cannot start is left out, and the tests that need it fail unbroken, so their breaks are not run and say why.
 */
class TestPostgres {
  #env: Promise<NodeJS.ProcessEnv> | undefined;
  #server: { stop(): Promise<void> } | undefined;
  #folder: string | undefined;

  constructor(readonly start: boolean, readonly scratch: string) {}

  env(): Promise<NodeJS.ProcessEnv> {
    this.#env ??= (async () => {
      if (!this.start || process.env["STORYTREE_TEST_PG_URL"]) return process.env;
      try {
        const { start } = await import("@storytree/local-postgres");
        // Its folder is named for this process, so a report that outlives it can tell the folder is orphaned (7.9).
        this.#folder = mkdtempSync(path.join(this.scratch, `${PG_FOLDER}${process.pid}-`));
        const server = await start({
          dataDir: path.join(this.#folder, "data"), owner: "a mutation report", signIn: "client", superuserUrl: true,
          settings: { fsync: "off", synchronous_commit: "off", full_page_writes: "off", max_connections: "300" },
        });
        this.#server = server;
        // A report ended by a signal or an exit cannot wait for the server to stop: it is told to quit at once, and its folder goes.
        process.once("exit", this.#quit);
        for (const signal of SIGNALS) process.once(signal, this.#onSignal);
        return { ...process.env, STORYTREE_TEST_PG_URL: server.url, STORYTREE_TEST_PG_ADMIN_URL: server.superuserUrl ?? server.url, STORYTREE_TEST_PG_DATA: server.dataDir };
      } catch {
        return process.env;
      }
    })();
    return this.#env;
  }

  async stop(): Promise<void> {
    process.off("exit", this.#quit);
    for (const signal of SIGNALS) process.off(signal, this.#onSignal);
    await this.#server?.stop().catch(() => undefined);
    if (this.#folder !== undefined) rmSync(this.#folder, { recursive: true, force: true });
  }

  /**
   * Stop the server of each throwaway folder in `scratch` whose report is no longer running, and remove the folder (7.9): a
   * report killed outright (SIGKILL) sees no exit or signal, so its server is left for the next report to stop.
   */
  static sweep(scratch: string): void {
    let names: string[];
    try {
      names = readdirSync(scratch);
    } catch {
      return;
    }
    for (const name of names) {
      const owner = Number(new RegExp(`^${PG_FOLDER}(\\d+)-`).exec(name)?.[1]);
      if (Number.isInteger(owner) && owner > 0 && !alive(owner)) TestPostgres.#quitIn(path.join(scratch, name), true);
    }
  }

  readonly #quit = (): void => {
    if (this.#folder !== undefined) TestPostgres.#quitIn(this.#folder, false);
  };

  /**
   * Tell the server whose data is in `folder` to quit at once, and remove the folder. Its pid file goes before the signal, and
   * only the remover signals: a pid read once is never signalled again by a later or concurrent sweep, after the system may
   * have given it to another process (Windows reuses them at once). An orphan's pid file may outlive its server, so when
   * `check` is set the pid is signalled only while its command line names the folder, as its server's does.
   */
  static #quitIn(folder: string, check: boolean): void {
    const file = path.join(folder, "data", "postmaster.pid");
    try {
      const pid = Number(readFileSync(file, "utf8").split("\n")[0]);
      unlinkSync(file);
      if (Number.isInteger(pid) && pid > 0 && (!check || commandLine(pid).includes(path.basename(folder)))) quitServer(pid);
    } catch {
      // Not running, or another sweep has it.
    }
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // Still held (Windows keeps a folder busy while its server shuts down): the next report tries again.
    }
  }

  readonly #onSignal = (signal: NodeJS.Signals): void => {
    this.#quit();
    process.off("exit", this.#quit);
    for (const one of SIGNALS) process.off(one, this.#onSignal);
    process.kill(process.pid, signal);
  };
}

/**
 * Stop the Postgres server `pid` at once: SIGQUIT, its immediate shutdown. Windows has no signals, and there Node's SIGQUIT first
 * writes a crash dump of the process while this one waits, so the server and its backends are ended with taskkill instead.
 */
function quitServer(pid: number): void {
  if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", timeout: 10_000, windowsHide: true });
  else process.kill(pid, "SIGQUIT");
}

/** The command line process `pid` was started with, or "" when it cannot be read (no such process). */
function commandLine(pid: number): string {
  try {
    const [file, args] = process.platform === "win32"
      ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]]
      : ["ps", ["-o", "command=", "-p", String(pid)]];
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, windowsHide: true });
  } catch {
    return "";
  }
}

/** Whether process `pid` is running: one this process may not signal is. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Make a copy of the checkout at `root` in `scratch` for a report's tests to run in (7.8): each of `copied` (package folders, or
 * top-level files and folders, as repository paths) is copied whole but for its `node_modules`, which becomes one of links to the
 * checkout's own, pointing into the copy for a package copied too; every other folder is linked, and every other file copied.
 */
function copyCheckout(root: string, copied: ReadonlySet<string>, scratch: string): string {
  const real = realpathSync(root);
  const copy = mkdtempSync(path.join(scratch, `${COPY_FOLDER}${process.pid}-`));
  // A link to a folder, at `at`, is a junction on Windows, which needs no privilege; a file is copied instead.
  const link = (target: string, to: string, at = target): void => {
    if (statSync(target).isDirectory()) symlinkSync(at, to, "junction");
    else copyFileSync(target, to);
  };
  // A package's link into the checkout points at its place in the copy, which is a copy itself or a link to the checkout's.
  const relinked = (from: string, to: string): void => {
    let target: string;
    try {
      target = realpathSync(from);
    } catch {
      return;
    }
    const relative = path.relative(real, target);
    link(target, to, relative.startsWith("..") || path.isAbsolute(relative) ? target : path.join(copy, relative));
  };
  const relink = (folder: string): void => {
    const modules = path.join(real, folder, "node_modules");
    if (!existsSync(modules)) return;
    mkdirSync(path.join(copy, folder, "node_modules"));
    for (const name of readdirSync(modules)) {
      const from = path.join(modules, name);
      const to = path.join(copy, folder, "node_modules", name);
      // A scope's folder holds its packages' links.
      if (name.startsWith("@")) {
        mkdirSync(to);
        for (const scoped of readdirSync(from)) relinked(path.join(from, scoped), path.join(to, scoped));
      } else relinked(from, to);
    }
  };
  const mirror = (folder: string): void => {
    for (const entry of readdirSync(path.join(real, folder), { withFileTypes: true })) {
      const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
      const from = path.join(real, relative);
      const to = path.join(copy, relative);
      if (relative === ".git") continue;
      if (copied.has(relative)) {
        cpSync(from, to, { recursive: true, filter: (source) => source !== path.join(from, "node_modules") });
        if (entry.isDirectory()) relink(relative);
      } else if ([...copied].some((one) => one.startsWith(`${relative}/`))) {
        mkdirSync(to);
        mirror(relative);
      } else if (existsSync(from)) link(from, to);
    }
  };
  mirror("");
  return copy;
}

/** Remove each copy of a checkout in `scratch` whose report is no longer running: one killed outright leaves its own (7.8). */
function sweepCopies(scratch: string): void {
  let names: string[];
  try {
    names = readdirSync(scratch);
  } catch {
    return;
  }
  for (const name of names) {
    const owner = Number(new RegExp(`^${COPY_FOLDER}(\\d+)-`).exec(name)?.[1]);
    if (Number.isInteger(owner) && owner > 0 && !alive(owner)) rmSync(path.join(scratch, name), { recursive: true, force: true });
  }
}

/** The report as the brief shows it; one run on an outside checkout names it (7.10). */
export function mutationText(report: MutationReport, folder?: string): string {
  const name = folder === undefined ? "Mutation report" : `Mutation report on the checkout ${folder}`;
  if (!report.ran) return `${name}: not run (${report.reason}). Nothing of it is recorded, and nothing waits on it.`;
  if (report.planted === 0) return `${name}: the change adds no line a break fits outside arid code, so none was planted.`;
  return [
    `${name}: ${report.planted} break${report.planted === 1 ? "" : "s"} planted on the change's lines${report.candidates > report.planted ? ` (spread from ${report.candidates})` : ""}, ${report.caught} caught by a test, ${report.survivors.length} survived${report.notRun.length === 0 ? "" : `, ${report.notRun.length} not run`}, in ${Math.round(report.ms / 1000)} s.`,
    ...(report.survivors.length === 0 ? [] : [
      "Each survivor is recorded as a hit with this review, for the implementer to answer: add or fix a test that notices it, or reject it with a reason, which puts its line on the arid list. Not yours to judge; most damaging first:",
      ...report.survivors.map((one) => `  ${one.file}:${one.line}  ${one.what}${one.untried ? ", untried: no test reaches the file" : ""}  (${one.damage} file${one.damage === 1 ? "" : "s"} depend on it)\n    ${one.source}`),
    ]),
    ...report.notRun.map((one) => `  not run  ${one.file}:${one.line}: ${one.why}`),
  ].join("\n");
}

/** What a survivor's hit says was found, naming the outside checkout it was found in (7.10). */
function survivorFound(one: Survivor, folder?: string): string {
  return `mutation survivor${folder === undefined ? "" : ` in the checkout ${folder}`}: ${one.what} on \`${one.source}\` ${one.untried ? "is reached by no test" : "was noticed by no test reaching the file"} (${one.damage} file${one.damage === 1 ? "" : "s"} depend on it); add or fix a test that notices it, or reject it to put the line on the arid list`;
}

type Pool = Awaited<ReturnType<typeof ledgerDatabase>>;

/** The arid list of `project`: every line a rejected survivor put on it. */
export async function aridList(server: Pick<Storytree, "ownDatabase">, project: string): Promise<AridLine[]> {
  const pool: Pool = await ledgerDatabase(server);
  const { rows } = await pool.query<{ file: string; source: string }>("SELECT file, source FROM quality_arid WHERE project = $1 ORDER BY file, source", [project]);
  return rows;
}

/**
 * Run the mutation report on review `iteration` of `change`, its diff `diff` read from the worktree at `root`, and keep it with
 * that review (7.3); a report that cannot run is kept saying why, and never refuses the brief (7.4).
 */
export async function reportForBrief(server: Pick<Storytree, "ownDatabase">, project: string, change: string, iteration: number, root: string, diff: string, options: Parameters<typeof mutationReport>[3] = {}): Promise<MutationReport> {
  const report = await runReport(server, project, root, diff, options);
  await keepReport(server, project, change, iteration, report);
  return report;
}

/** A review's mutation reports as kept: the change's own, and each outside checkout's under its folder (7.10). */
type KeptReport = MutationReport & { readonly outside?: readonly OutsideReport[] };

/** The mutation report run on an outside checkout a brief read, the factory worktree or one of the change's other halves (7.10). */
export interface OutsideReport {
  readonly folder: string;
  readonly report: MutationReport;
}

/** The mutation report on `diff` in the checkout at `root`, or, when it cannot run, why not (7.4). */
async function runReport(server: Pick<Storytree, "ownDatabase">, project: string, root: string, diff: string, options: Parameters<typeof mutationReport>[3]): Promise<MutationReport> {
  try {
    return await mutationReport(root, diff, await aridList(server, project), options);
  } catch (error) {
    return { ran: false, reason: (error as Error).message };
  }
}

async function keepReport(server: Pick<Storytree, "ownDatabase">, project: string, change: string, iteration: number, report: KeptReport): Promise<void> {
  const pool: Pool = await ledgerDatabase(server);
  await pool.query(
    `INSERT INTO quality_mutations (project, change, iteration, report) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project, change, iteration) DO UPDATE SET report = EXCLUDED.report, at = now()`,
    [project, change, iteration, JSON.stringify(report)],
  );
}

/**
 * Record the survivors of the mutation report kept with review `iteration` of `change`, once its return is taken, as hits found
 * by the mutation report under {@link MUTATION_SURVIVOR} (7.3); none when no report ran with that review, or it is recorded already.
 */
export async function recordSurvivors(server: Pick<Storytree, "ownDatabase">, project: string, change: string, iteration: number): Promise<HitRow[]> {
  const pool: Pool = await ledgerDatabase(server);
  const review = `${change}#${iteration}`;
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{ report: KeptReport; recorded: boolean }>(
      "SELECT report, recorded FROM quality_mutations WHERE project = $1 AND change = $2 AND iteration = $3 FOR UPDATE",
      [project, change, iteration],
    );
    const kept = rows[0];
    if (kept === undefined || kept.recorded) return [];
    // The change's own survivors, then each outside checkout's, naming it (7.10).
    const survivors = [
      ...(kept.report.ran ? kept.report.survivors.map((one) => ({ one, folder: undefined })) : []),
      ...(kept.report.outside ?? []).flatMap(({ folder, report }) => (report.ran ? report.survivors.map((one) => ({ one, folder })) : [])),
    ];
    const packages = [...new Set(survivors.map(({ one }) => packageOf(one.file)))].sort();
    const hits = packages.length === 0 ? [] : await writeReview(client, {
      project, review, change, packages,
      ran: [{ check: MUTATION_SURVIVOR, foundBy: "mutation", hits: survivors.map(({ one, folder }) => ({ package: packageOf(one.file), file: one.file, line: one.line, found: survivorFound(one, folder), source: one.source })) }],
    });
    await client.query("UPDATE quality_mutations SET recorded = true WHERE project = $1 AND change = $2 AND iteration = $3", [project, change, iteration]);
    return hits;
  });
}

/**
 * The brief's text with its mutation reports beneath (7.3): run on the brief's diff when it was read from the worktree at
 * `root`, and on each outside checkout's diff the brief read (7.10), all kept with its review; with neither, as for a diff
 * given by hand with no other half, the brief alone.
 */
export async function briefWithReport(server: Pick<Storytree, "ownDatabase">, brief: Brief, root: string | undefined, options: Parameters<typeof mutationReport>[3] = {}): Promise<{ text: string; mutation?: MutationReport; outside?: readonly OutsideReport[] }> {
  const checkouts = outsideCheckouts(brief);
  if (root === undefined && checkouts.length === 0) return { text: briefText(brief) };
  // A line one half deletes and another adds was moved between them, so every half's deletions count in each report (7.11).
  const moved = { moved: deletedLines([brief.diff, ...checkouts.map(({ diff }) => diff)]), ...options };
  const mutation = root === undefined ? undefined : await runReport(server, brief.project, root, brief.diff, moved);
  const outside: OutsideReport[] = [];
  // One after another: each runs tests.
  for (const { folder, diff } of checkouts) outside.push({ folder, report: await runReport(server, brief.project, folder, diff, moved) });
  await keepReport(server, brief.project, brief.change, brief.iteration, {
    ...(mutation ?? { ran: false, reason: "the change's own diff was given by hand, with no worktree to run it in" }),
    ...(outside.length === 0 ? {} : { outside }),
  });
  // A change with no line a break fits, as a test-only or a docs change is, leaves the brief as it was.
  const shown = (report: MutationReport): boolean => !(report.ran && report.planted === 0);
  const reports = [
    ...(mutation !== undefined && shown(mutation) ? [mutationText(mutation)] : []),
    ...outside.filter(({ report }) => shown(report)).map(({ folder, report }) => mutationText(report, folder)),
  ];
  return { text: [briefText(brief), ...reports].join("\n\n"), ...(mutation === undefined ? {} : { mutation }), ...(outside.length === 0 ? {} : { outside }) };
}

/** A return taken, with the survivors of its review's mutation report recorded beside its hits and what stands now (7.3). */
export async function takenWithSurvivors(server: Pick<Storytree, "ownDatabase">, reviews: Reviews, project: string, change: string, taken: Taken): Promise<Taken> {
  const iteration = Number(taken.review.slice(taken.review.lastIndexOf("#") + 1));
  const survivors = await recordSurvivors(server, project, change, iteration);
  if (survivors.length === 0) return taken;
  return { ...taken, hits: [...taken.hits, ...survivors], standing: await reviews.standing(project, change) };
}
