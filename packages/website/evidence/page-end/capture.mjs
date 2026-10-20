// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/page-end/capture.mjs [--retake]
// The page's end (ADR-1091 D1 (4), (5)): below the claims, the harness line with its marks, then the waitlist as the last thing on
// the page. Pictures: the bottom of the page on a laptop and a phone. Without --retake the pictures go to a scratch folder.
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
const output = process.argv.includes("--retake") ? path.join(here, "after") : path.join(tmpdir(), "storytree-captures", "website", "page-end");
await mkdir(output, { recursive: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
const seen = {};
try {
  for (const [device, options] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage(options);
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    seen[device] = await page.evaluate(() => ({
      last: [...document.querySelectorAll("main > section")].at(-1).id,
      marks: [...document.querySelectorAll("#harness img")].map(img => ({ alt: img.alt, drawn: img.complete && img.naturalWidth > 0 })),
      callInView: document.querySelector("#call-action").getBoundingClientRect().bottom <= innerHeight,
      harnessTop: Math.round(document.querySelector("#harness").getBoundingClientRect().top),
    }));
    assert.equal(seen[device].last, "call", "the page ends on the call");
    assert.ok(seen[device].marks.every(mark => mark.drawn), "every mark draws");
    assert.ok(seen[device].callInView, "the call is on screen at the bottom");
    await page.screenshot({ path: path.join(output, `${device}-bottom.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
await writeFile(path.join(output, "seen.json"), `${JSON.stringify(seen, null, 1)}\n`);
console.log(`Pictures: ${output}`);
