import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { mainBuild, preloadBuild, surveyWorkerBuild } from "./bundles.js";
import { importMetaHazards } from "./cjs-import-meta.js";

const dist = path.join(tmpdir(), "storytree-cjs-import-meta");

test("4.50 · main.cjs, preload.cjs and survey-worker.cjs, built as the app builds them, hand no unguarded import.meta read to fileURLToPath, createRequire, new URL or a path function, and call no import.meta.resolve", { timeout: 180_000 }, async () => {
  assert.deepEqual(await importMetaHazards([mainBuild(dist), preloadBuild(dist), surveyWorkerBuild(dist)]), []);
});

test("4.50 · a CommonJS bundle reaching a first-party module that hands import.meta.url unguarded to fileURLToPath, new URL or createRequire, or calls import.meta.resolve, is named by file and line; reads guarded by a conditional, ?? or typeof are not", { timeout: 60_000 }, async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-cjs-import-meta-")));
  t.after(() => removeTemp(dir));
  const write = (name: string, lines: string[]) => writeFileSync(path.join(dir, name), lines.join("\n") + "\n");
  write("version.ts", [
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "export function sourceVersion(dir = path.dirname(fileURLToPath(import.meta.url))) { return dir; }",
  ]);
  write("hazards.ts", [
    'import { createRequire } from "node:module";',
    'export const asset = new URL("./x", import.meta.url);',
    "export const load = createRequire(import.meta.url);",
    'export const where = import.meta.resolve("y");',
  ]);
  write("guarded.ts", [
    'import { fileURLToPath } from "node:url";',
    'export const checked = import.meta.url === undefined ? "" : fileURLToPath(import.meta.url);',
    'export const fallback = fileURLToPath(import.meta.url ?? "file:///x");',
    "const u: unknown = import.meta.url;",
    'export const typed = typeof u === "string" ? fileURLToPath(u) : undefined;',
  ]);
  write("entry.ts", ['export * from "./version";', 'export * from "./hazards";', 'export * from "./guarded";']);

  const found = await importMetaHazards([{
    entryPoints: [path.join(dir, "entry.ts")], outfile: path.join(dir, "out", "entry.cjs"),
    absWorkingDir: dir, bundle: true, platform: "node", format: "cjs", target: "node22",
  }]);

  const places = found.map(({ file, line }) => `${file}:${line}`).sort();
  assert.deepEqual(places, [
    `${path.join(dir, "hazards.ts")}:2`,
    `${path.join(dir, "hazards.ts")}:3`,
    `${path.join(dir, "hazards.ts")}:4`,
    `${path.join(dir, "version.ts")}:3`,
  ]);
  const at = (name: string, line: number) => found.find((one) => one.file === path.join(dir, name) && one.line === line)!.text;
  assert.match(at("version.ts", 3), /import\.meta\.url/);
  assert.match(at("hazards.ts", 2), /import\.meta\.url/);
  assert.match(at("hazards.ts", 3), /import\.meta\.url/);
  assert.match(at("hazards.ts", 4), /import\.meta\.resolve/);
});
