import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window as HappyWindow } from "happy-dom";

import { readIco, readPng } from "@storytree/mark";

import { buildWebsite } from "./build.js";
import { harness } from "./tour-copy.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

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
  // Chapter 1's words and its sound wait for the visitor's first act, so the intro can grow within the cap.
  const loadedFirst = [...initial].flatMap(name => Object.keys(outputs[name]!.inputs));
  for (const later of ["src/opening-copy.ts", "src/opening-audio.ts"]) assert.ok(!loadedFirst.includes(later), `${later} is in the initial download`);
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

test("1.10 · every page's tab shows the mark, in day colours on a light setting and night colours on a dark one, with fixed fallbacks", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-favicon-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  for (const page of ["index.html", "waitlist.html", "404.html"]) {
    const html = await readFile(path.join(output, page), "utf8");
    assert.match(html, /<link rel="icon" href="\/favicon.svg" type="image\/svg\+xml">/, page);
    assert.match(html, /<link rel="icon" href="\/favicon.ico" sizes="32x32">/, page);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/, page);
  }
  const svg = await readFile(path.join(output, "favicon.svg"), "utf8");
  const [light, dark] = svg.split("@media (prefers-color-scheme: dark)");
  const day = { canvas: "#F4EFE2", ocean: "#3E7CB1", land: "#8cb85e", tree: "#17301F", leaf: "#17301F" };
  const night = { canvas: "#0F1E2E", ocean: "#1F4E79", land: "#2F6B3A", tree: "#F4EFE2", leaf: "#F2C14E" };
  for (const [scheme, way] of [[light!, day], [dark!, night]] as const) {
    for (const role of ["canvas", "ocean", "land", "tree", "leaf"] as const) assert.match(scheme, new RegExp(`--mark-${role}: ${way[role]}`, "i"), role);
  }
  // The fixed files draw the day tile: the pixel at the top middle, above the globe, is day's canvas.
  const tileTop = ({ width, pixels }: { width: number; pixels: Uint8Array }) => [...pixels.subarray((width + width / 2) * 4, (width + width / 2) * 4 + 3)];
  const ico = readIco(await readFile(path.join(output, "favicon.ico"))).find(({ size }) => size === 32);
  assert.ok(ico, "favicon.ico carries a 32 pixel image");
  assert.deepEqual(tileTop(readPng(ico.png)), [0xf4, 0xef, 0xe2]);
  const touch = readPng(await readFile(path.join(output, "apple-touch-icon.png")));
  assert.deepEqual([touch.width, touch.height], [180, 180]);
  assert.deepEqual(tileTop(touch), [0xf4, 0xef, 0xe2]);
});

test("1.11 · the site wears the mark beside its name, drawn in the page's own colours", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-mark-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  // Where each page names itself: the home heading; the waitlist's header and footer; the not-found header.
  for (const [page, count] of [["index.html", 1], ["waitlist.html", 2], ["404.html", 1]] as const) {
    const html = await readFile(path.join(output, page), "utf8");
    const names = [...html.matchAll(/<(a class="wordmark"|h1 id="forest-title")[^>]*>([\s\S]*?)<\/(?:a|h1)>/g)];
    assert.equal(names.length, count, page);
    for (const [, , inner] of names) {
      assert.match(inner!, /^<svg class="mark" viewBox="0 0 104 104"[^>]*aria-hidden="true"/, page);
      for (const role of ["ocean", "land", "tree", "leaf"]) assert.match(inner!, new RegExp(`(?:fill|stroke)="var\\(--mark-${role}\\)"`), role);
      assert.doesNotMatch(inner!, /#[0-9a-f]{3,6}/i, "the inline mark carries no colour of its own");
    }
  }
  const stylesheet = (await readFile(path.join(output, "index.html"), "utf8")).match(/href="\/(assets\/styles-[^"]+\.css)"/)![1]!;
  const css = await readFile(path.join(output, stylesheet), "utf8");
  const root = css.match(/:root\{([^}]*)\}/)?.[1] ?? "";
  const declared = new Set([...root.matchAll(/(--[a-z-]+):/g)].map(([, name]) => name));
  for (const role of ["ocean", "land", "tree", "leaf"]) {
    const value = root.match(new RegExp(`--mark-${role}:\\s*var\\((--[a-z-]+)\\)`))?.[1];
    assert.ok(value && declared.has(value) && !value.startsWith("--mark-"), `--mark-${role} must be one of the site's own colours`);
  }
});

test("1.12 · the home and waitlist pages share as a 1200 x 630 picture of the mark and the name", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-share-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  for (const page of ["index.html", "waitlist.html"]) {
    const html = await readFile(path.join(output, page), "utf8");
    assert.match(html, /<meta property="og:image" content="https:\/\/storytree\.dev\/share\.png">/, page);
    assert.match(html, /<meta property="og:image:width" content="1200">/, page);
    assert.match(html, /<meta property="og:image:height" content="630">/, page);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, page);
  }
  const png = await readFile(path.join(output, "share.png"));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
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

test("1.13 · below the map the built home shows the three promises in order, each a single line, claim 1 carrying the first short served by the site", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-claims-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const page = new HappyWindow().document;
  page.write(html);
  const claims = [...page.querySelectorAll("section.claim")];
  assert.deepEqual(claims.map(claim => claim.querySelector("h3")?.textContent),
    ["Watch your software grow on a map.", "One map for you and your agents.", "Memory that lives where your code lives."], "one section per promise, in the owner's order, and no other");
  assert.ok(claims.every(claim => [...claim.querySelectorAll("p, h3")].length === 1), "each claim is its single line, with no pain line beside it");
  assert.ok(page.querySelector("#map-frame")!.compareDocumentPosition(claims[0]!) & 4, "the claims sit below the map");
  const videos = claims.map(claim => claim.querySelector("video"));
  assert.ok(videos[0] && videos.slice(1).every(video => !video), "only claim 1 carries a short");
  for (const attribute of ["muted", "playsinline", "controls"]) assert.ok(videos[0]!.hasAttribute(attribute), attribute);
  // What the site serves is the short and the poster as rendered.
  const rendered = path.join(packageRoot, "evidence", "first-short");
  for (const [name, file] of [["src", "seeing-what-agents-built-1080p.mp4"], ["poster", "seeing-what-agents-built-poster.png"]] as const) {
    const asset = videos[0]!.getAttribute(name);
    assert.match(asset ?? "", /^\//, name);
    assert.ok((await readFile(path.join(output, asset!))).equals(await readFile(path.join(rendered, file))), `${asset} is the rendered ${file}`);
  }
});

test("1.14 · after the claims the built home says it works with your harness, with its marks, and ends on the waitlist", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-harness-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const page = new HappyWindow().document;
  page.write(await readFile(path.join(output, "index.html"), "utf8"));
  const section = page.querySelector("#harness")!;
  assert.ok(page.querySelector("#claims")!.compareDocumentPosition(section) & 4, "the harness sits below the claims");
  assert.ok(section.textContent!.includes(harness.claim) && section.textContent!.includes(harness.marksNote), "the owner's line, then any harness that speaks MCP");
  const marks = [...section.querySelectorAll("img")];
  assert.deepEqual(marks.map(mark => mark.getAttribute("alt")), harness.marks.map(({ name }) => name), "one mark per harness storytree watches");
  for (const mark of marks) {
    const src = mark.getAttribute("src")!;
    assert.ok((await readFile(path.join(output, src))).equals(await readFile(path.join(packageRoot, "public", src))), `${src} is the maker's mark as published`);
  }
  const sections = [...page.querySelectorAll("main > section")];
  const last = sections.at(-1)!;
  assert.ok(sections.indexOf(section) === sections.length - 2, "nothing comes between the harness and the end of the page");
  assert.ok(last.querySelector('a[href="/waitlist.html"]'), "the page ends on the waitlist");
  assert.equal(page.querySelectorAll('main a[href="/waitlist.html"]').length, 1, "the waitlist is offered once, at the bottom");
});
