// Running the tests 6.5: the coverage run behind the code survey's coverage map (ADR-0838 D3), on a
// small package in a temporary folder whose numbered test runs its code only in processes it starts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { coverageOf } from "./survey-coverage.mjs";
import { recordBrowserCoverage } from "./browser-coverage.mjs";

test("6.5 a coverage run records, for each source file, the numbered tests of each number that executed it times the functions of it they ran, in processes the tests started and through a bundle's source map", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "survey-coverage-"));
  const pkg = path.join(work, "keys");
  try {
    mkdirSync(path.join(pkg, "src"), { recursive: true });
    mkdirSync(path.join(pkg, "dist"));
    const write = (file, text) => writeFileSync(path.join(pkg, file), text);
    write("src/work.mjs", "export function work() {\n  return 1;\n}\nexport function again() {\n  return 2;\n}\n");
    write("src/idle.mjs", "export function idle() {\n  return 0;\n}\n");
    write("src/child.mjs", 'import { again, work } from "./work.mjs";\nwork();\nagain();\n');
    write("src/mapped.ts", "export function mapped() {\n  return 2;\n}\n");
    write("dist/bundle.mjs", `function mapped() { return 2; }\nmapped();\n//# sourceMappingURL=bundle.mjs.map\n`);
    write("dist/bundle.mjs.map", JSON.stringify({ version: 3, sources: ["../src/mapped.ts"], names: [], mappings: "AAAA" }));
    write("src/run.test.mjs", [
      'import { execFileSync } from "node:child_process";',
      'import { fileURLToPath } from "node:url";',
      'import { test } from "node:test";',
      'const here = new URL(".", import.meta.url);',
      'test("keys 2.1 runs the child", () => { execFileSync(process.execPath, [fileURLToPath(new URL("child.mjs", here))]); });',
      'test("2.2 runs the bundle", () => { execFileSync(process.execPath, [fileURLToPath(new URL("../dist/bundle.mjs", here))]); });',
      'test("forest-world 9.1 names another story", () => {});',
      'test("unnumbered", () => {});',
      "",
    ].join("\n"));
    write("src/plain.test.mjs", 'import { test } from "node:test";\ntest("no number", () => {});\n');
    write("src/failed.mjs", "export function failed() { return 9; }\n");
    write("src/failed.test.mjs", 'import { test } from "node:test";\nimport { failed } from "./failed.mjs";\ntest("9.1 fails after execution", () => { failed(); throw Error("proof failed"); });\n');

    const map = await coverageOf({ root: pkg, pkgDir: pkg, env: process.env });
    // A file only loaded (child.mjs: no function of its own ran) is import tracing's to find, never coverage's.
    // The own-prefixed and unprefixed tests numbered 2 ran one mapped function and two work functions.
    // A foreign story's title must not allocate local code to a same-numbered local capability.
    assert.deepEqual(map, { "src/mapped.ts": { 2: 2 }, "src/work.mjs": { 2: 4 } });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("6.5 measured browser bundle inputs survive Node regeneration, scoped to passing proofs in their own story", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "survey-browser-"));
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
    const coverageDir = path.join(work, "coverage");
    assert.equal(execFileSync(process.execPath, ["--enable-source-maps", bundlePath], { env: { ...process.env, NODE_V8_COVERAGE: coverageDir }, encoding: "utf8" }).trim(), "43");
    const records = readdirSync(coverageDir).map(file => JSON.parse(readFileSync(path.join(coverageDir, file), "utf8")));
    const measured = records.flatMap(record => record.result).find(script => script.url === pathToFileURL(realpathSync(bundlePath)).href);
    assert.ok(measured.functions.find(fn => fn.functionName === "clicked").ranges[0].count > 0);
    assert.equal(measured.functions.find(fn => fn.functionName === "idle").ranges[0].count, 0);
    const scripts = [{ bundlePath, source, sourceMap, functions: measured.functions }];
    const proof = "keys 2.1 the click answers";
    assert.deepEqual(recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts }), { "src/view.ts": { 2: 1 } });
    // Repeating a capture replaces its previous contribution rather than accumulating it.
    recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts });
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "forest-world 2.1 foreign", passed: true, scripts }), /own story/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "keys 3.1 failed", passed: false, scripts }), /passing/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "keys 4.1 idle", passed: true, scripts: [{ ...scripts[0], functions: measured.functions.filter(fn => fn.functionName === "idle") }] }), /executed/);
    writeFileSync(path.join(pkg, "src/node.mjs"), "export function answer() { return 7; }\n");
    writeFileSync(path.join(pkg, "src/node.test.mjs"), 'import { test } from "node:test";\nimport { answer } from "./node.mjs";\ntest("keys 5.1 answers", () => { if (answer() !== 7) throw Error("wrong answer"); });\n');
    const expected = { "src/node.mjs": { 5: 1 }, "src/view.ts": { 2: 1 } };
    assert.deepEqual(await coverageOf({ root: pkg, pkgDir: pkg, env: process.env }), expected);
    assert.deepEqual(await coverageOf({ root: pkg, pkgDir: pkg, env: process.env }), expected);
    // A failed recapture invalidates that proof's earlier evidence.
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof, passed: false, scripts }), /passing/);
    assert.deepEqual(await coverageOf({ root: pkg, pkgDir: pkg, env: process.env }), { "src/node.mjs": { 5: 1 } });
    recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts });
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts: [{ ...scripts[0], sourceMap: undefined }] }), /source map/);
    assert.deepEqual(await coverageOf({ root: pkg, pkgDir: pkg, env: process.env }), { "src/node.mjs": { 5: 1 } });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
