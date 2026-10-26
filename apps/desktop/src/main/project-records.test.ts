/** Capability 1 · Lifecycle: the records the stories keep for a project outside its library, which the setup help's Delete forgets with it. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { partsPlugin } from "@storytree/plugin-loader";
import { projectRecords } from "@storytree/quality-assurance/project-records";
import { removeTemp } from "@storytree/test-waits";

import unbundled from "./parts/project-records.js";

test("1.37 the desktop app composes the project records its story packages' manifests name, the QA ledger's, into its bundle by the plugin loader, and the same run unbundled, for Delete to forget with a project", async (t) => {
  const desktop = fileURLToPath(new URL("../..", import.meta.url));
  const out = mkdtempSync(path.join(tmpdir(), "storytree-desktop-records-"));
  t.after(() => removeTemp(out));
  const outfile = path.join(out, "project-records.mjs");
  await build({ stdin: { contents: `export { default } from "#parts/projectRecords";`, resolveDir: desktop }, outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", plugins: [partsPlugin()], external: ["pg", "pg-native", "@babel/parser"] });
  const { default: bundled } = await import(pathToFileURL(outfile).href) as { default: { parts: readonly { name: string }[]; owners: readonly string[] } };
  assert.deepEqual(bundled.parts.map((records) => records.name), projectRecords.map((records) => records.name));
  assert.deepEqual(bundled.owners, ["quality-assurance"]);
  assert.equal(import.meta.resolve("#parts/projectRecords"), new URL("./parts/project-records.ts", import.meta.url).href, "the app's #parts/projectRecords is its composing module");
  assert.deepEqual(unbundled.parts, projectRecords);
});
