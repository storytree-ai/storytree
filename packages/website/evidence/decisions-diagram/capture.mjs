// The decisions diagram (increment_1f02efe8af26, ADR-1018 D7), from the locally built site, on SwiftShader: the knowledge
// chapter's first step, its three beats at a laptop's width, the last at 390, a strip of frames from the moment it arrives, and
// its still last frame with reduced motion set. Each shot checks one overlay shows, in the top left (a full-width card above
// the caption on a phone).
// pnpm --filter @storytree/website build && node packages/website/evidence/decisions-diagram/capture.mjs
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
const errors = [], failures = [], seen = [];
const open = async (width, height, reducedMotion = "no-preference") => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  return page;
};
// Opens the knowledge chapter's first step and waits for its third line to bring the diagram; returns when it arrived.
const arrive = async page => {
  if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
  await page.locator('#tour-pips [data-step="knowledge-inside"]').click();
  await page.locator(".tour-diagram").waitFor({ state: "attached", timeout: 60_000 });
  return Date.now();
};
const look = page => page.evaluate(() => {
  const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) } : undefined; };
  const overlays = [...document.querySelectorAll("#chapter2 :is(.tour-diagram, .tour-inset, .tour-arc-surface:not([hidden]) .arc-overlay, .tour-session-surface:not([hidden]) .sessions-list, .story-panel)")]
    .filter(node => node.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map(node => ({ kind: node.className.split(" ")[0], ...box(node) }));
  const caption = [...document.querySelectorAll(".diagram-caption")].filter(node => Number(getComputedStyle(node).opacity) > .5).map(node => node.textContent);
  return { stage: box(document.querySelector("#chapter2")), overlays, card: box(document.querySelector("#chapter2 .tour-card")), corner: document.querySelector("#chapter2")?.dataset.overlay, caption };
});
const check = (name, width, shown) => {
  seen.push({ name, ...shown });
  if (shown.overlays.length !== 1 || shown.overlays[0].kind !== "tour-diagram") failures.push(`${name}: the diagram is the one overlay: ${JSON.stringify(shown.overlays)}`);
  const [overlay] = shown.overlays;
  if (overlay && width > 600 && !(overlay.x <= shown.stage.x + 40 && overlay.y <= shown.stage.y + 160)) failures.push(`${name}: top left: ${JSON.stringify(overlay)}`);
  if (overlay && width <= 600 && !(overlay.width >= width - 32 && overlay.bottom <= shown.card.y + 1)) failures.push(`${name}: a full-width card above the caption`);
};
try {
  // The tour plays at ¾: the line is about 7.7 seconds; the beats begin at 0, 30% and 60% of it, the last dot settles by 90%.
  {
    const page = await open(1440, 900);
    const start = await arrive(page);
    for (const [at, name] of [[1.2, "island"], [3.6, "glued"], [7.4, "tunnel"]]) {
      await page.waitForTimeout(Math.max(0, start + at * 1000 - Date.now()));
      await page.screenshot({ path: path.join(folder, `1440-${name}.png`) });
      check(`1440-${name}`, 1440, await look(page));
    }
    // Played, it leaves with the step.
    await page.locator(".tour-diagram").waitFor({ state: "detached", timeout: 30_000 });
    seen.push({ name: "1440-after", ...await look(page) });
    await page.close();
  }
  {
    const page = await open(390, 844);
    const start = await arrive(page);
    await page.waitForTimeout(Math.max(0, start + 7400 - Date.now()));
    await page.screenshot({ path: path.join(folder, "390-tunnel.png") });
    check("390-tunnel", 390, await look(page));
    await page.close();
  }
  // Reduced motion: the last frame, still, from the moment it arrives.
  {
    const page = await open(1440, 900, "reduce");
    await arrive(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(folder, "1440-reduced.png") });
    const shown = await look(page);
    check("1440-reduced", 1440, shown);
    if (shown.caption.join() !== "What it stands on goes deeper: a tunnel down to the core.") failures.push(`reduced motion shows the last frame: ${shown.caption}`);
    await page.close();
  }
  // The strip: the corner every second from the moment it arrives.
  {
    const page = await open(1440, 900);
    const start = await arrive(page);
    const box = await page.locator(".tour-diagram").boundingBox();
    for (let second = 0; second <= 8; second++) {
      await page.waitForTimeout(Math.max(0, start + second * 1000 - Date.now()));
      await page.screenshot({ path: path.join(folder, "strip", `${String(second).padStart(2, "0")}s.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 } });
    }
    await page.close();
  }
  await writeFile(path.join(folder, "seen.json"), JSON.stringify({ errors, failures, seen }, null, 2) + "\n");
  console.log(JSON.stringify({ errors, failures }, null, 2));
} finally { await browser.close(); server.close(); }
