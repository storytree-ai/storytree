import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildWebsite } from "./build.js";

test("2.3 · the initial page downloads less than 20 KiB of JavaScript before activating the forest", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-lazy-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const { outputs } = await buildWebsite(output);
  const initial = new Set<string>();
  function visit(name: string) {
    if (initial.has(name)) return;
    initial.add(name);
    for (const dependency of outputs[name]!.imports) {
      if (!dependency.external && dependency.kind !== "dynamic-import") visit(dependency.path);
    }
  }
  for (const [name, asset] of Object.entries(outputs)) {
    if (asset.entryPoint === "src/main.ts" || asset.entryPoint === "src/forest.ts") visit(name);
  }
  assert.ok(initial.size > 0);
  const bytes = [...initial].reduce((sum, name) => sum + outputs[name]!.bytes, 0);
  assert.ok(bytes < 20 * 1024, `Initial JavaScript was ${bytes} bytes; the renderer must wait for activation`);
});

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
  const forest = html.match(/src="(\/assets\/forest-[^"/]+\.js)"/)?.[1];
  assert.ok(forest, "The scene entry must have a content-versioned URL so a returning visitor cannot reuse an older entry");
  assert.ok((await stat(path.join(output, forest))).size > 0);
});

test("1.3 · the built home links to a separate waitlist with a no-JavaScript route and source links", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-home-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /href="\/waitlist.html"/);
  const waitlist = await readFile(path.join(output, "waitlist.html"), "utf8");
  assert.match(waitlist, /id="waitlist-form"/);
  assert.match(waitlist, /<noscript>[\s\S]*linkedin\.com[\s\S]*<\/noscript>/);
  assert.match(waitlist, /href="https:\/\/github.com\/storytree-ai\/storytree\/blob\/main\/LICENSE"/);
  assert.match(waitlist, /href="https:\/\/www.linkedin.com\/in\/mick-hua-353353a\/"/);
  assert.match(waitlist, /href="https:\/\/github.com\/storytree-ai\/storytree"/);
  assert.match(waitlist, /href="\/"/);
  for (const page of [html, waitlist, await readFile(path.join(output, "404.html"), "utf8")]) {
    for (const [, asset] of page.matchAll(/(?:src|href)="(\/assets\/[^"#]+)"/g)) {
      assert.match(asset!, /-[A-Z0-9]+\.(?:js|css)$/);
      assert.ok((await stat(path.join(output, asset!))).isFile(), asset);
    }
  }
});

test("1.4 · the static not-found page provides a route home", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-404-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "404.html"), "utf8");
  assert.match(html, /<a[^>]*href="\/"/);
  assert.ok((await stat(path.join(output, "index.html"))).isFile());
});

test("4.4 · the built site names the merge it was built from in its home page and /version.txt", async (t) => {
  const commit = "89127d67".padEnd(40, "0");
  const output = await mkdtemp(path.join(tmpdir(), "website-commit-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output, { commit });
  assert.match(await readFile(path.join(output, "index.html"), "utf8"), new RegExp(`<meta name="storytree-commit" content="${commit}">`));
  assert.equal(await readFile(path.join(output, "version.txt"), "utf8"), `${commit}\n`);

  await buildWebsite(output, { commit: undefined });
  assert.equal(await readFile(path.join(output, "version.txt"), "utf8"), "unpublished local build\n");
});

test("5.3 · the built storage manifest permits public insertion and explicitly reserves all other actions for the owner", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-data-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const manifest = JSON.parse(await readFile(path.join(output, ".herenow/data.json"), "utf8"));
  assert.deepEqual(manifest, { collections: { waitlist: {
    fields: {
      email: { type: "email", required: true, trim: true, maxLength: 254 },
      computer: { type: "string", trim: true, maxLength: 7 },
      agent: { type: "string", trim: true, maxLength: 11 },
    },
    access: { insert: "public", read: "owner", update: "owner", delete: "owner" },
    rateLimit: "10/hour/ip",
  } } });
});
