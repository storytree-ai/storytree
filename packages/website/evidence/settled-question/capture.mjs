// Free play on storytree's own saved project: the arcs drawer opens a settled question, saved with only its title and answer
// (website 3.14, arc surface 5.3), and pictures it at 1440 and 390 (increment_d8611dbb5d46).
// Run after `pnpm --filter @storytree/website build`: node packages/website/evidence/settled-question/capture.mjs [--as <prefix>]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { capturePath } from "../capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.env.WEBSITE_DIST ?? path.resolve(here, "../../dist"));
const prefix = process.argv.includes("--as") ? process.argv[process.argv.indexOf("--as") + 1] : "after";
const [arc, question] = ["arc_e42da2528db8", "question_b4430290d0e5"];
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
    const handle = page.locator(".arc-handle").first();
    if (await handle.getAttribute("aria-expanded") !== "true") await handle.click();
    await page.locator(`[data-arc-select="${arc}"]`).first().click();
    await page.locator(`[data-question-open="${question}"]`).click();
    const reading = page.locator(`.arc-question[data-question-id="${question}"]`);
    await reading.waitFor({ timeout: 30_000 });
    const headings = await page.locator(".arc-briefing h4").count();
    await reading.locator("h3").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(here, `${prefix}-${width}.png`) });
    console.log(`${prefix} ${width}: opened ${question}, ${headings} section headings (h4) in its reading`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
