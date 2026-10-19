// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/claims/capture.mjs [--retake]
// The claims below the framed map (ADR-1091 D1 (3)), in the machine's Chrome (Playwright's own Chromium cannot decode H.264):
// three sections in order; claim 1's short plays as it scrolls into view and pauses as it leaves; with reduced motion it
// stays on its poster until played. Pictures: where the map hands over, each claim on a laptop and a phone, and the short playing in place. Without
// --retake the pictures go to a scratch folder.
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
const output = process.argv.includes("--retake") ? path.join(here, "after") : path.join(tmpdir(), "storytree-captures", "website", "claims");
await mkdir(output, { recursive: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".mp4": "video/mp4" };
// A video is fetched in ranges, as a host serves it.
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range) { res.end(body); return; }
  const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1 }).end(body.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const seen = {};
/** A claim as the visitor sees it: the page's full width, from the claim's top to its bottom. */
const shoot = async (page, claim, file) => {
  const box = await claim.boundingBox(), width = page.viewportSize().width, top = await page.evaluate(() => scrollY);
  await page.screenshot({ path: path.join(output, file), clip: { x: 0, y: box.y + top, width, height: box.height }, fullPage: true });
};
const video = page => page.locator(".claim-short video").evaluate(node => ({ paused: node.paused, time: Math.round(node.currentTime * 10) / 10 }));

async function open(options) {
  const page = await browser.newPage(options);
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  return page;
}

try {
  for (const [device, options] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await open(options);
    const claims = page.locator("section.claim");
    assert.equal(await claims.count(), 3, "three claims, no fourth");
    seen[device] = { claims: await claims.locator(".claim-fix").allTextContents() };
    assert.deepEqual(await video(page), { paused: true, time: 0 }, "the short waits, unseen, below the map");
    // Where the map hands over to the claims.
    await page.evaluate(() => scrollTo(0, document.querySelector("#claims").getBoundingClientRect().top + scrollY - innerHeight * 0.45));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, `${device}-below-map.png`) });
    await page.locator(".claim-short video").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector(".claim-short video").currentTime > 11, null, { timeout: 30_000 });
    seen[device].inView = await video(page);
    assert.equal(seen[device].inView.paused, false, "in view, it plays");
    await shoot(page, claims.nth(0), `${device}-claim-1.png`);
    if (device === "desktop") await page.screenshot({ path: path.join(output, "short-playing.png") });
    for (const i of [1, 2]) {
      await claims.nth(i).scrollIntoViewIfNeeded();
      await shoot(page, claims.nth(i), `${device}-claim-${i + 1}.png`);
    }
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(500);
    seen[device].leftView = await video(page);
    assert.equal(seen[device].leftView.paused, true, "out of view, it pauses");
    await page.close();
  }

  const still = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await still.locator(".claim-short video").scrollIntoViewIfNeeded();
  await still.waitForTimeout(1500);
  seen.reducedMotion = await video(still);
  assert.deepEqual(seen.reducedMotion, { paused: true, time: 0 }, "with reduced motion it stays on its poster");
  await still.locator(".claim-short video").screenshot({ path: path.join(output, "reduced-motion-poster.png") });
  await still.close();
  await writeFile(path.join(output, "seen.json"), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(`claims: every check passed; pictures in ${output}`);
} finally {
  await browser.close();
  server.close();
}
