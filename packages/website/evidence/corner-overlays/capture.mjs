// Panels become corner overlays (increment_e789ceda6458, ADR-1018 D6-D9), from the locally built site, on SwiftShader: the plans
// step, the parts step with its story panel, both moments of the claims step and the knowledge chapter's two panels, at a laptop's
// width and at 390 and 320, each as it settles while it plays. On a laptop the one overlay on show sits in the stage's top right;
// at a phone's width it is one full-width card above the caption.
// pnpm --filter @storytree/website build && node packages/website/evidence/corner-overlays/capture.mjs [--dist <main's dist> --before]
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = process.argv.includes("--dist") ? path.resolve(process.argv[process.argv.indexOf("--dist") + 1]) : path.resolve(here, "../../dist");
const before = process.argv.includes("--before");
const folder = path.join(here, before ? "before" : "after");
await mkdir(folder, { recursive: true });
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
const errors = [], failures = [];
// [step, line, seconds into the line]: the story panel opens at the parts step's third moment (7.5s at 1×, 10s at the tour's ¾).
const moments = [["map-arcs", 1, 3], ["map-capabilities", 1, 12], ["map-claims", 2, 2], ["map-claims", 3, 2], ["knowledge-shelf", 2, 2], ["knowledge-reads", 1, 3]];
const seen = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
    for (const [id, line, into] of moments) {
      const pip = page.locator(`#tour-pips [data-step="${id}"]`);
      if (!await pip.count()) continue;
      if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
      await pip.click();
      await page.waitForFunction(line => [...document.querySelectorAll("#tour-lines .tour-line")].findLastIndex(node => node.classList.contains("on")) === line - 1, line, { timeout: 60_000 });
      await page.waitForTimeout(into * 1000);
      const name = `${width}-${id}${line > 1 ? `-line-${line}` : ""}-${into}s`;
      await page.screenshot({ path: path.join(folder, `${name}.png`) });
      const look = await page.evaluate(() => {
        const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) } : undefined; };
        const overlays = [...document.querySelectorAll("#chapter2 :is(.tour-arc-surface:not([hidden]) .arc-overlay, .tour-session-surface:not([hidden]) .sessions-list, .story-panel)")]
          .filter(node => node.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map(node => ({ kind: node.className.split(" ")[0], ...box(node) }));
        return { stage: box(document.querySelector("#chapter2")), overlays, caption: box(document.querySelector("#chapter2 .tour-card")),
          tags: [...document.querySelectorAll("#tour-tags .tour-tag:not(.away) .tour-tag-text, .tour-arc-pointer:not(.away) .tour-tag-text")].map(node => node.textContent),
          pointers: [...document.querySelectorAll(".tour-arc-pointer:not(.away)")].map(node => ({ label: node.dataset.label, ...box(node) })) };
      });
      seen.push({ name, ...look });
      if (before || id.startsWith("knowledge")) continue;
      // D9: one overlay at a time; on a laptop in the top right, at a phone's width full width and above the caption.
      if (look.overlays.length !== 1) { failures.push(`${name}: one overlay shows, not ${look.overlays.length}`); continue; }
      const [overlay] = look.overlays, stage = look.stage;
      if (width > 600 && !(overlay.right >= stage.right - 40 && overlay.y <= stage.y + 160 && overlay.x > stage.x + stage.width / 2)) failures.push(`${name}: the overlay sits in the top right: ${JSON.stringify(overlay)}`);
      if (width <= 600 && !(overlay.width >= width - 32 && overlay.bottom <= look.caption.y + 1)) failures.push(`${name}: the overlay is a full-width card above the caption: ${JSON.stringify({ overlay, caption: look.caption })}`);
    }
    await page.close();
  }
  await writeFile(path.join(folder, "seen.json"), JSON.stringify({ errors, failures, seen }, null, 2) + "\n");
  console.log(JSON.stringify({ errors, failures }, null, 2));
} finally { await browser.close(); server.close(); }
