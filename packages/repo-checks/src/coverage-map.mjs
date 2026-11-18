// Capability 6 · Code allocation guardrail

import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { SourceMap } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
export const CODE_FILE = /\.[cm]?[jt]sx?$/;
export const MAP_FILE = "survey-coverage.json";
const BROWSER_FILE = "survey-browser-coverage.json";

function fullPath(url, from) {
  if (url.startsWith("file:")) return fileURLToPath(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url)) return undefined;
  return path.resolve(from, url);
}

const realFile = file => existsSync(file) ? realpathSync(file) : file;

export function executedFiles(coverageDir) {
  const records = [];
  for (const name of readdirSync(coverageDir)) {
    if (!name.endsWith(".json")) continue;
    let record;
    try {
      record = JSON.parse(readFileSync(path.join(coverageDir, name), "utf8"));
    } catch {
      continue;
    }
    records.push(record);
  }
  return executedRecords(records);
}

function executedRecords(records) {
  const ran = new Map();
  const add = (file, fn) => ran.set(file, (ran.get(file) ?? new Set()).add(fn));
  for (const record of records) {
    const maps = record["source-map-cache"] ?? {};
    const byFile = new Map(Object.entries(maps).flatMap(([url, cached]) => {
      const file = fullPath(url, process.cwd());
      return file === undefined ? [] : [[realFile(file), cached]];
    }));
    for (const script of record.result ?? []) {
      const file = fullPath(script.url, process.cwd());
      if (file === undefined) continue;
      const functions = script.functions.filter((fn) => fn.ranges[0].count > 0 && !(fn.ranges[0].startOffset === 0 && fn.functionName === ""));
      if (functions.length === 0) continue;
      const cached = maps[script.url] ?? byFile.get(realFile(file));
      if (cached?.data === undefined || cached.lineLengths === undefined) {
        for (const fn of functions) add(file, fn.ranges[0].startOffset);
        continue;
      }
      const starts = [0];
      for (const length of cached.lineLengths) starts.push(starts.at(-1) + length + 1);
      const map = new SourceMap(cached.data);
      for (const fn of functions) {
        const offset = fn.ranges[0].startOffset;
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
        const entry = map.findEntry(line, offset - starts[line]);
        const source = entry?.originalSource === undefined ? undefined : fullPath(entry.originalSource, path.dirname(file));
        if (source !== undefined) add(source, `${entry.originalLine}:${entry.originalColumn}`);
      }
    }
  }
  return new Map([...ran].map(([file, functions]) => [file, functions.size]));
}

export function browserProofs(pkgDir) {
  try {
    return JSON.parse(readFileSync(path.join(pkgDir, BROWSER_FILE), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function sorted(tally) {
  return Object.fromEntries([...tally].sort(([a], [b]) => a.localeCompare(b)).map(([file, counts]) => [file, Object.fromEntries([...counts].sort(([a], [b]) => Number(a) - Number(b)))]));
}

export function sourceRoots(pkgDir) {
  return path.basename(pkgDir) === "app" && path.basename(path.dirname(pkgDir)) === "packages"
    ? ["src/", "../../apps/desktop/src/"] : ["src/"];
}

export function addExecution(tally, pkgDir, executed, counts) {
  for (const [file, functions] of executed) {
    const relative = path.relative(pkgDir, realFile(file)).split(path.sep).join("/");
    if (!sourceRoots(pkgDir).some(root => relative.startsWith(root)) || TEST_FILE.test(relative) || !CODE_FILE.test(relative)) continue;
    const counted = tally.get(relative) ?? new Map();
    for (const [number, count] of counts) counted.set(number, (counted.get(number) ?? 0) + count * functions);
    tally.set(relative, counted);
  }
}

export function recordBrowserCoverage({ pkgDir: given, proof, passed, scripts }) {
  const pkgDir = realpathSync(given);
  const match = /^([a-z][a-z0-9-]*) (\d+)\.\d+\b/.exec(proof);
  if (!match || match[1] !== path.basename(pkgDir)) throw new Error("browser proof must name its own story and contract number");
  const proofs = browserProofs(pkgDir);
  delete proofs[proof];
  const save = () => writeFileSync(path.join(pkgDir, BROWSER_FILE), `${JSON.stringify(Object.fromEntries(Object.entries(proofs).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
  save();
  if (passed !== true) {
    throw new Error("only a passing browser proof contributes coverage");
  }
  const records = scripts.map(({ bundlePath, source, sourceMap, functions }) => {
    if (!sourceMap || typeof source !== "string") throw new Error("browser coverage needs its generated source and source map");
    const url = pathToFileURL(path.resolve(pkgDir, bundlePath)).href;
    return { result: [{ url, functions }], "source-map-cache": { [url]: { data: sourceMap, lineLengths: source.split("\n").map(line => line.length) } } };
  });
  const tally = new Map();
  addExecution(tally, pkgDir, executedRecords(records), new Map([[match[2], 1]]));
  const measured = sorted(tally);
  if (tally.size === 0) {
    throw new Error("browser proof has no executed source functions in its own story");
  }
  proofs[proof] = measured;
  save();
  return measured;
}
