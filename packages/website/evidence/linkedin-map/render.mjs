// node --import tsx packages/website/evidence/linkedin-map/render.mjs [--reread] [--reuse-frames] [--still <seconds>,…] [--tilt <pixels of right-drag up>] [--ground 620]
// From a checkout of storytree whose library is reachable (read only), after `git fetch origin`. Renders storytree's own map
// growing on the glass sheet, frame by frame in the shipped engine (headless Chromium, software WebGL), for the owner's
// LinkedIn post (increment_04461fe17938): a 1920×1080 H.264 MP4 at 30 fps with no audio, a 1080×1350 cut, the poster (the last
// frame) and a strip of stills. They go to ~/storytree-out/linkedin-map/ (never to main: evidence videos are ephemeral,
// question_fd8ff8dfaf88); the stills are also copied beside this script. The library's reading is kept in that folder's
// work/ and read again only with --reread; --reuse-frames encodes the frames already drawn there. --still renders only those moments, to frame the camera.
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { ffmpeg } from "../../src/shorts/render.ts";
import { readGrowth } from "./read.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { reread: { type: "boolean" }, "reuse-frames": { type: "boolean" }, still: { type: "string" }, tilt: { type: "string", default: "0" },
  ground: { type: "string", default: "620" }, out: { type: "string", default: path.join(homedir(), "storytree-out", "linkedin-map") } } });
const out = values.out, work = path.join(out, "work"), framesDir = path.join(work, "frames");
mkdirSync(work, { recursive: true });
/** The growth's length, the hold on the whole map after it, the frame rate and size. */
const GROW = 18, HOLD = 2.5, FPS = 30, VIEW = { width: 1920, height: 1080 };
/** Hours of history each frame's claims are gathered over: a claim held for minutes still shows for its slice. */
const SLICE = 3;
/** Pixels the map is lifted in the frame (0: the sheet, seen from above with no tilt, sits in the view's middle). */
const LIFT = 0;

const readingFile = path.join(work, "reading.json");
if (values.reread || !existsSync(readingFile)) {
  const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const reading = await readGrowth({ repository, branch: "origin/main", slice: SLICE });
  writeFileSync(readingFile, JSON.stringify(reading));
  console.log(`Read storytree: ${reading.stages.length} stages, ${reading.scene.islands.length} islands, ${reading.changes.length} notes, ${reading.sessions.filter(s => s.wisps.length).length} claim slices.`);
}
const bundle = path.join(work, "bundle.js");
await build({ entryPoints: [path.join(here, "page.tsx")], outfile: bundle, bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  loader: { ".json": "json", ".glb": "binary", ".png": "file", ".webp": "file" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error" });
const forestCss = readFileSync(path.join(here, "../../../forest/src/view/styles.css"), "utf8");
const server = createServer((req, res) => {
  const file = req.url.split("?")[0];
  if (file === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(readFileSync(bundle)); return; }
  if (file === "/reading.json") { res.setHeader("Content-Type", "application/json"); res.end(readFileSync(readingFile)); return; }
  const asset = path.join(work, path.basename(file));
  if (file !== "/" && existsSync(asset)) { res.end(readFileSync(asset)); return; }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><style>${forestCss}</style><style>html,body{margin:0;background:#101418;overflow:hidden}.sheet-compass{display:none}#map{position:absolute;left:0;width:100vw;top:-${2 * LIFT}px;height:calc(100vh + ${2 * LIFT}px)}</style><div id="map"></div><script type="module" src="/bundle.js"></script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/?seconds=${GROW}&ground=${values.ground}`;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.clip !== undefined, null, { timeout: 300_000 });
  // Only the map: the sheet as the framing leaves it, its underside out of frame. --tilt tilts it toward the underside as the
  // app's right-drag does (π/600 a pixel up the window); past 60° the knowledge core's place under the glass shows.
  if (Number(values.tilt) !== 0) {
    await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(VIEW.width / 2, VIEW.height / 2 - Number(values.tilt), { steps: 10 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(1500);
  }
  const { seconds, stages } = await page.evaluate(() => ({ seconds: window.clip.seconds, stages: window.clip.stages }));
  console.log(`Growth: ${stages} stages over ${seconds.toFixed(2)} s.`);
  const shoot = async (at, file) => { await page.evaluate(t => window.clip.at(t), Math.min(at, seconds)); await page.screenshot({ path: file, type: file.endsWith(".png") ? "png" : "jpeg", ...(file.endsWith(".png") ? {} : { quality: 95 }) }); };

  if (values.still) {
    for (const at of values.still.split(",").map(Number)) { const file = path.join(out, `try-${at}.png`); await shoot(at, file); console.log(file); }
  } else {
    const total = Math.round((GROW + HOLD) * FPS), started = performance.now();
    if (!values["reuse-frames"]) { rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true }); }
    for (let frame = 0; frame < total && !values["reuse-frames"]; frame++) {
      await shoot(frame / FPS, path.join(framesDir, `${String(frame).padStart(4, "0")}.jpg`));
      if (frame % 60 === 0) console.log(`frame ${frame}/${total} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
    }
    const mp4 = path.join(out, "storytree-map-growth-1080p.mp4"), tall = path.join(out, "storytree-map-growth-4x5.mp4");
    const encode = ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", "-an"];
    // The frames are full-range JPEGs; the video is the limited-range yuv420p every player takes.
    await ffmpeg(["-y", "-framerate", String(FPS), "-i", path.join(framesDir, "%04d.jpg"), "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", ...encode, mp4]);
    // The 4:5 cut: the whole map at the feed's width, centred on the same dark ground (this ffmpeg has no pad filter; a turn of
    // nothing onto a larger frame pads it).
    await ffmpeg(["-y", "-i", mp4, "-vf", "scale=1080:-2,rotate=0:ow=1080:oh=1350:c=0x101418,format=yuv420p", ...encode, tall]);
    const poster = path.join(out, "storytree-map-growth-poster.png");
    await shoot(GROW + HOLD, poster);
    // Stills across the growth, and the whole map at the end.
    const moments = [0.5, 2, 4.5, 7, 9.5, 12, 15, GROW + HOLD];
    const stills = [];
    for (const [i, at] of moments.entries()) {
      const file = `still-${String(i + 1).padStart(2, "0")}-${at}s.png`;
      await shoot(at, path.join(out, file));
      copyFileSync(path.join(out, file), path.join(here, file));
      stills.push(file);
    }
    const strip = await browser.newPage({ viewport: { width: 1920, height: 600 }, deviceScaleFactor: 1 });
    for (const file of stills) copyFileSync(path.join(out, file), path.join(work, file));
    await strip.goto(`http://127.0.0.1:${server.address().port}/blank`);
    await strip.setContent(`<body style="margin:0;background:#101418;font:16px sans-serif;color:#d8dde3;display:flex;flex-wrap:wrap;gap:6px;padding:6px">${
      stills.map(file => `<figure style="margin:0;width:468px"><img src="/${file}" style="width:468px;display:block"><figcaption>${file.replace(/^still-\d+-|\.png$/g, "")}</figcaption></figure>`).join("")}</body>`);
    await strip.waitForLoadState("networkidle");
    await strip.screenshot({ path: path.join(here, "strip.png"), fullPage: true });
    copyFileSync(path.join(here, "strip.png"), path.join(out, "strip.png"));
    const probe = file => ({ file, bytes: statSync(file).size });
    console.log(JSON.stringify({ growth: seconds, seconds: GROW + HOLD, frames: total, files: [probe(mp4), probe(tall), probe(poster)], errors }, null, 2));
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
