import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { Window as HappyWindow } from "happy-dom";

import { readIco, readPng } from "@storytree/mark";

import { buildFromEnvironment, buildWebsite } from "./build.js";
import { harness } from "./tour-copy.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

test("2.3 · the initial page downloads less than 20 KiB of JavaScript before activating the forest", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-lazy-"));
  t.after(() => removeTemp(output));
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
  t.after(() => removeTemp(output));
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

test("1.3 · with JavaScript off, the home page, live and preview, reads and links to the repository and its license", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-home-"));
  t.after(() => removeTemp(output));
  for (const preview of [false, true]) {
    await buildWebsite(output, { preview });
    const html = await readFile(path.join(output, "index.html"), "utf8");
    assert.match(html, /href="https:\/\/github.com\/storytree-ai\/storytree\/blob\/main\/LICENSE"/);
    assert.match(html, /href="https:\/\/github.com\/storytree-ai\/storytree"/);
    for (const page of [html, await readFile(path.join(output, "404.html"), "utf8")]) {
      for (const [, asset] of page.matchAll(/(?:src|href)="(\/assets\/[^"#]+)"/g)) {
        assert.match(asset!, /-[A-Z0-9]+\.(?:js|css)$/);
        assert.ok((await stat(path.join(output, asset!))).isFile(), asset);
      }
    }
  }
});

test("1.4 · the static not-found page provides a route home", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-404-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "404.html"), "utf8");
  assert.match(html, /<a[^>]*href="\/"/);
  assert.ok((await stat(path.join(output, "index.html"))).isFile());
});

test("1.16 · the built home links to the source on GitHub, and the site serves a security.txt naming the private report route", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-official-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /<a[^>]*href="https:\/\/github\.com\/storytree-ai\/storytree"/);
  const security = await readFile(path.join(output, ".well-known", "security.txt"), "utf8");
  const field = (name: string) => security.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
  assert.equal(field("Contact"), "https://github.com/storytree-ai/storytree/security/advisories/new");
  assert.ok(!Number.isNaN(Date.parse(field("Expires") ?? "")), "Expires is a date");
  assert.equal(field("Canonical"), "https://storytree.dev/.well-known/security.txt");
});

test("1.10 · every page's tab shows the mark, in day colours on a light setting and night colours on a dark one, with fixed fallbacks", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-favicon-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  for (const page of ["index.html", "404.html"]) {
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
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  // Where each page names itself: the home heading; the not-found header.
  for (const [page, count] of [["index.html", 1], ["404.html", 1]] as const) {
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

test("1.12 · the home page shares as a 1200 x 630 picture of the mark and the name", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-share-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /<meta property="og:image" content="https:\/\/storytree\.dev\/share\.png">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const png = await readFile(path.join(output, "share.png"));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
});

test("4.4 · the built site names the merge it was built from in its home page and /version.txt", async (t) => {
  const commit = "89127d67".padEnd(40, "0");
  const output = await mkdtemp(path.join(tmpdir(), "website-commit-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output, { commit });
  assert.match(await readFile(path.join(output, "index.html"), "utf8"), new RegExp(`<meta name="storytree-commit" content="${commit}">`));
  assert.equal(await readFile(path.join(output, "version.txt"), "utf8"), `${commit}\n`);

  await buildWebsite(output, { commit: undefined });
  assert.equal(await readFile(path.join(output, "version.txt"), "utf8"), "unpublished local build\n");
});

test("4.6 · the published site holds the live build at its root and the preview build under /staging/, not indexed, its links and assets staying inside /staging/", async (t) => {
  const [output, alone] = await Promise.all([mkdtemp(path.join(tmpdir(), "website-site-")), mkdtemp(path.join(tmpdir(), "website-alone-"))]);
  t.after(() => Promise.all([removeTemp(output), removeTemp(alone)]));
  // CI's build step, as its workflow runs it.
  await buildFromEnvironment(output, { ...process.env, WEBSITE_SITE: "1" });
  await buildWebsite(alone);
  const files = (await readdir(output, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => path.relative(output, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

  assert.match(await readFile(path.join(output, "robots.txt"), "utf8"), /^User-agent: \*\nDisallow: \/staging\/$/m);
  // The root is a live build on its own, naming nothing under /staging/.
  for (const name of files.filter(name => !name.startsWith("staging/") && name !== "robots.txt")) {
    const bytes = await readFile(path.join(output, name));
    assert.deepEqual(bytes, await readFile(path.join(alone, name)), name);
    assert.ok(!bytes.includes("/staging"), name);
  }
  assert.deepEqual(files.filter(name => !name.startsWith("staging/") && name !== "robots.txt").sort(),
    (await readdir(alone, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(alone, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")).sort());
  // Site configuration is served once, from the root.
  assert.ok(!files.some(name => /^staging\/\.(?:herenow|well-known)\//.test(name)));

  const pages = files.filter(name => name.startsWith("staging/") && name.endsWith(".html"));
  assert.deepEqual(pages.sort(), ["staging/404.html", "staging/index.html"]);
  const home = await readFile(path.join(output, "staging/index.html"), "utf8");
  assert.match(home, /<video src="\/staging\/shorts\/[^"]+\.mp4"/, "the preview build shows the claims with their shorts");
  for (const page of pages) {
    const html = await readFile(path.join(output, page), "utf8");
    assert.equal([...html.matchAll(/<meta name="robots"[^>]*>/g)].map(([tag]) => tag).join(), '<meta name="robots" content="noindex, nofollow">', page);
    for (const [, , url] of html.matchAll(/\s(href|src|srcset|poster|content)="([^"]*)"/g)) {
      if (url!.startsWith("/")) {
        assert.ok(url!.startsWith("/staging/"), `${page}: ${url}`);
        const file = url === "/staging/" ? "staging/index.html" : url!.slice(1);
        assert.ok(files.includes(file), `${page}: ${url}`);
      } else if (url!.startsWith("https://storytree.dev")) assert.ok(url!.startsWith("https://storytree.dev/staging/"), `${page}: ${url}`);
    }
  }
});

test("1.13 · the live home shows no claims and serves none of their shorts; below the map the preview build shows the three promises in order, each a single line, each carrying its own short served by the site", async (t) => {
  const live = await mkdtemp(path.join(tmpdir(), "website-live-"));
  t.after(() => removeTemp(live));
  await buildWebsite(live);
  const livePage = new HappyWindow().document;
  livePage.write(await readFile(path.join(live, "index.html"), "utf8"));
  assert.equal(livePage.querySelectorAll("#claims, section.claim, video").length, 0, "the live home carries no claims and no videos");
  await assert.rejects(stat(path.join(live, "shorts")), "the live site serves no shorts");

  const output = await mkdtemp(path.join(tmpdir(), "website-claims-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output, { preview: true });
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const page = new HappyWindow().document;
  page.write(html);
  const claims = [...page.querySelectorAll("section.claim")];
  assert.deepEqual(claims.map(claim => claim.querySelector("h3")?.textContent),
    ["Watch your software grow on a map.", "One map for you and your agents.", "Memory that lives where your code lives."], "one section per promise, in the owner's order, and no other");
  assert.ok(claims.every(claim => [...claim.querySelectorAll("p, h3")].length === 1), "each claim is its single line, with no pain line beside it");
  assert.ok(page.querySelector("#map-frame")!.compareDocumentPosition(claims[0]!) & 4, "the claims sit below the map");
  const videos = claims.map(claim => claim.querySelector("video"));
  assert.deepEqual(videos.map(video => video !== null), [true, true, true], "every claim carries a short");
  // What the site serves for each is its short and poster as rendered.
  const rendered = [["first-short", "seeing-what-agents-built"], ["one-map", "one-map-for-you-and-your-agents"],
    ["memory", "memory-that-lives-where-your-code-lives"]] as const;
  for (const [index, [folder, name]] of rendered.entries()) {
    const video = videos[index]!;
    for (const attribute of ["muted", "playsinline", "controls"]) assert.ok(video.hasAttribute(attribute), `${name}: ${attribute}`);
    assert.ok(video.getAttribute("aria-label"), `${name} says what it shows`);
    for (const [attribute, file] of [["src", `${name}-1080p.mp4`], ["poster", `${name}-poster.png`]] as const) {
      const asset = video.getAttribute(attribute);
      assert.match(asset ?? "", /^\//, attribute);
      assert.ok((await readFile(path.join(output, asset!))).equals(await readFile(path.join(packageRoot, "shorts", folder, file))), `${asset} is the rendered ${file}`);
    }
  }
  assert.equal(new Set(videos.map(video => video!.getAttribute("src"))).size, videos.length, "each claim has its own short");
});

test("1.14 · below the map the home, live and preview, says it works with your harness, with its marks, and ends on following the build on GitHub, saying it is early alpha", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-harness-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const page = new HappyWindow().document;
  page.write(await readFile(path.join(output, "index.html"), "utf8"));
  const section = page.querySelector("#harness")!;
  assert.ok(page.querySelector("#map-frame")!.compareDocumentPosition(section) & 4, "the harness sits below the map");
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
  assert.ok(last.querySelector('a[href="https://github.com/storytree-ai/storytree"]'), "the page ends on following the build on GitHub");
  assert.match(last.textContent!, /early alpha/i, "and says plainly it is early alpha");

  const preview = await mkdtemp(path.join(tmpdir(), "website-harness-preview-"));
  t.after(() => removeTemp(preview));
  await buildWebsite(preview, { preview: true });
  const previewPage = new HappyWindow().document;
  previewPage.write(await readFile(path.join(preview, "index.html"), "utf8"));
  assert.ok(previewPage.querySelector("#claims")!.compareDocumentPosition(previewPage.querySelector("#harness")!) & 4, "in the preview the harness sits below the claims");
  assert.ok([...previewPage.querySelectorAll("main > section")].at(-1)!.querySelector('a[href="https://github.com/storytree-ai/storytree"]'), "the preview ends on following the build on GitHub too");
});

/** The declarations the built stylesheet gives `selector` at a viewport `width`: its own rules plus any min/max-width @media that holds there. */
function declarationsAt(css: string, selector: string, width: number) {
  const found = new Map<string, string>();
  const read = (block: string) => {
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors!.split(",").map(s => s.trim()).includes(selector)) continue;
      for (const declaration of body!.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
    }
  };
  // In source order, so a later rule wins as in the cascade.
  const blocks: string[] = [];
  let depth = 0, start = 0, media: string | null = null;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0 && css.slice(start, i).trim().startsWith("@media")) { media = css.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0 && media !== null) {
        const widths = [...media.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
        const onlyWidths = media.replace(/^@media\s*/, "").replace(/\((min|max)-width:\s*\d+px\)|\band\b/g, "").trim() === "";
        if (onlyWidths && widths.every(([, side, px]) => side === "min" ? width >= Number(px) : width <= Number(px))) blocks.push(css.slice(start, i));
        media = null; start = i + 1;
      } else if (depth === 0) { blocks.push(css.slice(start, i + 1)); start = i + 1; }
    }
  }
  blocks.forEach(read);
  return found;
}

test("1.15 · at desktop width the hook line and its paragraph sit left of the framed map, level with it; at phone width they stack with no sideways scroll", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-hero-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const page = new HappyWindow().document;
  page.write(await readFile(path.join(output, "index.html"), "utf8"));
  const css = await readFile(path.join(output, page.querySelector('link[rel="stylesheet"]')!.getAttribute("href")!), "utf8");

  // 1440 x 900: a grid whose areas put the lead and the paragraph in a column left of the frame, in rows the frame spans.
  const section = declarationsAt(css, "#chapter2", 1440);
  assert.equal(section.get("display"), "grid", "at desktop width the hero is laid out as a grid");
  const rows = [...(section.get("grid-template-areas") ?? "").matchAll(/"([^"]*)"/g)].map(([, row]) => row!.trim().split(/\s+/));
  const cells = (area: string) => rows.flatMap((row, y) => row.flatMap((name, x) => name === area ? [{ x, y }] : []));
  const area = (name: string) => declarationsAt(css, `#chapter2 .${name}`, 1440).get("grid-area");
  const [lead, after, frame] = [cells(area("map-lead") ?? ""), cells(area("map-after") ?? ""), cells(area("map-frame") ?? "")];
  assert.ok(lead.length && after.length && frame.length, `the lead, the paragraph and the frame each have an area (${JSON.stringify(rows)})`);
  const frameLeft = Math.min(...frame.map(cell => cell.x));
  assert.ok([...lead, ...after].every(cell => cell.x < frameLeft), "the hook line and its paragraph sit left of the map");
  assert.ok([...lead, ...after].every(cell => frame.some(spot => spot.y === cell.y)), "beside it, level with the frame");
  const tracks = (section.get("grid-template-columns") ?? "").match(/minmax\([^)]*\)|\S+/g) ?? [];
  assert.match(tracks[frameLeft] ?? "", /1fr/, "the map's column takes the rest of the width");

  // 390 x 844: no grid or row, so the lead, the frame and the paragraph stack in the page's order, and nothing is wider than the screen.
  assert.ok(!/grid|flex/.test(declarationsAt(css, "#chapter2", 390).get("display") ?? "block"), "at phone width the hero stacks");
  const [leadLine, frameBox, afterLine] = [page.querySelector(".map-lead")!, page.querySelector("#map-frame")!, page.querySelector(".map-after")!];
  assert.ok(leadLine.compareDocumentPosition(frameBox) & 4 && frameBox.compareDocumentPosition(afterLine) & 4, "the hook line above the map and its paragraph below");
  const childWidth = declarationsAt(css, "#chapter2>*", 390).get("width") ?? "";
  assert.match(childWidth, /^min\(.*100%\)$/, `each part of the hero is capped at the screen's width (${childWidth})`);
  for (const selector of ["#chapter2", "#chapter2 .map-lead", "#chapter2 .map-after", ".map-frame"]) {
    for (const property of ["width", "min-width"]) {
      const fixed = /^(\d+)px$/.exec(declarationsAt(css, selector, 390).get(property) ?? "");
      assert.ok(!fixed || Number(fixed[1]) <= 390, `${selector} ${property}:${fixed?.[0]} fits the phone`);
    }
  }
});

test("2.33 · the framed map's panels draw on the forest's own dark palette: the frame they open in wears it, and the built stylesheet defines it", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-panels-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const page = new HappyWindow().document;
  page.write(await readFile(path.join(output, "index.html"), "utf8"));
  const css = await readFile(path.join(output, page.querySelector('link[rel="stylesheet"]')!.getAttribute("href")!), "utf8");
  // Every panel (a story's drill-down, a note's card, the tree space, the sessions list) opens inside #map-frame (forest-scene.tsx).
  const frame = page.querySelector("#map-frame")!;
  const dark = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) => selectors!.split(",").some(s => /^\.forest-workspace\[data-theme=("?)dark\1\]$/.test(s.trim())));
  assert.ok(dark, "the built stylesheet carries the forest's dark palette");
  assert.ok(frame.matches(dark[1]!.trim()), "the frame the panels open in wears the dark palette");
  for (const token of ["--bg", "--surface", "--text", "--muted", "--line", "--none-bg", "--none-text", "--pass-bg", "--fail-bg"]) {
    assert.match(dark[2]!, new RegExp(`${token}:\\s*#`), `the palette gives the panels ${token}`);
  }
  assert.match(declarationsAt(css, ".forest-workspace", 1440).get("--st-healthy") ?? "", /^#/, "and the cards' status colours apply there");
});

test("2.34 · with a story or note panel open in the framed map, the compass, the zoom buttons and Done exploring stay off it, at desktop and phone width", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-panel-clear-"));
  t.after(() => removeTemp(output));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const sheet = /<link rel="stylesheet" href="([^"]+)"[^>]*>/.exec(html)!;
  const css = await readFile(path.join(output, sheet[1]!), "utf8");
  // The live map on a touch screen, in hand: the forest has drawn its compass, and the frame shows zoom and Done exploring.
  // happy-dom keeps a computed style across a change that only a :has() would notice, so each state is a fresh page.
  const framed = (width: number, height: number, panel: boolean) => {
    const view = new HappyWindow({ width, height, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
    const page = view.document;
    page.write(html.replace(sheet[0], `<style>${css}</style>`));
    const element = (selector: string) => page.querySelector(selector) as unknown as HTMLElement;
    const frame = element("#map-frame"), forest = element("#website-forest");
    forest.dataset.forestState = "live";
    forest.insertAdjacentHTML("beforeend", `<button type="button" class="planet-mini-globe sheet-compass"></button>`);
    frame.dataset.hand = "map";
    element(".map-exit").hidden = false;
    // A panel opens the way the forest-scene portals it, as the frame's own child.
    if (panel) frame.insertAdjacentHTML("beforeend", `<div class="story-panel map-story-panel"><button class="panel-close">×</button></div>`);
    return (selector: string) => view.getComputedStyle(page.querySelector(selector)!);
  };
  for (const [width, height] of [[1600, 1000], [390, 844]] as const) {
    const closed = framed(width, height, false), open = framed(width, height, true);
    for (const control of [".sheet-compass", ".map-zoom"]) {
      assert.notEqual(closed(control).display, "none", `at ${width}px the map shows ${control} while no panel is open`);
      assert.equal(open(control).display, "none", `at ${width}px ${control} steps off the open panel`);
    }
    // Done exploring keeps a row of its own under the panel, so the two never share the frame's height.
    const [panel, button] = [open(".story-panel"), open(".map-exit")];
    assert.notEqual(button.display, "none", `at ${width}px Done exploring stays reachable`);
    const exitTop = parseFloat(button.bottom) + parseFloat(button.minHeight);
    assert.ok(parseFloat(panel.bottom) >= exitTop + 8, `at ${width}px the panel ends (bottom ${panel.bottom}) above Done exploring (its top at ${exitTop}px from the frame's foot)`);
  }
});
