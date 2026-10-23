// Build first (pnpm --filter @storytree/website build), then: node packages/website/evidence/claims/capture.mjs [--retake]
// The claims below the framed map (ADR-1091 D1 (3)), in the machine's Chrome (Playwright's own Chromium cannot decode H.264):
// three sections in order; each carries its own short that plays as it scrolls into view and pauses as it leaves; with
// reduced motion each stays on its poster until played. At desktop width each claim's hook sits on the left and its short on the
// right, larger than a phone's short yet never filling the screen; on a phone they stack. Pictures: where the map hands over, each
// claim on a laptop and a phone, and each short playing in place. Without --retake the pictures go to a scratch folder.
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
const video = (page, i = 0) => page.locator(".claim-short video").nth(i).evaluate(node => ({ paused: node.paused, time: Math.round(node.currentTime * 10) / 10 }));
/** Each short, by its claim, and how far in to let it play before its picture: claim 1's to its map growing from a brand-new
 * project, claim 2's to its map with both claims on it, claim 3's to the island's panel with its code and memory. */
const SHORTS = [{ claim: 0, until: 7 }, { claim: 1, until: 23 }, { claim: 2, until: 24 }];

/** Where each claim's hook and short fall on the page, and whether the page scrolls sideways. */
const layout = page => page.evaluate(() => ({
  viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
  claims: [...document.querySelectorAll("section.claim")].map(claim => {
    const box = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x: Math.round(x), y: Math.round(y + scrollY), width: Math.round(width), height: Math.round(height) }; };
    return { hook: box(claim.querySelector(".claim-fix")), short: box(claim.querySelector(".claim-short video")) };
  }),
}));
/** A phone's short: the width a 390 px phone gives it, edge to edge. */
const PHONE_SHORT = 390;
/** At desktop width: hook left, short right and level with it, the short clearly larger than a phone's yet at most 60% of the screen's height. */
function sideBySide({ viewport, scrollWidth, claims }, where) {
  for (const [i, { hook, short }] of claims.entries()) {
    assert.ok(hook.x + hook.width <= short.x, `${where}: claim ${i + 1}'s hook sits left of its short (${JSON.stringify({ hook, short })})`);
    assert.ok(hook.y < short.y + short.height && hook.y + hook.height > short.y, `${where}: claim ${i + 1}'s hook sits level with its short`);
    assert.ok(short.width >= PHONE_SHORT * 1.4, `${where}: claim ${i + 1}'s short is clearly larger than a phone's (${short.width}px)`);
    assert.ok(short.height <= viewport.height * 0.6, `${where}: claim ${i + 1}'s short never fills the screen (${short.height}px of ${viewport.height}px)`);
  }
  assert.ok(scrollWidth <= viewport.width, `${where}: no sideways scroll (${scrollWidth}px)`);
}

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
    assert.equal(await page.locator(".claim-short video").count(), SHORTS.length, "each claim carries a short");
    for (const short of SHORTS.keys()) assert.deepEqual(await video(page, short), { paused: true, time: 0 }, "each short waits, unseen, below the map");
    seen[device].layout = await layout(page);
    if (device === "desktop") sideBySide(seen[device].layout, device);
    else {
      for (const [i, { hook, short }] of seen[device].layout.claims.entries()) assert.ok(hook.y + hook.height <= short.y, `phone: claim ${i + 1}'s hook sits above its short`);
      assert.ok(seen[device].layout.scrollWidth <= 390, `phone: no sideways scroll (${seen[device].layout.scrollWidth}px)`);
    }
    // Where the map hands over to the claims.
    await page.evaluate(() => scrollTo(0, document.querySelector("#claims").getBoundingClientRect().top + scrollY - innerHeight * 0.45));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, `${device}-below-map.png`) });
    seen[device].inView = [];
    for (const [short, { claim, until }] of SHORTS.entries()) {
      // Its claim at the top of the screen, so the claim above it has scrolled away, as a visitor reads down the page.
      await claims.nth(claim).evaluate(node => node.scrollIntoView({ block: "start" }));
      await page.waitForFunction(([i, at]) => document.querySelectorAll(".claim-short video")[i].currentTime > at, [short, until], { timeout: 45_000 });
      seen[device].inView.push(await video(page, short));
      assert.equal(seen[device].inView[short].paused, false, `in view, claim ${claim + 1}'s short plays`);
      if (short > 0) assert.equal((await video(page, short - 1)).paused, true, `${device}: and the one above it, out of view, has paused`);
      await shoot(page, claims.nth(claim), `${device}-claim-${claim + 1}.png`);
      if (device === "desktop") await page.screenshot({ path: path.join(output, short ? `short-${short + 1}-playing.png` : "short-playing.png") });
    }
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(500);
    seen[device].leftView = await Promise.all(SHORTS.map((_, short) => video(page, short)));
    assert.ok(seen[device].leftView.every(each => each.paused), "out of view, each pauses");
    await page.close();
  }

  // Smaller laptops: still side by side, and the short still leaves the screen around it.
  seen.laptops = {};
  for (const [width, height] of [[1280, 720], [1024, 768]]) {
    const page = await open({ viewport: { width, height } });
    seen.laptops[`${width}x${height}`] = await layout(page);
    sideBySide(seen.laptops[`${width}x${height}`], `${width}x${height}`);
    await page.close();
  }

  const still = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  seen.reducedMotion = [];
  for (const short of SHORTS.keys()) {
    await still.locator(".claim-short video").nth(short).scrollIntoViewIfNeeded();
    await still.waitForTimeout(1500);
    seen.reducedMotion.push(await video(still, short));
    assert.deepEqual(seen.reducedMotion[short], { paused: true, time: 0 }, "with reduced motion each stays on its poster");
    await still.locator(".claim-short video").nth(short).screenshot({ path: path.join(output, short ? `reduced-motion-poster-${short + 1}.png` : "reduced-motion-poster.png") });
  }
  await still.close();
  await writeFile(path.join(output, "seen.json"), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(`claims: every check passed; pictures in ${output}`);
} finally {
  await browser.close();
  server.close();
}
