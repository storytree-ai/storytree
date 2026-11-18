// Capability 8 · Storytree's own test and gate entries.
import { execFileSync } from "node:child_process";
import path from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import storytreePlugin from "./eslint-rules/index.mjs";

const SOURCE = /\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/;
const TYPESCRIPT = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

function trackedSources(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((file) => SOURCE.test(file) && !file.endsWith(".min.js"));
}

function config(plugin) {
  const rules = Object.fromEntries(Object.keys(plugin.rules).map((name) => [`storytree/${name}`, "error"]));
  return [
    { linterOptions: { reportUnusedDisableDirectives: "off" } },
    { files: ["**/*.js", "**/*.mjs", "**/*.cjs"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    { files: TYPESCRIPT, languageOptions: { parser: tseslint.parser } },
    { files: ["**/*.js", "**/*.mjs", "**/*.cjs", ...TYPESCRIPT], plugins: { storytree: plugin }, rules },
  ];
}

export async function eslintProblems(root, { plugin = storytreePlugin } = {}) {
  const files = trackedSources(root);
  if (files.length === 0) return [];
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config(plugin), errorOnUnmatchedPattern: false, warnIgnored: false });
  const results = await eslint.lintFiles(files);
  return results.flatMap((result) => {
    const file = path.relative(root, result.filePath).split(path.sep).join("/");
    return result.messages.map((message) => `${file}:${message.line} ${message.ruleId ?? "parse"}: ${message.message}`);
  });
}
