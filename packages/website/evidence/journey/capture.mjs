// The whole journey as a visitor meets it (ADR-0879 D1), from the locally built site, at 1440×900 and 390×844: chapter 1's
// finale and turn, then every step of Act 2's tour by its id, then free play on the whole shop and on storytree's own project.
// A step is found by its id (its pip's data-step), never its wording; the run fails when the tour's steps are not the ones
// below, so a reshaped tour shows up as a red run rather than stale pictures.
// pnpm --filter @storytree/website build && node packages/website/evidence/journey/capture.mjs [--only <name>] [--check]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
// --check asserts without rewriting the committed pictures: they go to a fresh temporary folder instead (named at the end).
const pictures = process.argv.includes("--check") ? await mkdtemp(path.join(tmpdir(), "journey-check-")) : here;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
// Today's tour, in order (src/tour-copy.ts).
const steps = ["pain", "grow", "value", "fixes", "map-empty", "map-harness", "map-arcs", "map-stories", "map-capabilities", "map-claims",
  "map-health", "knowledge-inside", "knowledge-shelf", "knowledge-reads", "everything"];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const errors = [], written = [];

/** Opens the page, as a returning visitor with the live globe drawn unless it is the first visit. */
async function open(viewport, firstVisit = false) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(error.message));
  if (!firstVisit) await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  if (!firstVisit) await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  return page;
}
const shot = async (page, tag, name) => { const file = `${tag}-${name}.png`; await page.screenshot({ path: path.join(pictures, file) }); written.push(file); };
const stepOf = page => page.locator("#chapter2").getAttribute("data-tour-step");
const label = page => page.locator("#tour-play").getAttribute("aria-label");

const runs = {
  async handoff(page, tag) {
    // A first-time visitor: chapter 1 to its finale, then the turn into Act 2.
    await page.locator("#opening-run").click();
    await page.locator("#opening-better").waitFor({ state: "visible", timeout: 90_000 });
    await shot(page, tag, "0a-finale");
    await page.locator("#opening-better").click();
    await page.waitForTimeout(1000); await shot(page, tag, "0b-turn");
  },
  async tour(page, tag) {
    const ids = await page.locator("#tour-pips [data-step]").evaluateAll(pips => pips.map(pip => pip.dataset.step));
    assert.deepEqual(ids, steps, "the tour's steps are the ones this record walks: re-record the journey when they change");
    // Faster than the tour's 0.75×; each step is pictured as it settles, near the end of its time, paused.
    if (Number(tag) > 600) await page.locator('#tour-bar [data-speed="1.5"]').click(); else for (let tap = 0; tap < 2; tap++) await page.locator("#tour-speed-cycle").click();
    for (const [index, id] of steps.entries()) {
      if (await label(page) === "Play the tour") await page.locator("#tour-play").click();
      await page.locator(`#tour-pips [data-step="${id}"]`).click();
      assert.equal(await stepOf(page), id);
      // Paused from inside the page on the frame the step reaches its end, so a short step cannot run on into the next.
      const held = await page.evaluate(id => new Promise(resolve => {
        const tick = () => {
          const step = document.querySelector("#chapter2").dataset.tourStep;
          if (step !== id) return resolve(step);
          if (Number(document.querySelector('#tour-pips [aria-current="step"]')?.style.getPropertyValue("--fill")) >= .88) { document.querySelector("#tour-play").click(); return resolve(step); }
          requestAnimationFrame(tick);
        };
        tick();
      }), id);
      assert.equal(held, id, `${tag}: the tour was paused on ${id}`);
      assert.equal(await label(page), "Play the tour");
      await page.waitForTimeout(700);
      assert.equal(await stepOf(page), id);
      await shot(page, tag, `${String(index + 1).padStart(2, "0")}-${id}`);
    }
  },
  async freeplay(page, tag) {
    await page.locator("#tour-skip").click();
    await page.waitForFunction(() => document.querySelector("#chapter2")?.dataset.tourMode === "freeplay");
    await page.waitForTimeout(2500); await shot(page, tag, "16-freeplay-shop");
    // With software WebGL storytree's globe draws its names some seconds after the switch: wait for them.
    await page.locator('#tour-project [data-project="storytree"]').click();
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "storytree"
      && [...document.querySelectorAll(".planet-nameplate")].filter(plate => Number(getComputedStyle(plate).opacity) > .5).length >= 5, null, { timeout: 90_000 });
    // Its health colours follow the names.
    await page.waitForTimeout(6000); await shot(page, tag, "17-freeplay-storytree");
  },
};
try {
  for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
    for (const [name, run] of Object.entries(runs)) {
      if (only && only !== name) continue;
      const page = await open(viewport, name === "handoff");
      try { await run(page, tag); console.log("captured", tag, name); } finally { await page.close(); }
    }
  }
  assert.deepEqual(errors, [], "the browser reports no errors");
  // A picture this record no longer takes is stale: it goes.
  if (!only && pictures === here) for (const name of await readdir(here)) if (name.endsWith(".png") && !written.includes(name)) await rm(path.join(here, name));
  if (pictures !== here) console.log(`--check: ${written.length} pictures in ${pictures}, nothing committed was written`);
} finally { await browser.close(); server.close(); }
