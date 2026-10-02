// `pnpm survey:coverage`: the coverage map the code survey reads where import tracing cannot reach
// (ADR-0838 D3). A command line's tests run the built command in a process they start, so no import
// leads from a test to the code it runs; the code it ran says which capability it belongs to.
//
// Each numbered test file of a story's package runs alone under NODE_V8_COVERAGE, which every process
// it starts inherits. A source file of the package is executed by that run when one of its functions
// ran (a module's top-level is only loaded: that is import tracing's to find), in the test's own
// process or any it started; a bundle's functions are traced back to their files through its source
// map. Each executing test file adds, for each capability number its tests are titled with, how many
// tests carry that number times how many of the file's functions it ran: a family every command passes
// through once goes to the capability whose tests run the most of it, not the one with the most tests. The map is written beside the package's src, as
// survey-coverage.json: `{ "src/families/arc.ts": { "4": 15 } }`, sorted, so a rerun changes it only
// when what ran changed. It is committed, and the survey reads it from the checkout.
//
//   pnpm survey:coverage              every package under packages/ with numbered tests
//   pnpm survey:coverage cli forest   the named packages (dir names)
//
// It runs under the machine's heavy-run lock, against a throwaway test Postgres as `pnpm test` does.

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runUnit } from "./unit-run.mjs";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const NUMBERED_TEST = /\b(?:test|it|describe)\s*\(\s*["'`](?:([a-z][a-z0-9-]*)\s+)?(\d+)\.\d+\b/g;
const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);
export const MAP_FILE = "survey-coverage.json";

/** Every code file under `dir`, as full paths. */
function codeFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : codeFiles(full);
    return CODE_FILE.test(entry.name) ? [full] : [];
  });
}

/** A path from a coverage record or a source map, as a full path; undefined for one not on disk (node:, data:). */
function fullPath(url, from) {
  if (url.startsWith("file:")) return fileURLToPath(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url)) return undefined;
  return path.resolve(from, url);
}

/** The full paths of the files whose functions ran, each with how many of its functions ran, read from a NODE_V8_COVERAGE folder. */
export function executedFiles(coverageDir) {
  const ran = new Map();
  const add = (file, fn) => ran.set(file, (ran.get(file) ?? new Set()).add(fn));
  for (const name of readdirSync(coverageDir)) {
    if (!name.endsWith(".json")) continue;
    let record;
    try {
      record = JSON.parse(readFileSync(path.join(coverageDir, name), "utf8"));
    } catch {
      continue; // a process killed mid-write leaves half a record: it proves nothing
    }
    const maps = record["source-map-cache"] ?? {};
    for (const script of record.result ?? []) {
      const file = fullPath(script.url, process.cwd());
      if (file === undefined) continue;
      const functions = script.functions.filter((fn) => fn.ranges[0].count > 0 && !(fn.ranges[0].startOffset === 0 && fn.functionName === ""));
      if (functions.length === 0) continue;
      const cached = maps[script.url];
      if (cached?.data === undefined || cached.lineLengths === undefined) {
        for (const fn of functions) add(file, fn.ranges[0].startOffset);
        continue;
      }
      // A function's offset into the script, as the line and column its source map is read by.
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

/**
 * The coverage map of the package at `pkgDir`: each source file a numbered test file executed, with,
 * for each capability number, the tests carrying it times the file's functions their file ran.
 * `root` is where tests run from.
 */
export async function coverageOf({ root, pkgDir: given, env, log = () => {} }) {
  // Coverage names files by their real path (macOS's temporary folder is a link to /private/var).
  const pkgDir = realpathSync(given);
  const ownPackage = path.basename(pkgDir);
  const src = path.join(pkgDir, "src");
  const tally = new Map();
  for (const testFile of codeFiles(src).filter((file) => TEST_FILE.test(file)).sort()) {
    const counts = new Map();
    for (const [, prefix, number] of readFileSync(testFile, "utf8").matchAll(NUMBERED_TEST)) {
      if (prefix === undefined || prefix === ownPackage) counts.set(number, (counts.get(number) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    const coverageDir = mkdtempSync(path.join(tmpdir(), "survey-coverage-"));
    try {
      const run = await runUnit({ root, files: [testFile], env: { ...env, NODE_V8_COVERAGE: coverageDir }, stdio: "ignore" });
      log(`${path.relative(root, testFile)}: ${run.code === 0 ? "passed" : "did not pass"} (${Math.round(run.ms / 1000)} s)`);
      for (const [file, functions] of executedFiles(coverageDir)) {
        const relative = path.relative(pkgDir, file).split(path.sep).join("/");
        if (!relative.startsWith("src/") || TEST_FILE.test(relative) || !CODE_FILE.test(relative)) continue;
        const counted = tally.get(relative) ?? new Map();
        for (const [number, count] of counts) counted.set(number, (counted.get(number) ?? 0) + count * functions);
        tally.set(relative, counted);
      }
    } finally {
      rmSync(coverageDir, { recursive: true, force: true });
    }
  }
  return Object.fromEntries([...tally].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, counts]) => [file, Object.fromEntries([...counts].sort(([a], [b]) => Number(a) - Number(b)))]));
}

async function main() {
  const { start } = await import("@storytree/local-postgres");
  const { acquireHeavyLock } = await import("./heavy-lock.mjs");
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const named = process.argv.slice(2).filter((arg) => arg !== "--");
  const packages = (named.length > 0 ? named : readdirSync(path.join(root, "packages"))).map((name) => path.join(root, "packages", name));
  const release = await acquireHeavyLock({ root, what: "a `pnpm survey:coverage` run" });
  try {
    let env = process.env;
    let server;
    if (!env.STORYTREE_TEST_PG_URL) {
      const work = path.join(root, ".pgtest");
      server = await start({ dataDir: path.join(work, "data"), serverLog: path.join(work, "pg.log"), toolLog: path.join(work, "tools.log"), owner: "a `pnpm survey:coverage` run", log: (message) => console.log(`test Postgres: ${message}`) });
      env = { ...env, STORYTREE_TEST_PG_URL: server.url, STORYTREE_TEST_PG_DATA: server.dataDir };
    }
    try {
      for (const pkgDir of packages) {
        const map = await coverageOf({ root, pkgDir, env: { ...env, STORYTREE_EMBEDDER: "off" }, log: (line) => console.log(line) });
        if (Object.keys(map).length === 0) continue;
        writeFileSync(path.join(pkgDir, MAP_FILE), `${JSON.stringify(map, null, 1)}\n`);
        console.log(`wrote ${path.relative(root, path.join(pkgDir, MAP_FILE))}: ${Object.keys(map).length} files`);
      }
    } finally {
      await server?.stop();
    }
  } finally {
    release();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
