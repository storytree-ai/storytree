// Capability 6 · Repeating a change's new tests
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TIMES = 5;

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const NUMBERED = /^\d+\.\d+/;
const INERT = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\.|(?!\1)[^\\])*\1|(?=\/)(?<=(?:^|=>|[(,=:[!&|?{};+\-*%~^]|\breturn|\btypeof|\bcase)[ \t]*)\/(?:\\.|\[(?:\\.|[^\]\\\r\n])*\]|[^/\\\r\n[])+\/[a-z]*/gm;
const CALLED = /\b(?:test|it)(?:\.only)?\s*\(\s*$/;
const WRAPPER = /(?<![\w$.])(?:(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?|function\s+([\w$]+)\s*)\(/g;
const BODY = /\s*(?::[^={]*)?(?:=>\s*)?\{/y;
const COOKED = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };

const escaped = (value) => value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

function cooked(value) {
  return value.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) =>
    escape.length > 1 ? String.fromCodePoint(parseInt(escape.replace(/^[ux]\{?|\}$/g, ""), 16)) : COOKED[escape] ?? escape);
}

function closeOf(code, from) {
  let depth = 1;
  for (let at = from; at < code.length; at += 1) {
    const char = code[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if ((char === ")" || char === "]" || char === "}") && --depth === 0) return at;
  }
  return code.length;
}

function split(code, from, to) {
  const pieces = [];
  let start = from;
  for (let at = from; at < to; at += 1) {
    if (code[at] === "(" || code[at] === "[" || code[at] === "{") at = closeOf(code, at + 1);
    else if (code[at] === ",") {
      pieces.push([start, at]);
      start = at + 1;
    }
  }
  return [...pieces, [start, to]];
}

function wrapped(text, code, strings) {
  const wrappers = [];
  for (const match of code.matchAll(WRAPPER)) {
    const open = match.index + match[0].length - 1;
    const close = closeOf(code, open + 1);
    BODY.lastIndex = close + 1;
    const body = BODY.exec(code);
    if (body === null) continue;
    const params = split(code, open + 1, close).map(([from, to]) => /^\s*(?:\.\.\.)?([\w$]+)/.exec(code.slice(from, to))?.[1]);
    wrappers.push({ name: match[1] ?? match[2], params, from: body.index + body[0].length, to: closeOf(code, body.index + body[0].length) });
  }
  const titled = new Map();
  for (const { at: start, value, template } of strings) {
    if (!template || !value.includes("${") || !CALLED.test(code.slice(Math.max(0, start - 40), start))) continue;
    const wrapper = wrappers.filter(({ from, to }) => from <= start && start < to).at(-1);
    if (wrapper !== undefined) titled.set(wrapper.name, { params: wrapper.params, parts: value.split(/\$\{([^{}]*)\}/) });
  }
  return [...titled].flatMap(([name, { params, parts }]) => [...code.matchAll(new RegExp(`(?<![\\w$.])${escaped(name)}\\s*\\(`, "g"))]
    .filter(({ index }) => !/\bfunction\s+$/.test(code.slice(Math.max(0, index - 20), index)))
    .map(({ index, 0: call }) => {
      const close = closeOf(code, index + call.length);
      const args = split(code, index + call.length, close);
      const values = args.map(([from, to]) => {
        const string = strings.find(({ at, end }) => from <= at && end <= to);
        return string === undefined || text.slice(from, to).trim() !== text.slice(string.at, string.end) || (string.template && string.value.includes("${")) ? undefined : cooked(string.value);
      });
      let test = "";
      let pattern = "";
      parts.forEach((part, slot) => {
        const value = slot % 2 === 0 ? cooked(part) : values[params.indexOf(part.trim())];
        test += value ?? `\${${part}}`;
        pattern += value === undefined ? ".*" : escaped(value);
      });
      return { line: text.slice(0, index).split("\n").length, test, pattern, body: text.slice(args[0][1], close).replace(/\s+/g, " ").trim() };
    }));
}

function titlesIn(text) {
  const strings = [];
  const code = text.replace(INERT, (token, quote, at) => {
    if (quote !== undefined) strings.push({ at, end: at + token.length, value: token.slice(1, -1), template: quote === "`" });
    return token.replace(/[^\r\n]/g, " ");
  });
  return [...strings
    .filter(({ at, value, template }) => CALLED.test(code.slice(Math.max(0, at - 40), at)) && !(template && value.includes("${")))
    .map(({ at, end, value }) => ({ line: text.slice(0, at).split("\n").length, test: cooked(value), pattern: escaped(cooked(value)), body: text.slice(end, closeOf(code, end)).replace(/\s+/g, " ").trim() })),
  ...wrapped(text, code, strings)];
}

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
    }).map(({ line, test, pattern }) => ({ file, line, test, pattern }));
  });
}

export function namePattern(tests) {
  return `^(?:${[...new Set(tests.map(({ test, pattern }) => pattern ?? escaped(test)))].join("|")})$`;
}

export function changeNewTests(root, base = "origin/main") {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const diff = git("diff", "--no-color", "--no-ext-diff", git("merge-base", base, "HEAD").trim());
  const quiet = (read) => { try { return read(); } catch { return undefined; } };
  return newTests(diff, { readFile: (file) => quiet(() => readFileSync(path.join(root, file), "utf8")), readBlob: (blob) => quiet(() => git("cat-file", "blob", blob)) });
}

function reds(root) {
  try {
    return readFileSync(path.join(root, ".pgtest", "red-runs.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

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
    const named = tests.filter(({ file, test, pattern }) => seen.some((red) => red.file === file && new RegExp(`(?:^| › )(?:${pattern ?? escaped(test)})$`).test(red.test ?? "")));
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
