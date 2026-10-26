/**
 * The whole desktop page bundles (capability 3 · Surfaces): renderer.ts and every story surface it mounts build for the
 * browser as the app's build.mjs builds them. Test scoping reads a path into the renderer as reaching desktop's files
 * only (question_c6ecdd07b334), so a story change that breaks the page's bundle is caught here, in desktop.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { build } from "esbuild";

test("3.17 · the whole desktop page, every story's surface mounted in it, bundles for the browser as the app's build bundles it", { timeout: 120_000 }, async () => {
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, "renderer.ts")],
    absWorkingDir: path.resolve(import.meta.dirname, "../.."),
    bundle: true, write: false, outfile: "renderer.js", logLevel: "silent",
    platform: "browser", format: "iife", target: "es2023",
  });
  assert.deepEqual(result.errors, []);
  const [bundle] = result.outputFiles;
  assert.ok(bundle?.text.includes("data-surface-id"), "the bundle carries the page's mounted surfaces");
});
