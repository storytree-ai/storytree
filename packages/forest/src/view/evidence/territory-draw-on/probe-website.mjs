// Every frame the website's globe renders through the map chapter's capabilities step, read off its territories: each one's
// opacity and visibility as drawn, and the borders'. From the locally built site (pnpm --filter @storytree/website build).
// node packages/forest/src/view/evidence/territory-draw-on/probe-website.mjs [--dist <folder>] [--out <file>]
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { capturePath } from "../../../../../website/evidence/capture-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// The website's own browser driver: this package has none.
const { chromium } = createRequire(path.join(here, "../../../../../website/package.json"))("playwright-core");
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const dist = path.resolve(arg("--dist") ?? path.join(here, "../../../../../website/dist"));
const out = arg("--out") ?? path.join(here, "website-frames.json");
const shots = arg("--shots");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen", "yes");
    // The globe's capture seam: wrap its renderer so each drawn frame is read, once recording starts.
    window.__probe = { frames: [], on: false };
    window.__storytreeCaptureGlobe = get => {
      const gl = get().gl, render = gl.render.bind(gl);
      gl.render = (scene, camera) => {
        render(scene, camera);
        if (!window.__probe.on) return;
        const marks = {};
        scene.traverse(o => {
          if (!o.name.startsWith("territory:") && o.name !== "territory-borders") return;
          let shown = true; for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
          const story = (() => { for (let p = o; p; p = p.parent) if (p.name.startsWith("planet:")) return p.name.slice(7); return "?"; })();
          const key = `${story}/${o.name}`;
          const material = o.material, range = o.geometry?.drawRange;
          marks[key] = { shown, opacity: Math.round(material.opacity * 1000) / 1000, id: o.id, ...(range && range.count !== Infinity ? { drawn: range.count } : {}) };
        });
        window.__probe.frames.push({ t: Math.round(performance.now()), marks });
      };
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  const go = async id => page.locator(`#tour-pips [data-step="${id}"]`).click();
  await go("map-stories");
  await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__probe.on = true; });
  await go("map-capabilities");
  if (shots) for (let i = 0; i < 40; i++) await page.screenshot({ path: path.join(shots, `f${String(i).padStart(2, "0")}.png`) });
  else await page.waitForTimeout(9000);
  const frames = await page.evaluate(() => window.__probe.frames);
  await writeFile(out, JSON.stringify(frames));
  console.log(`${frames.length} frames -> ${out}`);
} finally { await browser.close(); server.close(); }
