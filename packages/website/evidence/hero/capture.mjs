// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/hero/capture.mjs [--retake]
// The top of the page (owner's voice note, 2026-10-21): on arrival the framed map draws itself inside its frame, then stands
// whole for free play (2.32); at desktop width the hook line sits on the left and the map on the right; on a phone they stack
// with no sideways scroll; and a plain wheel over the frame still scrolls the page. Pictures: desktop mid-growth and whole,
// phone mid-growth and whole. Without --retake the pictures go to a scratch folder.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const output = process.argv.includes("--retake") ? path.join(here, "after") : path.join(tmpdir(), "storytree-captures", "website", "hero");
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

/** How much of the frame's picture is drawn land, roads and names: its pixels well off the frame's dark ground. */
async function drawn(page, picture) {
  return page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 150) lit++;
    return lit / (data.length / 4);
  }, `data:image/png;base64,${picture.toString("base64")}`);
}
const box = (page, selector) => page.locator(selector).boundingBox();

async function arrive(device, options) {
  const page = await browser.newPage(options);
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  const live = Date.now();
  // Mid-growth: the globe has swelled and the first islands are rising.
  await page.waitForTimeout(3500);
  const frame = page.locator("#map-frame");
  const early = await frame.screenshot({ path: path.join(output, `${device}-drawing.png`) });
  await page.screenshot({ path: path.join(output, `${device}-top-drawing.png`) });
  const early_ms = Date.now() - live;
  await page.waitForTimeout(Math.max(0, 16_000 - (Date.now() - live)));
  const whole = await frame.screenshot({ path: path.join(output, `${device}-whole.png`) });
  await page.screenshot({ path: path.join(output, `${device}-top.png`) });
  seen[device] = { drawingAt: early_ms, drawnMid: await drawn(page, early), drawnWhole: await drawn(page, whole) };
  assert.ok(seen[device].drawnMid < seen[device].drawnWhole * 0.8, `${device}: the map is still drawing itself mid-growth (${JSON.stringify(seen[device])})`);
  return page;
}

try {
  const page = await arrive("desktop", { viewport: { width: 1440, height: 900 } });
  const lead = await box(page, ".map-lead"), after = await box(page, ".map-after"), frame = await box(page, "#map-frame");
  seen.desktop.layout = { lead, after, frame };
  assert.ok(lead.x + lead.width <= frame.x && after.x + after.width <= frame.x, "at desktop width the hook line sits left of the map");
  assert.ok(lead.y < frame.y + frame.height && lead.y + lead.height > frame.y, "beside it, level with the frame");
  assert.ok(frame.width > 1440 * 0.5, `the map keeps most of the width (${frame.width}px)`);
  assert.ok(frame.y + frame.height <= 900, "the whole frame is on the first screen");
  // The frame still never takes the page's scroll.
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(800);
  seen.desktop.wheelScrolled = await page.evaluate(() => scrollY);
  assert.ok(seen.desktop.wheelScrolled > 200, "a plain wheel over the frame scrolls the page");
  await page.close();

  const phone = await arrive("phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pLead = await box(phone, ".map-lead"), pFrame = await box(phone, "#map-frame"), pAfter = await box(phone, ".map-after");
  seen.phone.layout = { lead: pLead, frame: pFrame, after: pAfter, scrollWidth: await phone.evaluate(() => document.documentElement.scrollWidth) };
  assert.ok(pLead.y + pLead.height <= pFrame.y && pFrame.y + pFrame.height <= pAfter.y, "on a phone the hook line, the map and its paragraph stack");
  assert.ok(seen.phone.layout.scrollWidth <= 390, `with no sideways scroll (${seen.phone.layout.scrollWidth}px)`);
  await phone.close();

  // Reduced motion: whole at once.
  const still = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await still.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await still.goto(url);
  await still.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  await still.waitForTimeout(2500);
  seen.reduced = { drawn: await drawn(still, await still.locator("#map-frame").screenshot()) };
  assert.ok(seen.reduced.drawn > seen.desktop.drawnWhole * 0.8, `under reduced motion the map is whole at once (${seen.reduced.drawn})`);
  await still.close();

  await writeFile(path.join(output, "seen.json"), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(`hero: every check passed; pictures in ${output}`);
} finally {
  await browser.close();
  server.close();
}
