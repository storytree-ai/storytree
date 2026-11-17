// Capability 6 · Repeating a change's new tests. Before a test a change adds counts, it runs several times (arc_9631097b677e,
// research_5864a61a3dcb route R9): a new test that fails in any repeat is flaky, a weak test that goes to an investigation
// under ADR-1352, never to friction. CI runs this after the test step on each pull request, on Linux and on Windows.
//
//   node packages/base-dev-loop/src/repeat-new-tests.mjs [--times=<n>] [<test entry>]
//
// The new tests are found from the change's diff against merge-base(origin/main, HEAD), as the change-reviewer's red-run
// check finds them (the micks-dev-loop factory plugin's redsOf, contract 15.21): each numbered test or `it` call in a test
// file whose literal title opens on an added line, less one the diff rewords or moves. Only they run, through the project's
// test entry (default this package's test.mjs; storytree's own is packages/repo-checks/src/test.mjs) given their files and
// node's --test-name-pattern, so each repeat runs against the throwaway Postgres a run does. A failed repeat's tests are read
// from the red runs that entry keeps (.pgtest/red-runs.jsonl, red-runs.mjs).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** How many times each new test runs, unless measuring says otherwise. */
export const TIMES = 5;

/** A test file, by the name node:test and the dev loop give one. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** A numbered test's title: `N.M` first. */
const NUMBERED = /^\d+\.\d+/;
/**
 * A string literal, a comment or a regex literal: the scan of a test file blanks them, so a test written inside a fixture's text is no
 * call, and a quote inside a regex opens no string. A slash opens a regex where an expression starts, never after a value.
 */
const INERT = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\.|(?!\1)[^\\])*\1|(?<=(?:^|[(,=:[!&|?{};+\-*%~^]|\breturn|\btypeof|\bcase)[ \t]*)\/(?:\\.|\[(?:\\.|[^\]\\\r\n])*\]|[^/\\\r\n[])+\/[a-z]*/gm;
/** Code ending in a test or `it` call about to take its title; `.skip` and `.todo` ones run nothing, so are not read. */
const CALLED = /\b(?:test|it)(?:\.only)?\s*\(\s*$/;
const COOKED = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };

/** A string literal's source text with its escapes cooked, as the runner names the test it titles. */
function cooked(value) {
  return value.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) =>
    escape.length > 1 ? String.fromCodePoint(parseInt(escape.replace(/^[ux]\{?|\}$/g, ""), 16)) : COOKED[escape] ?? escape);
}

/** Where the call whose title ends at `from` in `code` (strings and comments blanked) closes, or the code's end. */
function closeOf(code, from) {
  let depth = 1;
  for (let at = from; at < code.length; at += 1) {
    const char = code[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if ((char === ")" || char === "]" || char === "}") && --depth === 0) return at;
  }
  return code.length;
}

/** Each test or `it` call in `text`'s code with a literal title, by the line its title opens on, with its body collapsed. */
function titlesIn(text) {
  const strings = [];
  const code = text.replace(INERT, (token, quote, at) => {
    if (quote !== undefined) strings.push({ at, end: at + token.length, value: token.slice(1, -1), template: quote === "`" });
    return token.replace(/[^\r\n]/g, " ");
  });
  return strings
    .filter(({ at, value, template }) => CALLED.test(code.slice(Math.max(0, at - 40), at)) && !(template && value.includes("${")))
    .map(({ at, end, value }) => ({ line: text.slice(0, at).split("\n").length, test: cooked(value), body: text.slice(end, closeOf(code, end)).replace(/\s+/g, " ").trim() }));
}

/**
 * The numbered tests `diff` (a `git diff` from the change's base) adds, each `{ file, line, test }`: a test whose title opens on an
 * added line of a test file, read whole by `readFile(file)` (undefined when the change deletes it). A title the diff also removes from
 * the same file is reworded or moved within it, and one whose body is that of a test whose title line the diff removes from any test
 * file (read from its old blob by `readBlob(blob)`, undefined when unreadable) was moved or renumbered: neither is new.
 */
export function newTests(diff, { readFile, readBlob }) {
  const added = new Map();
  const removed = new Set();
  const gone = [];
  let file;
  let old;
  let tested = false;
  let line = 0;
  let oldLine = 0;
  for (const text of diff.split("\n")) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(text);
    if (header !== null) {
      file = TEST_FILE.test(header[2]) ? header[2] : undefined;
      tested = TEST_FILE.test(header[1]);
      old = undefined;
      continue;
    }
    const index = /^index ([0-9a-f]+)\.\.[0-9a-f]+/.exec(text);
    if (index !== null && tested && !/^0+$/.test(index[1])) {
      gone.push(old = { blob: index[1], lines: new Set() });
      continue;
    }
    if (file === undefined && old === undefined) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      line = Number(hunk[2]);
      continue;
    }
    if (text.startsWith("+++") || text.startsWith("---")) continue;
    if (text.startsWith("+")) {
      if (file !== undefined) added.set(file, (added.get(file) ?? new Set()).add(line));
      line += 1;
    } else if (text.startsWith("-")) {
      if (file !== undefined) for (const title of titlesIn(text.slice(1))) removed.add(`${file}\0${title.test}`);
      old?.lines.add(oldLine);
      oldLine += 1;
    } else if (text.startsWith(" ")) {
      line += 1;
      oldLine += 1;
    }
  }
  const moved = new Map();
  for (const { blob, lines } of gone) {
    const text = readBlob(blob);
    if (text === undefined) continue;
    for (const { line, body } of titlesIn(text)) if (lines.has(line)) moved.set(body, (moved.get(body) ?? 0) + 1);
  }
  return [...added].flatMap(([file, lines]) => {
    const text = readFile(file);
    if (text === undefined) return [];
    return titlesIn(text).filter(({ line, test, body }) => {
      if (!NUMBERED.test(test) || !lines.has(line) || removed.has(`${file}\0${test}`)) return false;
      const left = moved.get(body) ?? 0;
      if (left === 0) return true;
      moved.set(body, left - 1);
      return false;
    }).map(({ line, test }) => ({ file, line, test }));
  });
}

/** node's --test-name-pattern for exactly these tests' titles: a test matches by its own name, nested or not. */
export function namePattern(tests) {
  return `^(?:${[...new Set(tests.map(({ test }) => test.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")))].join("|")})$`;
}

/** The new tests of the checkout at `root`: its diff from merge-base(`base`, HEAD) to the working tree. Throws when git cannot say. */
export function changeNewTests(root, base = "origin/main") {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const diff = git("diff", "--no-color", "--no-ext-diff", git("merge-base", base, "HEAD").trim());
  const quiet = (read) => { try { return read(); } catch { return undefined; } };
  return newTests(diff, { readFile: (file) => quiet(() => readFileSync(path.join(root, file), "utf8")), readBlob: (blob) => quiet(() => git("cat-file", "blob", blob)) });
}

/** The red runs kept in the checkout at `root`, one row per failure. */
function reds(root) {
  try {
    return readFileSync(path.join(root, ".pgtest", "red-runs.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Run `tests` `times` times through `entry` (the test entry's node arguments, run from `root` with their files and their
 * --test-name-pattern after them) and say
 * which failed: each `{ file, test, failed }`, `failed` how many repeats it failed in; a repeat that failed naming none of them names
 * each file it ran, with `test` null. Returns the exit code and the lines it printed.
 */
export function repeatTests({ root, tests, times = TIMES, entry, env = process.env, print = console.log }) {
  if (tests.length === 0) {
    print("repeat: this change adds no numbered test, so nothing repeats");
    return 0;
  }
  const files = [...new Set(tests.map(({ file }) => file))];
  print(`repeat: ${tests.length} new test${tests.length === 1 ? "" : "s"}, ${times} times each: ${tests.map(({ file, test }) => `${file} › ${test}`).join("; ")}`);
  const counts = new Map();
  const count = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (let round = 1; round <= times; round += 1) {
    const before = reds(root).length;
    const started = Date.now();
    const run = spawnSync(process.execPath, [...entry, ...files, `--test-name-pattern=${namePattern(tests)}`], { cwd: root, env, stdio: "inherit", windowsHide: true });
    print(`repeat ${round} of ${times}: ${run.status === 0 ? "passed" : "FAILED"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (run.status === 0) continue;
    const seen = reds(root).slice(before);
    const named = tests.filter(({ file, test }) => seen.some((red) => red.file === file && (red.test === test || red.test?.endsWith(` › ${test}`))));
    if (named.length > 0) for (const { file, test } of named) count(`${file}\0${test}`);
    else for (const file of files) count(`${file}\0`);
  }
  if (counts.size === 0) {
    print(`repeat: every new test passed all ${times} times`);
    return 0;
  }
  for (const [key, failed] of counts) {
    const [file, test] = key.split("\0");
    print(`flaky: ${file}${test === "" ? "" : ` › ${test}`} failed ${failed} of ${times} repeats. A new test that does not pass every time is weak: investigate it (ADR-1352), never file it as friction.`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const times = Number(args.find((arg) => arg.startsWith("--times="))?.slice("--times=".length) ?? TIMES);
  const root = process.cwd();
  const entry = args.find((arg) => !arg.startsWith("--")) ?? path.relative(root, fileURLToPath(new URL("./test.mjs", import.meta.url)));
  process.exitCode = repeatTests({ root, tests: changeNewTests(root), times, entry: ["--import", "tsx", entry] });
}
