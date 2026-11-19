// Capability 8 · Storytree's own test and gate entries.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ESLint, Linter } from "eslint";
import regexpPlugin from "eslint-plugin-regexp";
import tseslint from "typescript-eslint";

import storytreePlugin from "./eslint-rules/index.mjs";
import { MINIFIED_NAME } from "./eslint-rules/sketch-bundle-names.mjs";

const SOURCE = /\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/;
const TYPESCRIPT = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const NO_COMMENTS = "storytree/no-comments";
const NEVER_SILENCED = new Set(["needsReason", "onlyNextLine"]);
const REGEXP_RULES = { "regexp/no-super-linear-backtracking": "error", "regexp/no-super-linear-move": "error" };
const RULE_PREFIXES = ["storytree/", "regexp/"];

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

function trackedSources(root) {
  return git(root, ["ls-files", "-z"])
    .split("\0")
    .filter((file) => SOURCE.test(file) && !file.endsWith(".min.js"));
}

function config(plugin) {
  const rules = Object.fromEntries(Object.keys(plugin.rules).map((name) => [`storytree/${name}`, "error"]));
  return [
    { linterOptions: { reportUnusedDisableDirectives: "off" } },
    { files: TYPESCRIPT, languageOptions: { parser: tseslint.parser } },
    { files: ["**/*.js", "**/*.mjs", "**/*.cjs", ...TYPESCRIPT], plugins: { storytree: plugin, regexp: regexpPlugin }, rules: { ...rules, ...REGEXP_RULES } },
  ];
}

const PATTERN_RULES = Object.fromEntries(Object.keys(storytreePlugin.rules).filter((name) => `storytree/${name}` !== NO_COMMENTS).map((name) => [`storytree/${name}`, "error"]));
const PATTERN_CONFIG = [
  { files: ["**/*"], plugins: { storytree: storytreePlugin }, rules: PATTERN_RULES },
  { files: TYPESCRIPT, languageOptions: { parser: tseslint.parser } },
  { files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
];

export function ruleHits(file, text) {
  const config = MINIFIED_NAME.test(file) ? PATTERN_CONFIG : [...PATTERN_CONFIG, { files: ["**/*"], plugins: { regexp: regexpPlugin }, rules: REGEXP_RULES }];
  return new Linter().verify(text, config, { filename: file })
    .filter(({ ruleId }) => RULE_PREFIXES.some((prefix) => ruleId?.startsWith(prefix)))
    .map(({ line, ruleId, message }) => ({ line, rule: ruleId, message }));
}

function mergeBase(root) {
  try {
    return git(root, ["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    return null;
  }
}

function addedLines(root) {
  const base = mergeBase(root);
  if (!base) return null;
  const added = new Map();
  let header = false;
  let lines = null;
  for (const line of git(root, ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", "--no-prefix", base, "--"]).split("\n")) {
    if (line.startsWith("diff --git ")) {
      header = true;
      lines = null;
    } else if (header && line.startsWith("+++ ")) {
      header = false;
      lines = new Set();
      added.set(line.slice(4).replace(/\t$/, ""), lines);
    } else {
      const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (hunk === null || lines === null) continue;
      header = false;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let number = start; number < start + count; number += 1) lines.add(number);
    }
  }
  return added;
}

function onAddedLine(added, file, message) {
  if (added === null) return true;
  const lines = added.get(file);
  if (lines === undefined) return false;
  for (let number = message.line; number <= (message.endLine ?? message.line); number += 1) if (lines.has(number)) return true;
  return false;
}

async function lintResults(root, plugin, files) {
  if (files.length === 0) return [];
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config(plugin), errorOnUnmatchedPattern: false, warnIgnored: false });
  const results = await eslint.lintFiles(files);
  return results.map((result) => ({ file: path.relative(root, result.filePath).split(path.sep).join("/"), result }));
}

export async function eslintProblems(root, { plugin = storytreePlugin } = {}) {
  return (await lintResults(root, plugin, trackedSources(root))).flatMap(({ file, result }) =>
    [...result.messages, ...result.suppressedMessages.filter((message) => message.ruleId === NO_COMMENTS && NEVER_SILENCED.has(message.messageId))]
      .map((message) => `${file}:${message.line} ${message.ruleId ?? "parse"}: ${message.message}`),
  );
}

function commentText(lines, { line, column, endLine, endColumn }) {
  const span = line === endLine
    ? lines[line - 1].slice(column - 1, endColumn - 1)
    : [lines[line - 1].slice(column - 1), ...lines.slice(line, endLine - 1), lines[endLine - 1].slice(0, endColumn - 1)].join("\n");
  return span.replace(/^\/[/*]|\*\/$/g, "").trim();
}

export async function commentHatches(root) {
  const added = addedLines(root);
  const files = trackedSources(root).filter((file) => added === null || added.has(file));
  return (await lintResults(root, storytreePlugin, files)).flatMap(({ file, result }) => {
    const hatched = result.suppressedMessages.filter((message) => message.ruleId === NO_COMMENTS && message.messageId === "hatched" && (onAddedLine(added, file, message) || onAddedLine(added, file, { line: message.line - 1 })));
    if (hatched.length === 0) return [];
    const lines = readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    return hatched.map((message) => ({
      file,
      line: message.line,
      comment: commentText(lines, message),
      reason: message.suppressions.find(({ kind }) => kind === "directive")?.justification.trim() ?? "",
    }));
  });
}
