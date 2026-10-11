// The map chapter's stories and capabilities steps, one line each (increment_796f905c9276), from the locally built site, on
// SwiftShader: each step at every moment its labels arrive, at 1440, 390 and 320, as the step plays at the tour's own 0.75×;
// each step paused (the still that shows all its last line's labels); each without WebGL; and a clip of the two at 1440.
// pnpm --filter @storytree/website build && node packages/website/evidence/map-one-line/capture.mjs
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
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
const errors = [];
const noWebGL = () => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) ? null : original.call(this, kind, ...rest); }; };
// [step, moment, what a label then says (undefined: none expected), the narrowest screen it shows on (tour-copy.ts)].
const moments = [["map-stories", 1], ["map-stories", 2, "a story", 601], ["map-stories", 3, "a story", 601], ["map-stories", 4, "a story", 601],
  ["map-stories", 5, "a pathway: the cart needs signing in", 390],
  ["map-capabilities", 1, "a capability", 601], ["map-capabilities", 2, "each dot is a file: server.js · 110 lines", 390], ["map-capabilities", 3, "how its capabilities work together", 601]];
const look = page => page.evaluate(() => {
  const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : undefined; };
  const shown = [...document.querySelectorAll("#tour-tags .tour-tag:not(.away) .tour-tag-text, .tour-arc-pointer:not(.away) .tour-tag-text")].filter(node => getComputedStyle(node.parentElement).opacity !== "0");
  const labels = shown.map(node => ({ text: node.textContent, box: box(node), pointer: node.parentElement.dataset.label === "panel" })).filter(label => label.box);
  const others = [["card", "#tour-card"], ["bar", "#tour-bar"], ["panel", ".story-panel"]].map(([name, selector]) => [name, box(document.querySelector(selector))]).filter(([, found]) => found);
  const names = [...document.querySelectorAll(".planet-nameplate[data-story-id]")].filter(node => getComputedStyle(node).opacity !== "0" && getComputedStyle(node).visibility === "visible").map(node => [node.querySelector(".planet-nameplate-title")?.textContent, box(node.querySelector(".planet-nameplate-title"))]).filter(([, found]) => found);
  const meet = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  return { moment: Number(document.querySelector("#chapter2").dataset.tourMoment), lines: [...document.querySelectorAll("#tour-lines .tour-line.on")].map(node => node.textContent),
    labels: labels.map(label => ({ text: label.text, crowds: [...(label.box.x >= 0 && label.box.x + label.box.width <= innerWidth && label.box.y >= 0 && label.box.y + label.box.height <= innerHeight ? [] : ["off screen"]),
      // The panel's own label stands inside it, under its diagram.
      ...[...others, ...names].filter(([what, other]) => meet(label.box, other) && !(what === "panel" && label.pointer)).map(([what]) => `over ${what}`)] })) };
});
const open = async (viewport, { webgl = true, video } = {}) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: here, size: viewport } } : {}) });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  if (!webgl) await page.addInitScript(noWebGL);
  await page.goto(url);
  await page.waitForFunction(state => document.querySelector("#website-forest")?.dataset.forestState === state, webgl ? "live" : "still", { timeout: 90_000 });
  return page;
};
const playing = async page => { if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click(); };
const go = (page, id) => page.locator(`#tour-pips [data-step="${id}"]`).click();
const seen = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 700]]) {
    const page = await open({ width, height });
    for (const [id, moment, words, narrowest] of moments) {
      await playing(page);
      if (await page.locator("#chapter2").getAttribute("data-tour-step") !== id || Number(await page.locator("#chapter2").getAttribute("data-tour-moment")) > moment) await go(page, id);
      await page.waitForFunction(({ id, moment }) => document.querySelector("#chapter2").dataset.tourStep === id && Number(document.querySelector("#chapter2").dataset.tourMoment) === moment, { id, moment }, { timeout: 60_000 });
      // A labelled picture waits for its label, as SwiftShader's frames can lag the tour's clock; then for it to settle.
      if (words && width >= narrowest) await page.waitForFunction(words => [...document.querySelectorAll("#tour-tags .tour-tag:not(.away) .tour-tag-text, .tour-arc-pointer:not(.away) .tour-tag-text")].some(node => node.textContent === words), words, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(words ? 900 : 1500);
      const name = `${width}-${id}-moment-${moment}`;
      await page.screenshot({ path: path.join(here, `${name}.png`) });
      seen.push({ name, expected: words && width >= narrowest ? words : null, ...await look(page) });
    }
    // Paused at its end, each step shows every label its line brought.
    for (const id of ["map-stories", "map-capabilities"]) {
      await playing(page); await go(page, id);
      await page.waitForFunction(() => Number(document.querySelector('#tour-pips [aria-current="step"]').style.getPropertyValue("--fill")) >= .9, null, { timeout: 60_000 });
      await page.locator("#tour-play").click(); await page.waitForTimeout(900);
      const name = `${width}-${id}-paused`;
      await page.screenshot({ path: path.join(here, `${name}.png`) });
      seen.push({ name, ...await look(page) });
    }
    await page.close();
    // Without WebGL: the words, the step's note, and the How beneath them.
    const still = await open({ width, height }, { webgl: false });
    for (const id of ["map-stories", "map-capabilities"]) {
      await go(still, id); await still.waitForTimeout(1500);
      const name = `${width}-${id}-no-webgl`;
      await still.screenshot({ path: path.join(here, `${name}.png`) });
      seen.push({ name, ...await look(still) });
    }
    await still.close();
  }
  // A clip of the two steps at 1440, at the tour's own 0.75×.
  const page = await open({ width: 1440, height: 900 }, { video: true });
  await playing(page); await go(page, "map-stories");
  await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "map-claims", null, { timeout: 90_000 });
  const video = page.video(); await page.close();
  await rm(path.join(here, "two-steps.webm"), { force: true });
  await rename(await video.path(), path.join(here, "two-steps.webm"));
  await writeFile(path.join(here, "seen.json"), JSON.stringify({ errors, seen }, null, 2) + "\n");
  console.log(JSON.stringify({ errors, seen: seen.map(item => [item.name, item.moment, item.labels.map(label => `${label.text}${label.crowds.length ? ` (${label.crowds.join(", ")})` : ""}`)]) }, null, 1));
} finally { await browser.close(); server.close(); }
