// Capability 8 · Storytree's own test and gate entries.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import storytreePlugin from "./eslint-rules/index.mjs";
import { RECORD } from "./eslint-rules/no-comments.mjs";
import { MINIFIED_NAME } from "./eslint-rules/sketch-bundle-names.mjs";

const PEAK_MARK = "storytree-oxlint-peak-kb=";
const PRELOAD = `data:text/javascript,${encodeURIComponent(`process.on("exit", () => process.stderr.write("\\n${PEAK_MARK}" + process.resourceUsage().maxRSS + "\\n"));`)}`;
const REGEXP_RULES = { "regexp/no-super-linear-backtracking": "error", "regexp/no-super-linear-move": "error" };
const NO_COMMENTS = "storytree/no-comments";
const SOURCE = /\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/;
const RULE_PREFIXES = ["storytree/", "regexp/"];
const MINIFIED_MARK = /[._-]min\./g;

const oxlintPackage = fileURLToPath(import.meta.resolve("oxlint/package.json"));
const { version, bin } = JSON.parse(readFileSync(oxlintPackage, "utf8"));
const OXLINT_BIN = path.join(path.dirname(oxlintPackage), typeof bin === "string" ? bin : bin.oxlint);

const storytreeRules = (keep = () => true) => Object.fromEntries(Object.keys(storytreePlugin.rules).map((name) => `storytree/${name}`).filter(keep).map((name) => [name, "error"]));

function config() {
  return {
    jsPlugins: [fileURLToPath(new URL("./eslint-rules/index.mjs", import.meta.url)), fileURLToPath(import.meta.resolve("eslint-plugin-regexp"))],
    categories: { correctness: "off" },
    plugins: [],
    ignorePatterns: ["**/*.min.js"],
    rules: { ...storytreeRules(), ...REGEXP_RULES },
  };
}

function patternConfig(files) {
  return { ...config(), ignorePatterns: [], settings: { storytree: { batch: files } }, rules: { ...storytreeRules((name) => name !== NO_COMMENTS), ...REGEXP_RULES } };
}

const ruleName = (code) => {
  if (!code) return "parse";
  const named = /^([^()]+)\((.+)\)$/.exec(code);
  return named === null ? code : `${named[1]}/${named[2]}`;
};

function peakMegabytes(stderr) {
  const mark = stderr.lastIndexOf(PEAK_MARK);
  if (mark === -1) return null;
  const kilobytes = Number.parseInt(stderr.slice(mark + PEAK_MARK.length), 10);
  return Number.isFinite(kilobytes) ? (kilobytes / 1024).toFixed(1) : null;
}

function report(stdout) {
  try {
    return JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    return null;
  }
}

function runOxlint(lintConfig, place) {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-oxlint-"));
  try {
    const configFile = path.join(folder, "oxlintrc.json");
    const recordFolder = path.join(folder, "record");
    mkdirSync(recordFolder);
    writeFileSync(configFile, JSON.stringify(lintConfig));
    const started = performance.now();
    const run = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", PRELOAD, OXLINT_BIN, "-c", configFile, "--disable-nested-config", "-f", "json", "."], {
      cwd: place(folder),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, [RECORD]: recordFolder },
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const stderr = run.stderr ?? "";
    const result = report(run.stdout ?? "");
    const records = readdirSync(recordFolder).map((name) => JSON.parse(readFileSync(path.join(recordFolder, name), "utf8")));
    return { run, seconds, stderr, result: result !== null && Array.isArray(result.diagnostics) ? result : null, records };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function unfinished({ run, stderr }) {
  const tail = stderr.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith(PEAK_MARK)).slice(-5).join(" | ");
  const how = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit status ${run.status}`;
  return `Oxlint did not finish (${how}): ${tail || "no output"}`;
}

const slashed = (file) => file.replaceAll("\\", "/");

export async function oxlintProblems(root, { log = () => {} } = {}) {
  const linted = runOxlint(config(), () => root);
  const { result, stderr, seconds, records } = linted;
  if (result === null) return [unfinished(linted)];
  log(`oxlint ${version}: ${result.number_of_files} files, ${result.number_of_rules} rules, peak memory ${peakMegabytes(stderr) ?? "unknown"} MB, ${seconds} s`);
  return [
    ...result.diagnostics.map(({ message, code, filename, labels }) => filename === undefined ? message : `${slashed(filename)}:${labels?.[0]?.span?.line ?? 0} ${ruleName(code)}: ${message}`),
    ...records.flatMap(({ file, problems }) => problems.map(({ line, message }) => `${file}:${line} ${NO_COMMENTS}: ${message}`)),
  ];
}

export function ruleHits(entries) {
  const hits = entries.map(() => []);
  if (entries.length === 0) return hits;
  const linted = runOxlint(patternConfig(entries.map(({ file }) => file)), (folder) => {
    const batch = path.join(folder, "batch");
    entries.forEach(({ file, text }, index) => {
      const target = path.join(batch, String(index), path.dirname(file), path.basename(file).replace(MINIFIED_MARK, "."));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    });
    return batch;
  });
  if (linted.result === null) throw new Error(unfinished(linted));
  for (const { message, code, filename, labels } of linted.result.diagnostics) {
    const rule = ruleName(code);
    if (filename === undefined || !RULE_PREFIXES.some((prefix) => rule.startsWith(prefix))) continue;
    const index = Number(slashed(filename).split("/")[0]);
    if (rule.startsWith("regexp/") && MINIFIED_NAME.test(entries[index].file)) continue;
    hits[index].push({ line: labels?.[0]?.span?.line ?? 0, rule, message });
  }
  return hits;
}

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

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

function onAddedLine(added, file, first, last = first) {
  if (added === null) return true;
  const lines = added.get(file);
  if (lines === undefined) return false;
  for (let number = first; number <= last; number += 1) if (lines.has(number)) return true;
  return false;
}

export async function commentHatches(root) {
  const added = addedLines(root);
  const tracked = new Set(git(root, ["ls-files", "-z"]).split("\0").filter((file) => SOURCE.test(file) && !file.endsWith(".min.js") && (added === null || added.has(file))));
  if (tracked.size === 0) return [];
  const linted = runOxlint(config(), () => root);
  if (linted.result === null) throw new Error(unfinished(linted));
  return linted.records
    .filter(({ file }) => tracked.has(file))
    .flatMap(({ file, hatches }) => hatches
      .filter(({ line, endLine }) => onAddedLine(added, file, line, endLine) || onAddedLine(added, file, line - 1))
      .map(({ line, comment, reason }) => ({ file, line, comment, reason })));
}
