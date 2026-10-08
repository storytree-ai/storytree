// Build first, then: node packages/website/evidence/terminal.mjs [output folder, default ./terminal] [--only 1440]
// Seeded, repeatable pictures of chapter 1 (the green-phosphor terminal, ADR-0879 D6): the same page, the same
// timers, the same viewports every run. The CRT collapse is photographed by pausing its animations at fixed times.
import { createServer } from "node:http";
import { capturePath } from "./capture-path.mjs";
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
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
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

// Seconds after Run: the thinking, the first helpers far apart, the pile-up, every helper waiting, the finale.
const PACE = [2, 5, 9, 13, 17, 21, 25, 29, 32, 35];
const MID = 21;
const strip = async (frames, file) => {
  const page = await browser.newPage({ viewport: { width: 1840, height: 520 } });
  await page.setContent(`<body style="margin:0;padding:10px;background:#111;display:grid;grid-template-columns:repeat(5,360px);gap:10px;font:14px monospace;color:#9f9">${frames.map(frame =>
    `<figure style="margin:0"><img style="width:360px;display:block" src="data:image/png;base64,${frame.png}"><figcaption>${frame.at} s after Run</figcaption></figure>`).join("")}</body>`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
};

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
  // The pace (ADR-0888 1.2-1.3): frames at fixed times after Run, put side by side on one strip.
  const ranAt = Date.now();
  const frames = [];
  for (const at of PACE) {
    await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - ranAt)));
    if (at === MID) await shot("2-mid-swarm");
    if (size.name === "1440") frames.push({ at, png: (await page.screenshot()).toString("base64") });
  }
  if (frames.length) await strip(frames, path.join(output, `${size.name}-pace-strip.png`));
  await page.getByRole("button", { name: "show me where to look" }).waitFor({ timeout: 50000 });
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
