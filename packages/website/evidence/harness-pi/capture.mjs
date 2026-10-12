// Pi's mark joins the harness step's row (increment_dcf865db5b9a), from the locally built site, on SwiftShader:
// the harness step at 1440 and 390, as it settles while the step plays.
// pnpm --filter @storytree/website build && node packages/website/evidence/harness-pi/capture.mjs [--before]
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
const errors = [];
// [step, line, seconds into the line].
const moments = [["map-harness", 1, 3]];
const seen = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
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
      await page.waitForFunction(line => document.querySelectorAll("#tour-lines .tour-line.on").length === line, line, { timeout: 60_000 });
      await page.waitForTimeout(into * 1000);
      const name = `${width}-${id}${line > 1 ? `-line-${line}` : ""}`;
      await page.screenshot({ path: path.join(folder, `${name}.png`) });
      seen.push({ name, ...await page.evaluate(() => {
        const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : undefined; };
        const marks = [...document.querySelectorAll("#tour-marks .tour-mark")].map(node => ({ name: node.textContent, ...box(node) }));
        const note = document.querySelector("#tour-marks-note:not([hidden])");
        return { card: box(document.querySelector("#tour-card")), row: box(document.querySelector("#tour-marks")), marks, note: note?.textContent, noteBox: box(note) };
      }) });
    }
    await page.close();
  }
  await writeFile(path.join(folder, "seen.json"), JSON.stringify({ errors, seen }, null, 2) + "\n");
  console.log(JSON.stringify({ errors, seen }, null, 2));
} finally { await browser.close(); server.close(); }
