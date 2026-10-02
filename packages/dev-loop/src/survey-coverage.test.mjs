// Running the tests 6.5: the coverage run behind the code survey's coverage map (ADR-0838 D3), on a
// small package in a temporary folder whose numbered test runs its code only in processes it starts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { coverageOf } from "./survey-coverage.mjs";

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

    const map = await coverageOf({ root: pkg, pkgDir: pkg, env: process.env });
    // A file only loaded (child.mjs: no function of its own ran) is import tracing's to find, never coverage's.
    // The own-prefixed and unprefixed tests numbered 2 ran one mapped function and two work functions.
    // A foreign story's title must not allocate local code to a same-numbered local capability.
    assert.deepEqual(map, { "src/mapped.ts": { 2: 2 }, "src/work.mjs": { 2: 4 } });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
