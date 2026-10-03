// node packages/website/evidence/warm-globe/measure.mjs <built dist folder> <label>: chapter 1's page-time frames and
// the turn, with the instrumentation of ../opening.mjs (verifyOpeningFrames), measuring only, so it can read any build,
// including ones that journey would fail. SwiftShader at 1440x900; one JSON line on stdout.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const [dist, label] = [path.resolve(process.argv[2]), process.argv[3]];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.openingFrames = { ready: [], playing: [], turn: [], swarm: [], quiet: [] };
    window.globeDraws = 0;
    for (const kind of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const draw = kind.prototype[method];
        if (!draw) continue;
        kind.prototype[method] = function (...args) {
          if (this.canvas.closest("#website-forest")) {
            window.globeDraws++;
            if (window.handoverAt !== undefined) window.firstDrawAfterHandover ??= performance.now();
          }
          return draw.apply(this, args);
        };
      }
    }
    window.addEventListener("storytree-opening", event => { if (!event.detail.active && window.runAt) window.handoverAt ??= performance.now(); });
    let last;
    const frame = now => {
      if (last !== undefined) {
        window.openingFrames[window.finaleAt ? "turn" : window.runAt ? "playing" : "ready"].push(now - last);
        if (window.runAt && !window.finaleAt) window.openingFrames[window.parkedAt ? "quiet" : "swarm"].push(now - last);
      }
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.addEventListener("click", event => { if (event.target.id === "opening-run") { window.runAt = performance.now(); last = undefined; } }, true);
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(() => {
        if (window.runAt && !document.getElementById("opening-better").hidden && !window.finaleAt) window.finaleAt = performance.now();
      }).observe(document.getElementById("opening-better"), { attributes: true, attributeFilter: ["hidden"] });
      const agents = document.getElementById("opening-agents");
      new MutationObserver(() => {
        if (!window.runAt || window.parkedAt) return;
        const helpers = [...agents.querySelectorAll(".opening-agent")];
        if (helpers.length && helpers.every(helper => !helper.hidden && helper.classList.contains("is-parked"))) window.parkedAt = performance.now();
      }).observe(agents, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const run = page.getByRole("button", { name: "Run", exact: true });
  const better = page.getByRole("button", { name: "show me the better way" });
  await run.waitFor();
  await page.waitForTimeout(2500);
  await run.click();
  await better.waitFor({ timeout: 60000 });
  const atFinale = await page.evaluate(() => ({
    globeDrawsInChapter1: window.globeDraws,
    activationsInChapter1: performance.getEntriesByName("forest-activate").length,
    forestStateAtFinale: document.querySelector("#website-forest").dataset.forestState,
  }));
  // A visitor reads the finale for a few seconds before pressing the way out.
  await page.waitForTimeout(3000);
  await better.click();
  await page.waitForFunction(() => window.firstDrawAfterHandover !== undefined, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const measured = await page.evaluate(() => {
    const summarize = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const elapsedMs = values.reduce((a, b) => a + b, 0);
      return { frames: values.length, fps: +(values.length * 1000 / elapsedMs).toFixed(2), p95FrameMs: +sorted[Math.floor(sorted.length * .95)].toFixed(1), longestFrameMs: +sorted.at(-1).toFixed(1) };
    };
    const activate = performance.getEntriesByName("forest-activate").at(-1)?.startTime, ready = performance.getEntriesByName("forest-ready").at(-1)?.startTime;
    const first = performance.getEntriesByName("forest-activate").at(0)?.startTime;
    return {
      ready: summarize(window.openingFrames.ready), playing: summarize(window.openingFrames.playing),
      swarm: summarize(window.openingFrames.swarm), quiet: summarize(window.openingFrames.quiet),
      parkedAfterRunMs: Math.round(window.parkedAt - window.runAt),
      activatedAfterRunMs: first === undefined ? null : Math.round(first - window.runAt),
      finaleMs: Math.round(window.finaleAt - window.runAt),
      handoverToFirstDrawMs: Math.round(window.firstDrawAfterHandover - window.handoverAt),
      activateToReadyMs: activate !== undefined && ready !== undefined ? Math.round(ready - activate) : null,
      activations: performance.getEntriesByName("forest-activate").length,
    };
  });
  console.log(JSON.stringify({ label, at: new Date().toISOString(), browser: browser.version(), ...atFinale, ...measured }));
} finally {
  await browser.close();
  server.close();
}
