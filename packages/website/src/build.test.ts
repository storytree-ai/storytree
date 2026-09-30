import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildWebsite } from "./build.js";

test("1.1 · a static build serves its home page and every local asset without an app server", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-build-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /<main\b/);
  assert.match(html, /id="website-forest"/);
  for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!asset || /^(?:https?:|mailto:)/.test(asset)) continue;
    assert.ok((await stat(path.join(output, asset === "/" ? "index.html" : asset.replace(/^\//, "")))).isFile(), asset);
  }
  assert.ok((await stat(path.join(output, "assets/forest.js"))).size > 0);
  assert.doesNotMatch(html, /<script[^>]*src="[^\"]*forest\.js"/);
});
