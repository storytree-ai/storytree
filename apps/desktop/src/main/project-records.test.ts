/** Capability 1 · Lifecycle: the records the stories keep for a project outside its library, which the setup help's Delete forgets with it. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { removeTemp } from "@storytree/test-waits";

import unbundled from "./parts/project-records.js";
import { windowProjectRecords } from "./stand-ins.js";
import { partsFromList } from "./parts-list.js";

test("1.37 the desktop app composes the project records its story packages' manifests name into its bundle by the plugin loader, and the same run unbundled, and hands Delete those and each factory plugin's mounted in a part's place, as code review's QA ledger is now, but not one whose part is on", async (t) => {
  const desktop = fileURLToPath(new URL("../..", import.meta.url));
  const out = mkdtempSync(path.join(tmpdir(), "storytree-desktop-records-"));
  t.after(() => removeTemp(out));
  const outfile = path.join(out, "project-records.mjs");
  await build({ stdin: { contents: `export { default } from "#parts/projectRecords";`, resolveDir: desktop }, outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", plugins: [partsFromList()], external: ["pg", "pg-native", "@babel/parser"] });
  const { default: bundled } = await import(pathToFileURL(outfile).href) as { default: typeof unbundled };
  assert.deepEqual(bundled.parts.map((records) => records.name), unbundled.parts.map((records) => records.name));
  assert.deepEqual(bundled.owners, unbundled.owners);
  assert.equal(import.meta.resolve("#parts/projectRecords"), new URL("./parts/project-records.ts", import.meta.url).href, "the app's #parts/projectRecords is its composing module");

  // A factory plugin that keeps records of its own outside the library, added as a part of its own.
  const factory = path.join(out, "factory");
  const plugin = path.join(factory, "plugins", "my-review");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-review", type: "module", exports: { "./records": "./records.js" }, storytree: { interface: 1, projectRecords: [{ from: "./records", export: "projectRecords" }] } }));
  writeFileSync(path.join(plugin, "records.js"), "export const projectRecords = [{ name: \"my review rows\", forget: async () => {} }];\n");
  const named = { folder: factory, plugins: { "my-review": "my-review" } };
  const handed = (standIns: typeof named | { plugins: Record<string, string> }, off: readonly string[]) => windowProjectRecords(bundled, standIns, off).map((records) => records.name);
  assert.deepEqual(handed(named, ["my-review"]), [...unbundled.parts.map((records) => records.name), "my review rows"], "the plugin's records are handed to Delete beside the base's");
  assert.deepEqual(handed({ plugins: {} }, []), unbundled.parts.map((records) => records.name), "a plugin not named hands none");
  assert.deepEqual(handed(named, []), unbundled.parts.map((records) => records.name), "nor one named for a part that is not off");
});
