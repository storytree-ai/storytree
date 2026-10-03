// Pictures of chapter 2's tour as a visitor meets it (ADR-0879 D1), from the locally built site. Its arrival (pain, growth,
// value, fixes) is pictured by ../arrival/capture.mjs.
// pnpm --filter @storytree/website build && node packages/website/evidence/journey/capture.mjs [--only <name>]
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
await mkdir(here, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });

/** Opens chapter 2 as a returning visitor would, with the live globe drawn. */
async function chapter2(viewport, firstVisit = false) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", error => console.error("pageerror:", error.message));
  if (firstVisit) return page;
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 60_000 });
  return page;
}
const step = (page, index) => page.locator(`#tour-pips [data-go="${index}"]`).click();
const shot = (page, tag, name) => page.screenshot({ path: path.join(here, `${tag}-${name}.png`) });
const at = (index, wait, name) => async (page, tag) => { await step(page, index); await page.waitForTimeout(wait); await shot(page, tag, name); };
const shots = {
  async opening(page, tag) { await page.waitForTimeout(3500); await shot(page, tag, "1-opening"); },
  async grow(page, tag) { await step(page, 4); await page.waitForTimeout(3500); await shot(page, tag, "3a-grow-empty"); await page.waitForTimeout(10000); await shot(page, tag, "3b-grow-stories"); },
  story: at(5, 6500, "4-story"),
  roads: at(6, 6000, "5-roads"),
  contracts: at(9, 9000, "6-contracts"),
  conduitHealth: at(10, 13000, "7-conduit-health"),
  compare: at(11, 15000, "8-compare"),
  claim: at(12, 9000, "9-claim"),
  landing: at(13, 14000, "10-landing"),
  close: at(14, 9000, "11-close"),
  arcsPlan: at(16, 13000, "12-arcs-plan"),
  arcsGrow: at(17, 9000, "13-arcs-grow"),
  arcsLanded: at(18, 13000, "14-arcs-landed"),
  ret: at(20, 6000, "15-return"),
  async health(page, tag) { await step(page, 22); await page.waitForTimeout(3500); await page.locator("#tour-depth").click(); await page.waitForTimeout(800); await shot(page, tag, "16-health-depth"); },
  questions: at(23, 9000, "17-questions"),
  knowledge: at(24, 9000, "18-knowledge"),
  reads: at(27, 9000, "19-reads"),
  async exploring(page, tag) {
    await step(page, 5); await page.waitForTimeout(3000);
    const box = await page.locator("#website-forest canvas").boundingBox();
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .55, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600); await shot(page, tag, "20-exploring");
  },
  everything: at(29, 7000, "21-everything"),
  async handoff(page, tag) {
    // A first-time visitor: chapter 1 to its finale, then the turn into chapter 2's first view.
    await page.goto(url); await page.locator("#opening-run").click();
    await page.locator("#opening-better").waitFor({ state: "visible", timeout: 90_000 });
    await page.screenshot({ path: path.join(here, `${tag}-0a-finale.png`) });
    await page.locator("#opening-better").click();
    await page.waitForTimeout(1600); await page.screenshot({ path: path.join(here, `${tag}-0b-turn.png`) });
    await page.waitForTimeout(1800); await page.screenshot({ path: path.join(here, `${tag}-0c-arrival.png`) });
  },
  async freeplay(page, tag) { await page.locator("#tour-skip").click(); await page.waitForTimeout(2500); await shot(page, tag, "22-freeplay"); },
};
try {
  for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
    for (const [name, shoot] of Object.entries(shots)) {
      if (only && only !== name) continue;
      const page = await chapter2(viewport, name === "handoff");
      try { await shoot(page, tag); console.log("captured", tag, name); } finally { await page.close(); }
    }
  }
} finally { await browser.close(); server.close(); }
