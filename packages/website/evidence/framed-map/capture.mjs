// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/framed-map/capture.mjs [--retake]
// The framed map at the top of the page (ADR-1091 D2), in a real browser with a drawn map: a plain wheel scrolls the page
// and leaves the camera where it was; WASD and the arrows leave it too; ctrl+wheel, + and a drag move it; on a phone the map
// is still until tapped, with a way out. Pictures: desktop and phone, top of the page and scrolled. Without --retake the
// pictures go to a scratch folder.
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
const output = process.argv.includes("--retake") ? path.join(here, "after") : path.join(tmpdir(), "storytree-captures", "website", "framed-map");
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

/** Where the map's island names sit on its canvas: the camera's pose, as the visitor sees it. */
const pose = page => page.locator("#website-forest").evaluate(host => {
  const canvas = host.querySelector("canvas").getBoundingClientRect();
  return [...host.querySelectorAll(".planet-nameplate[data-story-id]")].map(node => {
    const box = node.getBoundingClientRect();
    return { id: node.dataset.storyId, x: Math.round(box.x - canvas.x), y: Math.round(box.y - canvas.y) };
  });
});
const moved = (from, to) => from.reduce((sum, one) => {
  const other = to.find(item => item.id === one.id);
  return sum + (other ? Math.hypot(one.x - other.x, one.y - other.y) : 1000);
}, 0) / Math.max(1, from.length);
async function open(options) {
  const page = await browser.newPage(options);
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("#website-forest .planet-nameplate[data-story-id]").length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  return page;
}

try {
  // A laptop.
  const page = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(output, "desktop-top.png") });
  const frame = await page.locator("#map-frame").boundingBox();
  const middle = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const still = await pose(page);
  assert.ok(still.length > 3, "the map draws its islands' names");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(800);
  const scrolled = await page.evaluate(() => scrollY);
  assert.ok(scrolled > 200, `a plain wheel over the frame scrolls the page (scrollY ${scrolled})`);
  seen.wheel = { scrolled, cameraMoved: moved(still, await pose(page)) };
  assert.ok(seen.wheel.cameraMoved < 2, `and leaves the camera where it was (${seen.wheel.cameraMoved}px)`);
  await page.screenshot({ path: path.join(output, "desktop-scrolled.png") });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  for (const key of ["ArrowRight", "ArrowDown", "d", "w", "a", "s"]) { await page.keyboard.down(key); await page.waitForTimeout(250); await page.keyboard.up(key); }
  await page.waitForTimeout(600);
  seen.keys = { cameraMoved: moved(still, await pose(page)) };
  assert.ok(seen.keys.cameraMoved < 2, `WASD and the arrows leave the camera (${seen.keys.cameraMoved}px)`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  const top = await pose(page);
  await page.locator("[data-zoom='in']").click();
  await page.waitForTimeout(900);
  seen.zoomIn = { cameraMoved: moved(top, await pose(page)) };
  assert.ok(seen.zoomIn.cameraMoved > 10, `+ zooms the map (${seen.zoomIn.cameraMoved}px)`);
  const zoomed = await pose(page);
  await page.keyboard.down("Control"); await page.mouse.move(middle.x, middle.y); await page.mouse.wheel(0, 300); await page.keyboard.up("Control");
  await page.waitForTimeout(900);
  seen.ctrlWheel = { cameraMoved: moved(zoomed, await pose(page)) };
  assert.ok(seen.ctrlWheel.cameraMoved > 10, `ctrl+wheel zooms the map (${seen.ctrlWheel.cameraMoved}px)`);
  const before = await pose(page);
  await page.mouse.move(middle.x - 100, middle.y); await page.mouse.down(); await page.mouse.move(middle.x + 100, middle.y + 40, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(500);
  seen.drag = { cameraMoved: moved(before, await pose(page)) };
  assert.ok(seen.drag.cameraMoved > 20, `a drag pans the map (${seen.drag.cameraMoved}px)`);
  await page.close();

  // A phone.
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await phone.screenshot({ path: path.join(output, "phone-top.png") });
  const box = await phone.locator("#map-frame").boundingBox();
  const under = await phone.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-map-tap]") !== null, [box.x + box.width / 2, box.y + box.height / 2]);
  assert.ok(under, "on touch a finger on the map lands on Tap to explore, not the map");
  assert.equal(await phone.locator("[data-map-exit]").isHidden(), true);
  await phone.evaluate(() => scrollBy(0, 520));
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: path.join(output, "phone-scrolled.png") });
  await phone.evaluate(() => scrollTo(0, 0));
  await phone.locator("[data-map-tap]").tap();
  await phone.waitForTimeout(500);
  assert.equal(await phone.locator("#map-frame").getAttribute("data-hand"), "map", "a tap gives the map the hand");
  assert.equal(await phone.locator("[data-map-exit]").isVisible(), true, "with a visible way out");
  await phone.screenshot({ path: path.join(output, "phone-exploring.png") });
  await phone.locator("[data-map-exit]").tap();
  await phone.waitForTimeout(300);
  assert.equal(await phone.locator("[data-map-tap]").isVisible(), true, "the way out gives the page its scroll back");
  seen.phone = { tapLayerCovers: under, exitShown: true };
  await phone.close();
  await writeFile(path.join(output, "seen.json"), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(`framed map: every check passed; pictures in ${output}`);
} finally {
  await browser.close();
  server.close();
}
