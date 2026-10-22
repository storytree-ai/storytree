// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/panel-clear/capture.mjs [--before]
// The framed map with The website's story panel open, in a real browser with a drawn map: the compass, the zoom buttons and
// "Done exploring" stay off the panel, and its close button is the element at its own centre. Desktop (a mouse, the map in
// hand), a touch laptop and a phone, each in hand and, on touch, after Done exploring. With --before it records the boxes
// without asserting, into before/; otherwise into after/.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const before = process.argv.includes("--before");
const output = path.join(here, before ? "before" : "after");
await mkdir(output, { recursive: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const seen = {};

/** The panel's box, each control's box and whether it overlaps the panel, and what sits at the close button's centre. */
const measure = page => page.evaluate(() => {
  const box = node => { if (!node) return null; const r = node.getBoundingClientRect(); return r.width && r.height ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };
  const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const frame = document.querySelector("#map-frame"), panel = box(frame.querySelector(".story-panel"));
  const controls = Object.fromEntries([["compass", ".sheet-compass"], ["zoom", ".map-zoom"], ["exit", ".map-exit"]].map(([name, selector]) => {
    const shown = box(frame.querySelector(selector));
    return [name, { box: shown, overlapsPanel: Boolean(overlaps(shown, panel)) }];
  }));
  const close = frame.querySelector(".panel-close"), at = box(close);
  const top = at && document.elementFromPoint(at.x + at.w / 2, at.y + at.h / 2);
  return { panel, controls, closeOnTop: Boolean(top && close.contains(top)) };
});

async function shoot(name, options, { tap = false, leave = false } = {}) {
  const page = await browser.newPage(options);
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("#website-forest .planet-nameplate[data-story-id]").length > 0, null, { timeout: 60_000 });
  await page.locator("#map-frame").scrollIntoViewIfNeeded();
  if (tap) await page.locator("[data-map-tap]").click();
  await page.locator(".map-browse-toggle").click();
  await page.locator("#map-story-choice").selectOption("story_769e230c466d");
  await page.waitForSelector("#map-frame .story-panel .panel-close");
  await page.waitForTimeout(2500);
  if (leave) { await page.locator("[data-map-exit]").click(); await page.waitForTimeout(600); }
  seen[name] = { viewport: options.viewport, hand: await page.locator("#map-frame").getAttribute("data-hand"), ...(await measure(page)) };
  await page.locator("#map-frame").screenshot({ path: path.join(output, `${name}.png`) });
  await page.close();
  if (!before) {
    for (const [control, { overlapsPanel }] of Object.entries(seen[name].controls)) assert.ok(!overlapsPanel, `${name}: ${control} stays off the panel`);
    // Out of hand, the tap layer covers the still map and its panel by design (ADR-1091 D2): a tap takes the map in hand again.
    if (seen[name].hand === "map") assert.ok(seen[name].closeOnTop, `${name}: the panel's close button is the element at its own centre`);
  }
}

try {
  await shoot("desktop", { viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  await shoot("touch-laptop-in-hand", { viewport: { width: 1600, height: 1000 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" }, { tap: true });
  await shoot("phone-in-hand", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: "reduce" }, { tap: true });
  await shoot("phone-after-done", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: "reduce" }, { tap: true, leave: true });
  assert.ok(before || seen["phone-in-hand"].controls.exit.box, "on a phone in hand, Done exploring is on screen with the panel open");
} finally {
  await writeFile(path.join(output, "observations.json"), `${JSON.stringify(seen, null, 1)}\n`);
  await browser.close();
  server.close();
}
console.log(JSON.stringify(seen, null, 1));
