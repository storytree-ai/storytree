// Act 2's arrival (ADR-0889, contracts 2.11 and 2.12), from the locally built site: the pain on a dark screen,
// storytree's own recorded growth replayed on the tour's clock, the value statement alone, the three fixes in each
// look, and the cut to the shop's three teaching islands.
// pnpm --filter @storytree/website build && node packages/website/evidence/arrival/capture.mjs [--only <name>]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const observed = [];
const errors = [];

async function open(viewport, { firstVisit = false, reducedMotion = "no-preference", video = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion, ...(video ? { recordVideo: { dir: here, size: viewport } } : {}) });
  page.on("pageerror", error => errors.push(error.message));
  if (!firstVisit) await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  if (!firstVisit) await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  return page;
}
const stepOf = page => page.locator("#chapter2").getAttribute("data-tour-step");
const drawing = page => page.locator(".forest-drawing").evaluate(node => ({ globe: node.dataset.globe, growth: node.dataset.growth }));
/** Frames drawn per second over `ms`, counted by the page's own animation frames. */
const fps = (page, ms) => page.evaluate(ms => new Promise(resolve => { let n = 0; const start = performance.now(); const tick = now => { n++; if (now - start < ms) requestAnimationFrame(tick); else resolve(n * 1000 / (now - start)); }; requestAnimationFrame(tick); }), ms);
const go = async (page, id) => { await page.locator(`#tour-pips [data-step="${id}"]`).click(); assert.equal(await stepOf(page), id); };
const shot = (page, name) => page.screenshot({ path: path.join(here, `${name}.png`) });
const pause = async page => { if (await page.locator("#tour-play").getAttribute("aria-label") === "Pause the tour") await page.locator("#tour-play").click(); };
const play = async page => { if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click(); };

const runs = {
  // 2.11 with the live globe: the pain before any globe, the growth on the tour's clock, then whole.
  async arrival() {
    for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const page = await open(viewport);
      assert.equal(await stepOf(page), "pain", "Act 2 opens on the pain");
      assert.deepEqual(await drawing(page), { globe: "own", growth: "0.00" }, "under the pain storytree's own globe is still its point");
      assert.equal(await page.locator(".tour-heading h1").evaluate(node => getComputedStyle(node).opacity), "0", "nor is storytree named yet");
      await page.waitForTimeout(9000); await shot(page, `${tag}-1-pain`);
      await go(page, "grow");
      const moments = [];
      const sample = async (index, wait) => {
        await page.waitForTimeout(wait);
        // A slow machine can finish the time-lapse before the last sample: whole is its end.
        const { growth } = await drawing(page);
        moments.push(growth === "whole" ? Infinity : Number(growth));
        if (tag === "1440" || index % 2 === 1) await shot(page, `${tag}-2-grow-${index}`);
      };
      await sample(0, 0);
      const rate = await fps(page, 2500);
      observed.push(`${tag}: ${rate.toFixed(1)} fps over 2.5 s of the time-lapse`);
      for (const [index, wait] of [[1, 0], [2, 2800]]) await sample(index, wait);
      // The pause lands on the next frame: read the held moment once it has.
      await pause(page); await page.waitForTimeout(300); const held = (await drawing(page)).growth;
      await page.waitForTimeout(2500);
      assert.equal((await drawing(page)).growth, held, "pausing the tour holds the growth");
      await play(page);
      for (const [index, wait] of [[3, 2400], [4, 2400]]) await sample(index, wait);
      assert.ok(moments.every((at, index) => index === 0 || at >= moments[index - 1]) && moments.at(-1) > moments[0] + 7, `storytree's globe grows as the step plays: ${moments}`);
      await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "value", null, { timeout: 30_000 });
      await page.waitForTimeout(400);
      assert.deepEqual(await drawing(page), { globe: "own", growth: "whole" }, "after the time-lapse storytree's globe is whole");
      assert.equal(await page.locator("#tour-title").textContent(), "Storytree builds a map of your project and glues it to your code.");
      assert.equal(await page.locator("#tour-chips .chip").count(), 0, "the value statement is alone on its slide");
      await page.waitForTimeout(2200); await shot(page, `${tag}-3-value`);
      for (const look of ["beside", "resolve"]) {
        await page.locator("#chapter2").evaluate((node, look) => { node.dataset.fixesLook = look; }, look);
        await go(page, "fixes"); await pause(page);
        assert.equal(await page.locator("#tour-lines .tour-line.on").count(), 3, "all three fixes show while the tour waits");
        await page.waitForTimeout(2600); await shot(page, `${tag}-4-fixes-${look}`);
      }
      await page.locator("#tour-depth").click(); await page.waitForTimeout(500);
      assert.match(await page.locator("#tour-why").textContent(), /four principles/, "the principles are the fixes' depth");
      assert.equal(await page.locator("#tour-why .tour-decisions").count(), 0, "with no decision list");
      await shot(page, `${tag}-5-principles-depth`);
      await page.locator("#tour-depth").click();
      // 2.12: the cut to the shop, whole, narrowed to products, cart and checkout.
      await go(page, "start-small"); await play(page);
      await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "shop" && document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
      assert.deepEqual(await drawing(page), { globe: "shop", growth: "whole" }, "the shop is shown whole");
      assert.equal(await page.locator(".forest-drawing").getAttribute("data-focus"), "story_9d312bf7fc51 story_c3e9a28aef14 story_a2276e03429a", "narrowed to products, cart and checkout");
      await page.waitForTimeout(6000); await shot(page, `${tag}-6-start-small`);
      await page.close();
    }
    observed.push("2.11 arrival on storytree's own globe and 2.12 the cut to the shop's three islands, live globe at 1440 and 390: pass");
  },
  // The look of each fixes treatment as it plays: three frames of one row turning.
  async turning() {
    for (const look of ["beside", "resolve"]) {
      const page = await open({ width: 1440, height: 900 });
      await page.locator("#chapter2").evaluate((node, look) => { node.dataset.fixesLook = look; }, look);
      await go(page, "fixes");
      for (const [index, wait] of [[0, 350], [1, 650], [2, 1400]]) { await page.waitForTimeout(wait); await shot(page, `1440-4-fixes-${look}-turn-${index}`); }
      await page.close();
    }
  },
  // Reduced motion draws the shop whole at once, so under the pain nothing is drawn; without WebGL the still stays hidden.
  async reduced() {
    const page = await open({ width: 1440, height: 900 }, { reducedMotion: "reduce" });
    assert.equal(await page.locator("#website-forest").evaluate(node => getComputedStyle(node).opacity), "0", "reduced motion: no globe under the pain");
    await shot(page, "1440-reduced-1-pain");
    await go(page, "value"); await page.waitForTimeout(800); await shot(page, "1440-reduced-3-value");
    await page.close();
    const still = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    still.on("pageerror", error => errors.push(error.message));
    await still.addInitScript(() => {
      localStorage.setItem("storytree-opening-seen", "yes");
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith("webgl") ? null : original.call(this, kind, ...args); };
    });
    await still.goto(url); await still.locator("#tour-play").waitFor();
    assert.equal(await stepOf(still), "pain");
    assert.equal(await still.locator(".forest-still img").evaluate(node => node.checkVisibility({ visibilityProperty: true })), false, "no WebGL: storytree's saved still never stands in under the pain");
    await go(still, "fixes"); await pause(still); await still.waitForTimeout(300);
    await still.screenshot({ path: path.join(here, "390-no-webgl-4-fixes.png") });
    await still.close();
    // While the globe is still loading, storytree's saved still never stands in under the pain either.
    const loading = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    loading.on("pageerror", error => errors.push(error.message));
    await loading.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await loading.route(/forest-scene-[^/]*\.js$/, () => {});
    await loading.goto(url); await loading.locator("#tour-play").waitFor();
    await loading.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "loading");
    assert.equal(await loading.locator(".forest-still img").evaluate(node => node.checkVisibility({ visibilityProperty: true })), false, "loading: no still of storytree's globe under the pain");
    await loading.close();
    observed.push("2.11 reduced motion, no WebGL and a loading globe keep the arrival dark under the pain: pass");
  },
  // A first-time visitor: Act 1 to its finale, out through its exit, onto the pain and the growth from its point of light.
  async handoff() {
    const page = await open({ width: 1440, height: 900 }, { firstVisit: true });
    await page.locator("#opening-run").click();
    await page.locator("#opening-better").waitFor({ state: "visible", timeout: 90_000 });
    await page.locator("#opening-better").click();
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "pain" && document.querySelector("#opening")?.hidden !== false, null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1400); await shot(page, "1440-0a-turn");
    await page.waitForTimeout(3000); await shot(page, "1440-0b-pain");
    assert.equal(await stepOf(page), "pain");
    await page.close();
    observed.push("Act 1's exit lands on the pain: pass");
  },
  // The map chapter (2.16, ADR-0891): each step on the shop's three teaching islands, at 1440 and 390, and the growth
  // step's stage replaying (Orders and its roads growing on).
  async map() {
    const out = name => path.join(here, `../map-chapter/${name}.png`);
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await open({ width, height });
      for (const id of ["map-stories", "map-parts", "map-code", "map-health"]) {
        await go(page, id); await pause(page);
        await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.screenshot({ path: out(`${width}-${id}`) });
        await play(page);
      }
      await go(page, "map-grow");
      for (const [index, wait] of [[0, 900], [1, 5000], [2, 9000]]) {
        await page.waitForTimeout(wait);
        if (width > 600 || index === 2) await page.screenshot({ path: out(`${width}-map-grow-${index}`) });
      }
      assert.equal(Number(await page.locator(".forest-drawing").getAttribute("data-risen")), 8, "the growth step ends on the shop's eight stories");
      await pause(page); await page.locator("#tour-depth").click(); await page.waitForTimeout(600);
      await page.screenshot({ path: out(`${width}-map-grow-depth`) });
      await page.close();
    }
    observed.push("The map chapter's five steps and its growth on the shop: pictured");
  },
  // The agents chapter (2.17, ADR-0893): each step on the shop at its recorded moment, at 1440 and 390.
  async agents() {
    const out = name => path.join(here, `../agents-chapter/${name}.png`);
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await open({ width, height });
      for (const id of ["agents-fix", "agents-sessions", "agents-arcs", "agents-claim", "agents-parallel", "agents-standdown"]) {
        await go(page, id); await pause(page);
        await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await page.screenshot({ path: out(`${width}-${id}`) });
        await play(page);
      }
      await pause(page); await page.locator("#tour-depth").click(); await page.waitForTimeout(600);
      await page.screenshot({ path: out(`${width}-agents-standdown-depth`) });
      await page.close();
    }
    observed.push("The agents chapter's steps on the shop's recorded moments: pictured");
  },
  // A clip of a close-to-close move (2.15): the camera stays in and turns the globe, never out and in again.
  async closeFlight() {
    const page = await open({ width: 1440, height: 900 }, { video: true });
    await go(page, "map-parts");
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await go(page, "map-code");
    for (let frame = 0; frame < 5; frame++) { await page.screenshot({ path: path.join(here, `../act2-polish/close-flight-${frame}.png`) }); await page.waitForTimeout(600); }
    await page.waitForTimeout(1500);
    const video = page.video(); await page.close();
    const file = await video.path();
    await rm(path.join(here, "../act2-polish/close-flight.webm"), { force: true });
    await rename(file, path.join(here, "../act2-polish/close-flight.webm"));
    observed.push("A close-to-close move stays in and turns the globe: recorded");
  },
  // A clip of the arrival playing at the default 0.75×, pain to fixes.
  async clip() {
    const page = await open({ width: 1440, height: 900 }, { video: true });
    await page.waitForTimeout(500);
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "start-small", null, { timeout: 120_000 });
    await page.waitForTimeout(9000);
    const video = page.video(); await page.close();
    const file = await video.path();
    await rm(path.join(here, "arrival.webm"), { force: true });
    await rename(file, path.join(here, "arrival.webm"));
  },
};
try {
  for (const [name, run] of Object.entries(runs)) if (!only || only === name) { console.log(`run ${name}`); await run(); }
  assert.deepEqual(errors, [], "the browser reports no errors");
  if (!only) await writeFile(path.join(here, "observations.json"), JSON.stringify({ contract: "2.11, 2.12", source: "Locally built unpublished working tree, SwiftShader", observed }, null, 2) + "\n");
  console.log(observed.join("\n"));
} finally {
  await browser.close(); server.close();
  for (const name of await readdir(here)) if (name.endsWith(".webm") && name !== "arrival.webm") await rm(path.join(here, name));
}
