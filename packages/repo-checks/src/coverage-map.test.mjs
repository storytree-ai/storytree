// The browser half of the measured coverage map (coverage-map.mjs, ADR-0838 D3): a story's evidence capture records the
// functions its passing browser proof ran, read through the bundle's source map, into survey-browser-coverage.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { browserProofs, executedFiles, recordBrowserCoverage } from "./coverage-map.mjs";

/** The bundle at `bundlePath` run under coverage into `coverageDir`, and the one script record it reported for that bundle. */
function measure(bundlePath, coverageDir, expected) {
  assert.equal(execFileSync(process.execPath, ["--enable-source-maps", bundlePath], { env: { ...process.env, NODE_V8_COVERAGE: coverageDir }, encoding: "utf8" }).trim(), expected);
  const records = readdirSync(coverageDir).map(file => JSON.parse(readFileSync(path.join(coverageDir, file), "utf8")));
  // V8 may report a short Windows path or a resolved link. This child loads one fixture bundle.
  const bundles = records.flatMap(record => record.result).filter(script => script.url.endsWith("bundle.cjs"));
  assert.equal(bundles.length, 1, "the child reported exactly one fixture bundle");
  return bundles[0];
}

test("6.2 · a passing browser proof that names its own story records the functions of its story's source it ran, through the bundle's source map; a recapture replaces it, and a failed one removes it", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "coverage-map-"));
  const work = path.join(temp, "linked");
  mkdirSync(path.join(temp, "actual"));
  symlinkSync(path.join(temp, "actual"), work, "junction");
  const pkg = path.join(work, "keys");
  try {
    for (const dir of ["keys/src", "keys/dist", "foreign/src", "coverage"]) mkdirSync(path.join(work, dir), { recursive: true });
    const source = 'function clicked() { return 42; }\nfunction idle() { return 0; }\nfunction foreign() { return 1; }\nconsole.log(clicked() + foreign());\n';
    const sourceMap = { version: 3, sources: ["../src/view.ts", "../src/idle.ts", "../../foreign/src/work.ts"], names: [], mappings: "AAAA;ACAA;ACAA" };
    const bundlePath = path.join(pkg, "dist/bundle.cjs");
    writeFileSync(bundlePath, source + "//# sourceMappingURL=bundle.cjs.map\n");
    writeFileSync(bundlePath + ".map", JSON.stringify(sourceMap));
    for (const file of ["keys/src/view.ts", "keys/src/idle.ts", "foreign/src/work.ts"]) writeFileSync(path.join(work, file), source);
    const measured = measure(bundlePath, path.join(work, "coverage"), "43");
    assert.ok(measured.functions.find(fn => fn.functionName === "clicked").ranges[0].count > 0);
    assert.equal(measured.functions.find(fn => fn.functionName === "idle").ranges[0].count, 0);
    const scripts = [{ bundlePath, source, sourceMap, functions: measured.functions }];
    const proof = "keys 2.1 the click answers";
    // Only the ran function of the package's own source counts: not the idle one, not the other story's.
    assert.deepEqual(recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts }), { "src/view.ts": { 2: 1 } });
    // Repeating a capture replaces its previous contribution rather than accumulating it.
    recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts });
    assert.deepEqual(browserProofs(pkg), { [proof]: { "src/view.ts": { 2: 1 } } });
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "forest-world 2.1 foreign", passed: true, scripts }), /own story/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "keys 3.1 failed", passed: false, scripts }), /passing/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "keys 4.1 idle", passed: true, scripts: [{ ...scripts[0], functions: measured.functions.filter(fn => fn.functionName === "idle") }] }), /executed/);
    assert.deepEqual(browserProofs(pkg), { [proof]: { "src/view.ts": { 2: 1 } } }, "a refused capture of another proof leaves this one's");
    // A failed recapture invalidates that proof's earlier evidence, and so does one with no source map.
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof, passed: false, scripts }), /passing/);
    assert.deepEqual(browserProofs(pkg), {});
    recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts });
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts: [{ ...scripts[0], sourceMap: undefined }] }), /source map/);
    assert.deepEqual(browserProofs(pkg), {});
  } finally {
    await removeTemp(temp);
  }
});

test("6.2 · App's browser proof records the same checkout's Desktop functions and no other story's, and Node coverage reads a bundle's map under either spelling of its path", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "coverage-map-desktop-"));
  const work = path.join(temp, "linked");
  mkdirSync(path.join(temp, "actual"));
  symlinkSync(path.join(temp, "actual"), work, "junction");
  const pkg = path.join(work, "packages/app");
  const write = (file, text) => {
    const full = path.join(work, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  try {
    const files = ["packages/app/src/frame.ts", "apps/desktop/src/main/args.ts", "packages/forest/src/view.ts", "packages/forest-world/src/view.ts", "packages/website/src/view.ts", "other/apps/desktop/src/main/args.ts", "apps/desktop/src/idle.ts"];
    const names = ["frame", "desktop", "forest", "world", "website", "outside", "idle"];
    const source = names.map(name => `function ${name}() { return 1; }`).join("\n") + "\nconsole.log(frame() + desktop() + forest() + world() + website() + outside());\n";
    for (const file of files) write(file, source);
    const bundlePath = path.join(work, "apps/desktop/dist/bundle.cjs");
    const sourceMap = { version: 3, sources: files.map(file => path.relative(path.dirname(bundlePath), path.join(work, file)).split(path.sep).join("/")), names: [], mappings: files.map((_, i) => i === 0 ? "AAAA" : "ACAA").join(";") };
    write("apps/desktop/dist/bundle.cjs", source + "//# sourceMappingURL=bundle.cjs.map\n");
    write("apps/desktop/dist/bundle.cjs.map", JSON.stringify(sourceMap));
    const coverageDir = path.join(work, "coverage");
    mkdirSync(coverageDir);
    const { functions } = measure(bundlePath, coverageDir, "6");
    for (const name of names) assert.equal(functions.find(fn => fn.functionName === name).ranges[0].count, name === "idle" ? 0 : 1);
    const scripts = [{ bundlePath, source, sourceMap, functions }];
    // V8 and Node's map cache can spell the same file differently across a link or junction.
    // Keep the real measured functions and map, but give the cache the other valid file URL.
    const urls = [pathToFileURL(bundlePath).href, pathToFileURL(realpathSync(bundlePath)).href];
    for (const name of readdirSync(coverageDir)) {
      const file = path.join(coverageDir, name);
      const record = JSON.parse(readFileSync(file, "utf8"));
      const maps = record["source-map-cache"] ?? {};
      for (const url of Object.keys(maps)) if (url.endsWith("bundle.cjs")) {
        const map = maps[url];
        delete maps[url];
        maps[urls.find(candidate => candidate !== url)] = map;
      }
      writeFileSync(file, JSON.stringify(record));
    }
    const nodeSources = executedFiles(coverageDir);
    assert.equal([...nodeSources].filter(([file]) => file.endsWith(`${path.sep}frame.ts`)).reduce((sum, [, count]) => sum + count, 0), 1, "mapped Node execution survives an equivalent cache URL");
    const proof = "app 1.7 measured Desktop frame";
    const desktop = "../../apps/desktop/src/main/args.ts";
    assert.deepEqual(recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts }), { [desktop]: { 1: 1 }, "src/frame.ts": { 1: 1 } });
    const foreign = functions.filter(fn => ["forest", "world", "website", "outside"].includes(fn.functionName));
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "app 2.1 foreign only", passed: true, scripts: [{ ...scripts[0], functions: foreign }] }), /no executed source functions/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "website 1.7 wrong story", passed: true, scripts }), /own story/);
  } finally {
    await removeTemp(temp);
  }
});
