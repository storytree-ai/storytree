/**
 * The whole desktop page bundles (capability 3 · Surfaces): renderer.ts and every story surface it mounts build for the
 * browser as the app's build.mjs builds them. Test scoping reads a path into the renderer as reaching desktop's files
 * only (question_c6ecdd07b334), so a story change that breaks the page's bundle is caught here, in desktop.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { build } from "esbuild";

import { pageBuild } from "./page-build.js";

// One build serves both tests: the whole page takes a while to bundle.
const built = build({ ...pageBuild(path.join(import.meta.dirname, "out")), write: false, logLevel: "silent" });

test("3.17 · the whole desktop page, every story's surface mounted in it, bundles for the browser as the app's build bundles it", { timeout: 120_000 }, async () => {
  const result = await built;
  assert.deepEqual(result.errors, []);
  const [bundle] = result.outputFiles;
  assert.ok(bundle?.text.includes("data-surface-id"), "the bundle carries the page's mounted surfaces");
});

test("3.23 · the page the app's build makes runs React's production build", { timeout: 120_000 }, async () => {
  const [bundle] = (await built).outputFiles;
  // esbuild names each bundled module in a comment, so the build React's entry chose is named in the bundle.
  assert.ok(bundle?.text.includes("react-dom.production"), "the page carries React DOM's production build");
  assert.ok(!bundle.text.includes("react-dom.development"), "and not its development build");
});
