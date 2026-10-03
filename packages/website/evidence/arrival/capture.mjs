// Act 2's arrival (ADR-0889, contract 2.11), from the locally built site: the pain on a dark screen, the shop's
// recorded growth replayed on the tour's clock, the value statement alone, and the three fixes in each look.
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
      assert.deepEqual(await drawing(page), { globe: "shop", growth: "0.00" }, "under the pain the shop's globe is still its point");
      assert.equal(await page.locator(".tour-heading h1").evaluate(node => getComputedStyle(node).opacity), "0", "nor is storytree named yet");
      await page.waitForTimeout(9000); await shot(page, `${tag}-1-pain`);
      await go(page, "grow");
      const moments = [];
      const sample = async (index, wait) => {
        await page.waitForTimeout(wait);
        moments.push(Number((await drawing(page)).growth));
        if (tag === "1440" || index % 2 === 1) await shot(page, `${tag}-2-grow-${index}`);
      };
      for (const [index, wait] of [[0, 600], [1, 2800], [2, 2800]]) await sample(index, wait);
      await pause(page); const held = (await drawing(page)).growth;
      await page.waitForTimeout(2500);
      assert.equal((await drawing(page)).growth, held, "pausing the tour holds the growth");
      await play(page);
      for (const [index, wait] of [[3, 2400], [4, 2400]]) await sample(index, wait);
      assert.ok(moments.every((at, index) => index === 0 || at >= moments[index - 1]) && moments.at(-1) > moments[0] + 10, `the shop grows as the step plays: ${moments}`);
      await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "value", null, { timeout: 30_000 });
      await page.waitForTimeout(400);
      assert.deepEqual(await drawing(page), { globe: "shop", growth: "whole" }, "after the time-lapse the shop is whole");
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
      await page.close();
    }
    observed.push("2.11 arrival with the live globe at 1440 and 390: pass");
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
    assert.equal(await still.locator(".forest-still").evaluate(node => getComputedStyle(node).visibility), "hidden", "no WebGL: storytree's still never stands in for the shop");
    await go(still, "fixes"); await pause(still); await still.waitForTimeout(300);
    await still.screenshot({ path: path.join(here, "390-no-webgl-4-fixes.png") });
    await still.close();
    observed.push("2.11 reduced motion and no WebGL keep the arrival dark under the pain: pass");
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
  // A clip of the arrival playing at 1×, pain to fixes.
  async clip() {
    const page = await open({ width: 1440, height: 900 }, { video: true });
    await page.waitForTimeout(500);
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "fixes", null, { timeout: 90_000 });
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
  if (!only) await writeFile(path.join(here, "observations.json"), JSON.stringify({ contract: "2.11", source: "Locally built unpublished working tree, SwiftShader", observed }, null, 2) + "\n");
  console.log(observed.join("\n"));
} finally {
  await browser.close(); server.close();
  for (const name of await readdir(here)) if (name.endsWith(".webm") && name !== "arrival.webm") await rm(path.join(here, name));
}
