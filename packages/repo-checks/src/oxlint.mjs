// Capability 8 · Storytree's own test and gate entries.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import storytreePlugin from "./eslint-rules/index.mjs";

const PEAK_MARK = "storytree-oxlint-peak-kb=";
const PRELOAD = `data:text/javascript,${encodeURIComponent(`process.on("exit", () => process.stderr.write("\\n${PEAK_MARK}" + process.resourceUsage().maxRSS + "\\n"));`)}`;
const REGEXP_RULES = { "regexp/no-super-linear-backtracking": "error", "regexp/no-super-linear-move": "error" };

const oxlintPackage = fileURLToPath(import.meta.resolve("oxlint/package.json"));
const { version, bin } = JSON.parse(readFileSync(oxlintPackage, "utf8"));
const OXLINT_BIN = path.join(path.dirname(oxlintPackage), typeof bin === "string" ? bin : bin.oxlint);

function config() {
  return {
    jsPlugins: [fileURLToPath(new URL("./eslint-rules/index.mjs", import.meta.url)), fileURLToPath(import.meta.resolve("eslint-plugin-regexp"))],
    categories: { correctness: "off" },
    plugins: [],
    ignorePatterns: ["**/*.min.js"],
    rules: { ...Object.fromEntries(Object.keys(storytreePlugin.rules).map((name) => [`storytree/${name}`, "error"])), ...REGEXP_RULES },
  };
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
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export async function oxlintProblems(root, { log = () => {} } = {}) {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-oxlint-"));
  try {
    const configFile = path.join(folder, "oxlintrc.json");
    writeFileSync(configFile, JSON.stringify(config()));
    const started = performance.now();
    const run = spawnSync(process.execPath, ["--import", PRELOAD, OXLINT_BIN, "-c", configFile, "-f", "json", "."], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const stderr = run.stderr ?? "";
    const result = report(run.stdout ?? "");
    if (result === null || !Array.isArray(result.diagnostics)) {
      const tail = stderr.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith(PEAK_MARK)).slice(-5).join(" | ");
      const how = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit status ${run.status}`;
      return [`Oxlint did not finish (${how}): ${tail || "no output"}`];
    }
    log(`oxlint ${version}: ${result.number_of_files} files, ${result.number_of_rules} rules, peak memory ${peakMegabytes(stderr) ?? "unknown"} MB, ${seconds} s`);
    return result.diagnostics.map(({ message, code, filename, labels }) => `${filename.replaceAll("\\", "/")}:${labels?.[0]?.span?.line ?? 0} ${ruleName(code)}: ${message}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
