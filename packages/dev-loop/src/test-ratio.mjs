// Capability 6 · Running the tests. `pnpm test-ratio`: how many lines of test code this repo has for each line of implementation,
// overall and per package. It is a report for the session landing an increment to read (ADR-0623 in
// storytree 0.2's decision log), never a gate: a rising ratio is a prompt to look, so there is no
// threshold and nothing fails on it.
//
// Only code lines are counted: a line holding something besides whitespace and comments. Comments
// are told from code by following strings, template literals and regular expressions, so the `//`
// in "https://" is not a comment. The files are the .ts, .tsx, .mts, .cts, .js, .mjs and .cjs files
// git knows about (tracked, or new and not ignored) under packages/ and apps/. A file is
// test code when its name has `.test.` in it, it is named test.<ext> (the test harness), it sits in
// a testing/ directory, or it imports node:test (a shared behaviour suite does); every other file is
// implementation.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** What a `/` can follow and start a regular expression rather than divide. */
const BEFORE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const WORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** The report's rows: a header, then test and implementation code lines and their ratio for each package and app, and for all. */
export function ratioRows(files) {
  const groups = new Map();
  for (const { path: file, text } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const [top, name] = file.split("/");
    const group = `${top}/${name}`;
    const counts = groups.get(group) ?? { test: 0, implementation: 0 };
    counts[isTest(file, text) ? "test" : "implementation"] += codeLines(text);
    groups.set(group, counts);
  }
  const all = { test: 0, implementation: 0 };
  for (const counts of groups.values()) {
    all.test += counts.test;
    all.implementation += counts.implementation;
  }
  return [["", "test", "implementation", "ratio"], ...[...groups].map(([group, counts]) => row(group, counts)), row("all", all)];
}

function main() {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "packages", "apps"],
    { cwd: root, encoding: "utf8" },
  );
  const files = [...new Set(listed.split("\0"))]
    .filter((file) => SOURCE.test(file) && existsSync(path.join(root, file)))
    .map((file) => ({ path: file, text: readFileSync(path.join(root, file), "utf8") }));
  const rows = ratioRows(files);
  const widths = rows[0].map((_, column) => Math.max(...rows.map((cells) => cells[column].length)));
  console.log("Test code per line of implementation, in code lines (comments and blanks left out):\n");
  for (const cells of rows) {
    console.log(`  ${cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("   ")}`);
  }
}

function row(group, { test, implementation }) {
  const ratio = implementation === 0 ? "-" : (test / implementation).toFixed(2);
  return [group, test.toLocaleString("en"), implementation.toLocaleString("en"), ratio];
}

function isTest(file, source) {
  const name = path.posix.basename(file);
  return (
    name.includes(".test.") ||
    name.startsWith("test.") ||
    file.split("/").includes("testing") ||
    /(?:\bfrom|\bimport|\brequire\()\s*["']node:test["']/.test(source)
  );
}

/** How many lines of `source` hold code. */
function codeLines(source) {
  let lines = 0;
  let code = false; // the current line holds code
  let state = "code"; // or: "line" and "block" comments, a quote (' " `), or "regex"
  let inClass = false; // inside a regular expression's [...]
  let last = ""; // the code token before this one: a punctuation character or a word
  let word = "";
  let depth = 0; // open braces
  const templates = []; // the brace depth at each ${ still open inside a template literal
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "\n") {
      if (code) lines++;
      code = false;
      if (word) [last, word] = [word, ""];
      // Only a block comment or a template literal runs on past the end of a line.
      if (state !== "block" && state !== "`") state = "code";
      continue;
    }
    if (state === "line") continue;
    if (state === "block") {
      if (c === "*" && next === "/") [state, i] = ["code", i + 1];
      continue;
    }
    if (state !== "code") {
      if (c.trim() !== "") code = true;
      if (c === "\\") {
        if (next !== "\n") i++;
      } else if (state === "regex") {
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) [state, last] = ["code", ")"];
      } else if (state === "`" && c === "$" && next === "{") {
        templates.push(depth++);
        [state, last, i] = ["code", "{", i + 1];
      } else if (c === state) {
        [state, last] = ["code", ")"];
      }
      continue;
    }
    if (c.trim() === "") {
      if (word) [last, word] = [word, ""];
      continue;
    }
    if (c === "/" && (next === "/" || next === "*")) {
      if (word) [last, word] = [word, ""];
      [state, i] = [next === "/" ? "line" : "block", i + 1];
      continue;
    }
    code = true;
    if (/[\w$]/.test(c)) {
      word += c;
      continue;
    }
    if (word) [last, word] = [word, ""];
    if (c === "'" || c === '"' || c === "`") {
      state = c;
    } else if (c === "/" && (BEFORE_REGEX.has(last) || WORDS_BEFORE_REGEX.has(last))) {
      [state, inClass] = ["regex", false];
    } else if (c === "}" && templates.length > 0 && depth - 1 === templates[templates.length - 1]) {
      templates.pop();
      depth--;
      state = "`";
    } else {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      last = c;
    }
  }
  if (code) lines++;
  return lines;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
