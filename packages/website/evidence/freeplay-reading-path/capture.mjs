// Free play on storytree's own saved project: pick the session that read most and picture its reading path (increment_c684327d5381).
// Run after `pnpm --filter @storytree/website build`: node packages/website/evidence/freeplay-reading-path/capture.mjs [--as <prefix>]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.env.WEBSITE_DIST ?? path.resolve(here, "../../dist"));
const prefix = process.argv.includes("--as") ? process.argv[process.argv.indexOf("--as") + 1] : "after";
const saved = JSON.parse(await readFile(path.resolve(here, "../../src/forest-snapshot.json"), "utf8"));
const counts = new Map();
for (const line of saved.recording.lines) if (line.kind === "note-read" && line.session) counts.set(line.session, (counts.get(line.session) ?? 0) + 1);
const [reader, reads] = [...counts].sort((a, b) => b[1] - a[1])[0];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 120_000 });
    await page.locator("#tour-skip").click();
    await page.getByRole("button", { name: "storytree", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "storytree", null, { timeout: 60_000 });
    const handle = page.locator(".tour-session-surface .sessions-handle");
    if (await handle.getAttribute("aria-expanded") !== "true") await handle.click();
    await page.locator(".tour-session-surface [role=tab]", { hasText: "History" }).click();
    const row = page.locator(`.tour-session-surface [data-session-id="${reader}"]`).first();
    await row.waitFor({ timeout: 30_000 });
    await row.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(here, `${prefix}-${width}.png`) });
    console.log(`${prefix} ${width}: picked ${reader} (${reads} recorded reads)`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
