// Running the tests 6.5: the coverage run behind the code survey's coverage map (ADR-0838 D3), on a
// small package in a temporary folder whose numbered test runs its code only in processes it starts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

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
    // V8 may report a short Windows path or a resolved link. This child loads one fixture bundle.
    const bundles = records.flatMap(record => record.result).filter(script => script.url.endsWith("bundle.cjs"));
    assert.equal(bundles.length, 1, "the child reported exactly one fixture bundle");
    const [measured] = bundles;
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

test("6.5 App records same-checkout Desktop functions from Node and browser proofs without admitting other stories", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "survey-desktop-"));
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
    assert.equal(execFileSync(process.execPath, ["--enable-source-maps", bundlePath], { env: { ...process.env, NODE_V8_COVERAGE: coverageDir }, encoding: "utf8" }).trim(), "6");
    const records = readdirSync(coverageDir).map(file => JSON.parse(readFileSync(path.join(coverageDir, file), "utf8")));
    const bundles = records.flatMap(record => record.result).filter(script => script.url.endsWith("bundle.cjs"));
    assert.equal(bundles.length, 1);
    const functions = bundles[0].functions;
    for (const name of names) assert.equal(functions.find(fn => fn.functionName === name).ranges[0].count, name === "idle" ? 0 : 1);
    const scripts = [{ bundlePath, source, sourceMap, functions }];
    const proof = "app 1.7 measured Desktop frame";
    const desktop = "../../apps/desktop/src/main/args.ts";
    const browser = { [desktop]: { 1: 1 }, "src/frame.ts": { 1: 1 } };
    assert.deepEqual(recordBrowserCoverage({ pkgDir: pkg, proof, passed: true, scripts }), browser);
    const foreign = functions.filter(fn => ["forest", "world", "website", "outside"].includes(fn.functionName));
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "app 2.1 foreign only", passed: true, scripts: [{ ...scripts[0], functions: foreign }] }), /no executed source functions/);
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof: "website 1.7 wrong story", passed: true, scripts }), /own story/);
    write("packages/app/src/run.test.mjs", 'import { test } from "node:test";\nimport { execFileSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\ntest("app 4.10 runs the Desktop bundle", () => { execFileSync(process.execPath, ["--enable-source-maps", fileURLToPath(new URL("../../../apps/desktop/dist/bundle.cjs", import.meta.url))]); });\n');
    write("apps/desktop/src/node.mjs", "export function answer() { return 7; }\n");
    write("apps/desktop/src/node.test.mjs", 'import { test } from "node:test";\nimport { answer } from "./node.mjs";\ntest("app 6.1 answers", () => { if (answer() !== 7) throw Error("wrong answer"); });\ntest("forest 9.1 foreign title", () => {});\ntest("8.1 ambiguous Desktop title", () => {});\n');
    const expected = { [desktop]: { 1: 1, 4: 1 }, "../../apps/desktop/src/node.mjs": { 6: 1 }, "src/frame.ts": { 1: 1, 4: 1 } };
    assert.deepEqual(await coverageOf({ root: work, pkgDir: pkg, env: process.env }), expected);
    assert.deepEqual(await coverageOf({ root: work, pkgDir: pkg, env: process.env }), expected);
    // Rejected recapture removes only the browser contribution; real Node evidence remains.
    assert.throws(() => recordBrowserCoverage({ pkgDir: pkg, proof, passed: false, scripts }), /passing/);
    assert.deepEqual(await coverageOf({ root: work, pkgDir: pkg, env: process.env }), { [desktop]: { 4: 1 }, "../../apps/desktop/src/node.mjs": { 6: 1 }, "src/frame.ts": { 4: 1 } });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
