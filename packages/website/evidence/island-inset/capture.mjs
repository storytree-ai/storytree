// The island inset (increment_2ace4fa6e477, ADR-1018 D7, D10), from the locally built site, on SwiftShader: the parts step's
// three moments at a laptop's width (its parts arriving, its files, then the story panel in its place), one at 390, a strip of
// frames as the inset arrives and leaves, and what the second live view costs at a phone's size: frames a second with one globe
// growing, with the inset beside it, and once it has gone, with the CPU slowed four times.
// pnpm --filter @storytree/website build && node packages/website/evidence/island-inset/capture.mjs
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const folder = path.join(here, "after");
await mkdir(path.join(folder, "strip"), { recursive: true });
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
const errors = [], failures = [], seen = [], cost = {};
const open = async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  return page;
};
const go = async (page, id) => {
  if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
  await page.locator(`#tour-pips [data-step="${id}"]`).click();
  await page.waitForFunction(id => document.querySelector('#tour-pips [aria-current="step"]')?.dataset.step === id, id, { timeout: 60_000 });
  return Date.now();
};
const look = page => page.evaluate(() => {
  const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) } : undefined; };
  const overlays = [...document.querySelectorAll("#chapter2 :is(.tour-inset, .tour-arc-surface:not([hidden]) .arc-overlay, .tour-session-surface:not([hidden]) .sessions-list, .story-panel)")]
    .filter(node => node.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map(node => ({ kind: node.className.split(" ")[0], ...box(node) }));
  return { stage: box(document.querySelector("#chapter2")), overlays, caption: box(document.querySelector("#chapter2 .tour-card")),
    inset: document.querySelector(".tour-inset-title")?.textContent, globeTags: [...document.querySelectorAll("#tour-tags .tour-tag:not(.away) .tour-tag-text")].map(node => node.textContent),
    insetTags: [...document.querySelectorAll(".tour-inset .tour-tag:not(.away) .tour-tag-text")].map(node => node.textContent),
    canvases: document.querySelectorAll("#chapter2 canvas").length };
});
const fps = page => page.evaluate(() => new Promise(resolve => { let frames = 0; const start = performance.now();
  const tick = now => { frames++; if (now - start < 3000) requestAnimationFrame(tick); else resolve(Math.round(frames / ((now - start) / 1000) * 10) / 10); }; requestAnimationFrame(tick); }));
try {
  // The tour plays at ¾: the parts step's moments begin at 0, 6 and 10 seconds.
  for (const [width, height, shots] of [[1440, 900, [[2, "parts"], [7.5, "files"], [11.5, "panel"]]], [390, 844, [[7.5, "files"]]]]) {
    const page = await open(width, height);
    const start = await go(page, "map-capabilities");
    for (const [at, name] of shots) {
      await page.waitForTimeout(Math.max(0, start + at * 1000 - Date.now()));
      await page.screenshot({ path: path.join(folder, `${width}-${name}.png`) });
      const shown = await look(page);
      seen.push({ name: `${width}-${name}`, ...shown });
      if (shown.overlays.length !== 1) failures.push(`${width}-${name}: one overlay shows, not ${shown.overlays.length}`);
      const [overlay] = shown.overlays;
      if (name !== "panel" && overlay?.kind !== "tour-inset") failures.push(`${width}-${name}: the inset shows`);
      if (name === "panel" && overlay?.kind !== "story-panel") failures.push(`${width}-${name}: the story panel takes the corner`);
      if (shown.globeTags.length) failures.push(`${width}-${name}: no label on the globe while the inset plays`);
      if (name !== "panel" && shown.insetTags.length !== 1) failures.push(`${width}-${name}: one label in the inset, not ${shown.insetTags.length}`);
      if (overlay && width > 600 && !(overlay.right >= shown.stage.right - 40 && overlay.y <= shown.stage.y + 160)) failures.push(`${width}-${name}: top right: ${JSON.stringify(overlay)}`);
      if (overlay && width <= 600 && !(overlay.width >= width - 32 && overlay.bottom <= shown.caption.y + 1)) failures.push(`${width}-${name}: a full-width card above the caption`);
    }
    await page.close();
  }
  // The strip: the corner every second from the step's start, at a laptop's width.
  {
    const page = await open(1440, 900);
    const start = await go(page, "map-capabilities");
    for (let second = 0; second <= 12; second++) {
      await page.waitForTimeout(Math.max(0, start + second * 1000 - Date.now()));
      await page.screenshot({ path: path.join(folder, "strip", `${String(second).padStart(2, "0")}s.png`), clip: { x: 960, y: 60, width: 480, height: 420 } });
    }
    await page.close();
  }
  // The cost at a phone's size: the stories step's globe growing alone (4 to 7 seconds in), then the parts step while the inset
  // plays beside its growing globe (1 to 4) and once it has gone and the story panel shows (10.5 to 13.5): frames a second and
  // the main thread's busy time over each second, with the CPU as it is and slowed four times.
  const window = async (page, cdp, start, from) => {
    await page.waitForTimeout(Math.max(0, start + from * 1000 - Date.now()));
    const busy = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value])).TaskDuration;
    const before = await busy(), frames = await fps(page), after = await busy();
    return { fps: frames, busy: Math.round((after - before) / 3 * 100) + "%", canvases: (await look(page)).canvases };
  };
  for (const slow of [1, 4]) {
    const page = await open(390, 844);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: slow });
    const stories = await go(page, "map-stories");
    const growing = await window(page, cdp, stories, 4);
    const start = await go(page, "map-capabilities");
    cost[`cpu ×${slow}`] = { "one globe growing (the stories step)": growing, "globe growing and inset": await window(page, cdp, start, 1), "globe and story panel": await window(page, cdp, start, 10.5) };
    await page.close();
  }
  await writeFile(path.join(folder, "seen.json"), JSON.stringify({ errors, failures, cost, seen }, null, 2) + "\n");
  console.log(JSON.stringify({ errors, failures, cost }, null, 2));
} finally { await browser.close(); server.close(); }
