// Capture the shop's two stills from the website's own live drawing of free play on the shop, the same saved renderer the
// visitor's globe uses. Build first (pnpm --filter @storytree/website build), then from the checkout root:
//   node packages/website/evidence/forest/shop-stills.mjs
// Like storytree's stills, each is a central square crop of the drawn canvas; the page's text and panels are hidden for the shot.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(website, "dist");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
try {
  for (const [width, height, kind] of [[1440, 1000, "desktop"], [390, 844, "phone"]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: kind === "phone" ? 2 : 1, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#tour-skip").click();
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.globeMap === "shop" && document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 90_000 });
    await page.waitForTimeout(4000);
    // Only the drawing: the chapter's text, bar and panels sit over it on the page, not in the picture.
    await page.addStyleTag({ content: "#chapter2 > :not(.tour-stage), .tour-card, .forest-views, .forest-controls, .tour-session-surface, .tour-project { visibility:hidden !important; }" });
    await page.waitForTimeout(500);
    const box = await page.locator("#website-forest .forest-canvas canvas").boundingBox();
    const side = Math.min(box.width, box.height);
    await page.screenshot({ path: path.join(website, `public/shop-${kind}.png`), clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side } });
    console.log(`Captured the shop's ${kind} still at ${width} × ${height}: ${Math.round(side)} px square`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
