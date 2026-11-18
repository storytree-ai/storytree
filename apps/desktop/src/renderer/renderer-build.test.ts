// Capability 3 · Surfaces
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { build } from "esbuild";

import { pageBuild } from "./page-build.js";

const built = build({ ...pageBuild(path.join(import.meta.dirname, "out")), write: false, logLevel: "silent" });

test("3.17 · the whole desktop page, every story's surface mounted in it, bundles for the browser as the app's build bundles it", { timeout: 120_000 }, async () => {
  const result = await built;
  assert.deepEqual(result.errors, []);
  const [bundle] = result.outputFiles;
  assert.ok(bundle?.text.includes("data-surface-id"), "the bundle carries the page's mounted surfaces");
});

test("3.23 · the page the app's build makes runs React's production build", { timeout: 120_000 }, async () => {
  const [bundle] = (await built).outputFiles;
  assert.ok(bundle?.text.includes("react-dom.production"), "the page carries React DOM's production build");
  assert.ok(!bundle?.text.includes("react-dom.development"), "and not its development build");
});
