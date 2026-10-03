// Build first, then: node packages/website/evidence/terminal.mjs [output folder, default ./terminal] [--only 1440]
// Seeded, repeatable pictures of chapter 1 (the green-phosphor terminal, ADR-0879 D6): the same page, the same
// timers, the same viewports every run. The CRT collapse is photographed by pausing its animations at fixed times.
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const output = path.resolve(here, args[0] ?? "terminal");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const dist = path.resolve(here, "../dist");
await mkdir(output, { recursive: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

// Put each named animation at a fixed time after its own delay (paused, so the picture is repeatable).
const setTimes = (page, at) => page.evaluate(times => document.getAnimations().forEach(animation => {
  animation.pause();
  if (animation.id in times) animation.currentTime = animation.effect.getTiming().delay + times[animation.id];
}), at);
// Pause everything the first frame the collapse reaches `phase`.
const freeze = (page, phase, times) => page.evaluate(target => new Promise(resolve => {
  const root = document.querySelector("#opening");
  const tick = () => { if (root.dataset.crt === target) { document.getAnimations().forEach(animation => animation.pause()); resolve(); } else requestAnimationFrame(tick); };
  tick();
}), phase).then(() => setTimes(page, times));
const resume = page => page.evaluate(() => document.getAnimations().forEach(animation => animation.play()));

const sizes = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
  { name: "320", width: 320, height: 640 },
];
for (const size of sizes.filter(size => !only || size.name === only)) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const shot = name => page.screenshot({ path: path.join(output, `${size.name}-${name}.png`) });
  await page.goto(url);
  const run = page.getByRole("button", { name: "Run", exact: true });
  await run.waitFor();
  await page.waitForTimeout(400);
  await shot("1-first-screen");
  await run.click();
  await page.waitForTimeout(10000);
  await shot("2-mid-swarm");
  await page.getByRole("button", { name: "show me the better way" }).waitFor({ timeout: 25000 });
  await page.waitForTimeout(1800);
  await shot("3-peak-finale");
  await page.evaluate(() => document.getElementById("opening-better").click());
  await freeze(page, "line", { "crt-squash": 130, "crt-line": 130 });
  await shot("4-turn-squash");
  await setTimes(page, { "crt-squash": 225, "crt-line": 250 });
  await shot("5-turn-line");
  await resume(page);
  await freeze(page, "point", { "crt-point": 140 });
  await shot("6-turn-point");
  await setTimes(page, { "crt-point": 200, "crt-glow": 50 });
  await shot("7-turn-glow");
  await resume(page);
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  console.log(`${size.name}: captured${errors.length ? `, page errors: ${errors.join("; ")}` : ""}`);
  await page.close();
}
// The first screen at 200% browser zoom: half the CSS pixels at twice the density.
for (const zoom of [{ name: "1280-at-200pct", width: 640, height: 450 }, { name: "390-at-200pct", width: 195, height: 422 }].filter(zoom => !only || only === "zoom")) {
  const page = await browser.newPage({ viewport: { width: zoom.width, height: zoom.height }, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.getByRole("button", { name: "Run", exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, `${zoom.name}-first-screen.png`) });
  console.log(`${zoom.name}: scrollWidth ${await page.evaluate(() => document.documentElement.scrollWidth)} of ${zoom.width}`);
  await page.close();
}
await browser.close();
server.close();
