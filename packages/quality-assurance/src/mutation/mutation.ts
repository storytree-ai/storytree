/**
 * Capability 7 · Mutation report (ADR-1153 D1). Each change gets a small mutation report: at most one deliberate break per
 * changed source line, about 15 in all, each run against only the tests that reach its file; a break no test notices
 * survives, and each survivor is a hit recorded with the review, ranked by how many files depend on its file.
 *
 * - A break is planted only on a line the change adds, in a source file (never a test or a test helper), one per line at the
 *   first place on it a break fits; with more than the cap, they are spread evenly across the change (7.1).
 * - Arid lines get none (7.1): a logging or output call, the setting of an upper-case constant, and every line on the arid
 *   list, which a rejected survivor's line joins (7.4).
 * - The tests that reach a file are the test files whose imports lead to it, in its own package and those downstream of it,
 *   nearest first and at most {@link TEST_CAP}. Tests that fail with nothing broken are left out, and a break with none left is
 *   not run and says why; a file no test reaches at all survives untried (7.2).
 * - The report runs with the brief read from a change's worktree and is kept with that review; taking the review's return
 *   records each survivor as a hit found by the mutation report (7.3). It never blocks: a report that cannot run says why and
 *   the brief goes on, and a rejected survivor needs no reviewer to accept it (7.4).
 * - Breaks are written into the worktree's files in place and the original written back after each run, and on the way out
 *   however the process ends that it can see.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "@babel/parser";
import { dependenciesOf, specifiersOf, type SourceFile, type SurveyPackage } from "@storytree/map";
import type { Storytree } from "@storytree/library";

import { inTransaction, ledgerDatabase, writeReview, type HitRow } from "../ledger/ledger.js";
import { briefText, type Brief, type Reviews, type Taken } from "../review/review.js";
import { folderOf, PackageGraph, readPackages } from "../risk/risk.js";

/** The most breaks one change gets (ADR-1153 D1: "about 15"). */
export const BREAK_CAP = 15;

/** The most test files one changed file's breaks run against, nearest first. */
export const TEST_CAP = 20;

/** The check a survivor is recorded under in the QA ledger. */
export const MUTATION_SURVIVOR = "mutation-survivor";

/** The signals that end a report, after which it puts back what it changed. */
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

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
const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

/** Whether a repository path is source a break may go in: code, and not a test, a test helper or a declaration. */
export function mutable(file: string): boolean {
  return CODE.test(file) && !TEST.test(file) && !TEST_SUPPORT.test(file) && !DECLARATION.test(file);
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

/** The breaks a change's diff has room for, read from the files in `root`, spread to the cap (7.1). */
export function changeBreaks(root: string, diff: string, arid: readonly AridLine[] = [], cap = BREAK_CAP): { breaks: Break[]; candidates: number } {
  const all = [...addedLines(diff)].sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, lines]) => {
    if (!mutable(file) || !existsSync(path.join(root, file))) return [];
    return fileBreaks(file, readFileSync(path.join(root, file), "utf8"), lines, arid);
  });
  return { breaks: spread(all, cap), candidates: all.length };
}

/** Who imports whom among the code files of some packages: each file's dependents. */
export interface Reach {
  /** The test files that reach `file`, nearest first, at most `cap`. */
  tests(file: string, cap?: number): string[];
  /** How many source files depend on `file` through any number of imports. */
  damage(file: string): number;
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
  for (const file of files) {
    const targets = [...dependenciesOf(file, paths, packages)];
    // An import of another package by its name reaches the file its exports name.
    for (const specifier of specifiersOf(file)) {
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      const pkg = byName.get(name);
      if (pkg === undefined || file.path.startsWith(pkg.root)) continue;
      const target = pkg.exports[specifier === name ? "." : `.${specifier.slice(name.length)}`];
      const to = target === undefined ? undefined : located(path.posix.normalize(pkg.root + target), paths);
      if (to !== undefined) targets.push(to);
    }
    for (const to of targets) dependents.set(to, (dependents.get(to) ?? new Set()).add(file.path));
  }
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
    // Its own package's tests come first, nearest first, then those downstream.
    tests: (file, cap = TEST_CAP) => {
      const own = folderOf(file);
      const reached = closure(file).filter((one) => TEST.test(one));
      return [...reached.filter((one) => folderOf(one) === own), ...reached.filter((one) => folderOf(one) !== own)].slice(0, cap);
    },
    damage: (file) => closure(file).filter((one) => !TEST.test(one) && !TEST_SUPPORT.test(one)).length,
  };
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

/** Run test files from `root` with node's test runner under tsx, with `env`: whether all passed, how long it took, and whether `limitMs` cut it short. */
export type TestRun = (root: string, tests: readonly string[], limitMs: number, env?: NodeJS.ProcessEnv) => Promise<{ passed: boolean; ms: number; timedOut?: boolean }>;

/** The real test run: one node process for the files, in a temp folder of its own, killed with its children at `limitMs`. */
export const runTests: TestRun = (root, tests, limitMs, given = process.env) => new Promise((resolve) => {
  const tsx = import.meta.resolve("tsx");
  const temp = mkdtempSync(path.join(tmpdir(), "st-mutation-"));
  const started = Date.now();
  // A report run from inside a test run must not hand its tests' results to that run's parent instead of exiting with them.
  const { NODE_TEST_CONTEXT: _parent, ...env } = given;
  const child = spawn(process.execPath, ["--import", tsx, "--test", "--test-reporter=dot", ...tests], {
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
    rmSync(temp, { recursive: true, force: true });
    resolve({ passed: code === 0 && !timedOut, ms: Date.now() - started, ...(timedOut ? { timedOut } : {}) });
  });
});

/**
 * The mutation report on the change whose diff is `diff`, in the checkout at `root` (7.1, 7.2): each break planted in place,
 * run against the tests that reach its file, and its file written back. Undefined `reach` reads the import graph of the
 * changed files' packages and those downstream.
 */
export async function mutationReport(root: string, diff: string, arid: readonly AridLine[] = [], options: { run?: TestRun; reach?: Reach; cap?: number; budgetMs?: number } = {}): Promise<MutationReport> {
  const started = Date.now();
  const run = options.run ?? runTests;
  const { breaks, candidates } = changeBreaks(root, diff, arid, options.cap);
  if (breaks.length === 0) return { ran: true, planted: 0, caught: 0, survivors: [], notRun: [], candidates, ms: Date.now() - started };
  const reach = options.reach ?? (() => {
    const graph = new PackageGraph(readPackages(root));
    const own = [...new Set(breaks.map((one) => folderOf(one.file)).filter((folder): folder is string => folder !== undefined))];
    return readReach(root, [...own, ...graph.downstream(own)]);
  })();
  const survivors: Survivor[] = [];
  const notRun: { file: string; line: number; why: string }[] = [];
  let caught = 0;
  const byFile = new Map<string, Break[]>();
  for (const one of breaks) byFile.set(one.file, [...(byFile.get(one.file) ?? []), one]);
  const budget = options.budgetMs ?? REPORT_BUDGET_MS;
  const left = (): number => budget - (Date.now() - started);
  const OUT_OF_TIME = "the report's time ran out first";
  // How each test file ran with nothing broken, kept across the changed files that share it.
  const unbroken = new Map<string, { passed: boolean; ms: number }>();
  const postgres = new TestPostgres(options.run === undefined);
  try {
    for (const [file, planted] of byFile) {
      const damage = reach.damage(file);
      const tests = reach.tests(file);
      if (tests.length === 0) {
        survivors.push(...planted.map(({ line, source, what }) => ({ file, line, source, what, damage, untried: true as const })));
        continue;
      }
      // Tests that fail with nothing broken cannot tell a break apart: they are left out (7.2).
      const env = await postgres.env();
      const unknown = tests.filter((test) => !unbroken.has(test));
      if (unknown.length > 0 && left() > 0) {
        const whole = await run(root, unknown, left(), env);
        // One the report's own time cut short is not known to fail.
        if (whole.passed) for (const test of unknown) unbroken.set(test, { passed: true, ms: whole.ms / unknown.length });
        else for (const test of unknown) {
          if (left() <= 0) break;
          const alone = await run(root, [test], left(), env);
          if (!alone.timedOut || left() > 0) unbroken.set(test, alone);
        }
      }
      if (!tests.every((test) => unbroken.has(test))) {
        notRun.push(...planted.map(({ line }) => ({ file, line, why: OUT_OF_TIME })));
        continue;
      }
      const passing = tests.filter((test) => unbroken.get(test)!.passed);
      const slowest = passing.reduce((sum, test) => sum + unbroken.get(test)!.ms, 0);
      if (passing.length === 0) {
        notRun.push(...planted.map(({ line }) => ({ file, line, why: `the ${tests.length} test file${tests.length === 1 ? "" : "s"} reaching ${file} fail with nothing broken (${tests.join(", ")})` })));
        continue;
      }
      const original = readFileSync(path.join(root, file), "utf8");
      for (const one of planted) {
        if (left() <= 0) {
          notRun.push({ file, line: one.line, why: OUT_OF_TIME });
          continue;
        }
        const restore = guard(path.join(root, file), original);
        try {
          writeFileSync(path.join(root, file), original.slice(0, one.at) + one.replacement + original.slice(one.at + one.length));
          // A break that makes the tests hang is caught, as one that makes them fail is.
          const patience = Math.max(20_000, 3 * slowest + 5_000);
          const result = await run(root, passing, Math.min(left(), patience), env);
          if (result.timedOut && left() <= 0) notRun.push({ file, line: one.line, why: OUT_OF_TIME });
          else if (result.passed) survivors.push({ file, line: one.line, source: one.source, what: one.what, damage });
          else caught++;
        } finally {
          restore();
        }
      }
    }
  } finally {
    await postgres.stop();
  }
  survivors.sort((a, b) => b.damage - a.damage || a.file.localeCompare(b.file) || a.line - b.line);
  return { ran: true, planted: breaks.length, caught, survivors, notRun, candidates, ms: Date.now() - started };
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

  constructor(readonly start: boolean) {}

  env(): Promise<NodeJS.ProcessEnv> {
    this.#env ??= (async () => {
      if (!this.start || process.env["STORYTREE_TEST_PG_URL"]) return process.env;
      try {
        const { start } = await import("@storytree/local-postgres");
        this.#folder = mkdtempSync(path.join(tmpdir(), "st-mutation-pg-"));
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

  readonly #quit = (): void => {
    if (this.#folder === undefined) return;
    try {
      const pid = Number(readFileSync(path.join(this.#folder, "data", "postmaster.pid"), "utf8").split("\n")[0]);
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGQUIT");
    } catch {
      // Not running.
    }
    rmSync(this.#folder, { recursive: true, force: true });
  };

  readonly #onSignal = (signal: NodeJS.Signals): void => {
    this.#quit();
    process.off("exit", this.#quit);
    for (const one of SIGNALS) process.off(one, this.#onSignal);
    process.kill(process.pid, signal);
  };
}

/** Write `original` back to `file` now, and on any exit or signal the process sees before then; returns the restore. */
function guard(file: string, original: string): () => void {
  let done = false;
  const restore = (): void => {
    if (done) return;
    done = true;
    writeFileSync(file, original);
    process.off("exit", restore);
    for (const signal of SIGNALS) process.off(signal, onSignal);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    restore();
    process.kill(process.pid, signal);
  };
  process.once("exit", restore);
  for (const signal of SIGNALS) process.once(signal, onSignal);
  return restore;
}

/** The report as the brief shows it. */
export function mutationText(report: MutationReport): string {
  if (!report.ran) return `Mutation report: not run (${report.reason}). Nothing of it is recorded, and nothing waits on it.`;
  if (report.planted === 0) return "Mutation report: the change adds no line a break fits outside arid code, so none was planted.";
  return [
    `Mutation report: ${report.planted} break${report.planted === 1 ? "" : "s"} planted on the change's lines${report.candidates > report.planted ? ` (spread from ${report.candidates})` : ""}, ${report.caught} caught by a test, ${report.survivors.length} survived${report.notRun.length === 0 ? "" : `, ${report.notRun.length} not run`}, in ${Math.round(report.ms / 1000)} s.`,
    ...(report.survivors.length === 0 ? [] : [
      "Each survivor is recorded as a hit with this review, for the implementer to answer: add or fix a test that notices it, or reject it with a reason, which puts its line on the arid list. Not yours to judge; most damaging first:",
      ...report.survivors.map((one) => `  ${one.file}:${one.line}  ${one.what}${one.untried ? ", untried: no test reaches the file" : ""}  (${one.damage} file${one.damage === 1 ? "" : "s"} depend on it)\n    ${one.source}`),
    ]),
    ...report.notRun.map((one) => `  not run  ${one.file}:${one.line}: ${one.why}`),
  ].join("\n");
}

/** What a survivor's hit says was found. */
function survivorFound(one: Survivor): string {
  return `mutation survivor: ${one.what} on \`${one.source}\` ${one.untried ? "is reached by no test" : "was noticed by no test reaching the file"} (${one.damage} file${one.damage === 1 ? "" : "s"} depend on it); add or fix a test that notices it, or reject it to put the line on the arid list`;
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
  let report: MutationReport;
  try {
    report = await mutationReport(root, diff, await aridList(server, project), options);
  } catch (error) {
    report = { ran: false, reason: (error as Error).message };
  }
  const pool: Pool = await ledgerDatabase(server);
  await pool.query(
    `INSERT INTO quality_mutations (project, change, iteration, report) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project, change, iteration) DO UPDATE SET report = EXCLUDED.report, at = now()`,
    [project, change, iteration, JSON.stringify(report)],
  );
  return report;
}

/**
 * Record the survivors of the mutation report kept with review `iteration` of `change`, once its return is taken, as hits found
 * by the mutation report under {@link MUTATION_SURVIVOR} (7.3); none when no report ran with that review, or it is recorded already.
 */
export async function recordSurvivors(server: Pick<Storytree, "ownDatabase">, project: string, change: string, iteration: number): Promise<HitRow[]> {
  const pool: Pool = await ledgerDatabase(server);
  const review = `${change}#${iteration}`;
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{ report: MutationReport; recorded: boolean }>(
      "SELECT report, recorded FROM quality_mutations WHERE project = $1 AND change = $2 AND iteration = $3 FOR UPDATE",
      [project, change, iteration],
    );
    const kept = rows[0];
    if (kept === undefined || kept.recorded || !kept.report.ran) return [];
    const survivors = kept.report.survivors;
    const packageOf = (file: string): string => /^(?:packages|apps)\/([^/]+)\//.exec(file)?.[1] ?? "root";
    const packages = [...new Set(survivors.map(({ file }) => packageOf(file)))].sort();
    const hits = packages.length === 0 ? [] : await writeReview(client, {
      project, review, change, packages,
      ran: [{ check: MUTATION_SURVIVOR, foundBy: "mutation", hits: survivors.map((one) => ({ package: packageOf(one.file), file: one.file, line: one.line, found: survivorFound(one), source: one.source })) }],
    });
    await client.query("UPDATE quality_mutations SET recorded = true WHERE project = $1 AND change = $2 AND iteration = $3", [project, change, iteration]);
    return hits;
  });
}

/**
 * The brief's text with its mutation report beneath (7.3): run on the brief's diff when it was read from the worktree at
 * `root`, and kept with its review; with no worktree, as for a diff given by hand, the brief alone.
 */
export async function briefWithReport(server: Pick<Storytree, "ownDatabase">, brief: Brief, root: string | undefined, options: Parameters<typeof mutationReport>[3] = {}): Promise<{ text: string; mutation?: MutationReport }> {
  if (root === undefined) return { text: briefText(brief) };
  const mutation = await reportForBrief(server, brief.project, brief.change, brief.iteration, root, brief.diff, options);
  return { text: `${briefText(brief)}\n\n${mutationText(mutation)}`, mutation };
}

/** A return taken, with the survivors of its review's mutation report recorded beside its hits and what stands now (7.3). */
export async function takenWithSurvivors(server: Pick<Storytree, "ownDatabase">, reviews: Reviews, project: string, change: string, taken: Taken): Promise<Taken> {
  const iteration = Number(taken.review.slice(taken.review.lastIndexOf("#") + 1));
  const survivors = await recordSurvivors(server, project, change, iteration);
  if (survivors.length === 0) return taken;
  return { ...taken, hits: [...taken.hits, ...survivors], standing: await reviews.standing(project, change) };
}
