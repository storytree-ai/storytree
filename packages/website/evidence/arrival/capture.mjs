// Act 2's arrival (ADR-0889, contracts 2.11 and 2.12), from the locally built site: the pain on a dark screen,
// storytree's own recorded growth replayed on the tour's clock, the value statement alone, the three fixes in each
// look, and the cut to the shop's three teaching islands.
// pnpm --filter @storytree/website build && node packages/website/evidence/arrival/capture.mjs [--only <name>] [--check]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { capturePath } from "../capture-path.mjs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
// --dist <folder> pictures another build (main's, for a before-and-after).
const dist = process.argv.includes("--dist") ? path.resolve(process.argv[process.argv.indexOf("--dist") + 1]) : path.resolve(here, "../../dist");
// --check asserts without rewriting the committed pictures: every picture, clip and observation goes to a fresh temporary
// folder instead (named at the end). A lane that only needs the check runs it this way.
const pictures = process.argv.includes("--check") ? path.join(await mkdtemp(path.join(tmpdir(), "arrival-check-")), "arrival") : here;
for (const folder of ["", "../map-chapter", "../act2-polish"]) await mkdir(path.join(pictures, folder), { recursive: true });
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const { file, status } = capturePath(dist, req.url);
  if (status) { res.writeHead(status).end(); return; }
  try { res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const observed = [];
const errors = [];

async function open(viewport, { firstVisit = false, reducedMotion = "no-preference", video = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion, ...(video ? { recordVideo: { dir: pictures, size: viewport } } : {}) });
  page.on("pageerror", error => errors.push(error.message));
  if (!firstVisit) await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await page.goto(url);
  if (!firstVisit) await page.waitForFunction(() => document.querySelector("#website-forest")?.dataset.forestState === "live", null, { timeout: 90_000 });
  return page;
}
const stepOf = page => page.locator("#chapter2").getAttribute("data-tour-step");
const drawing = page => page.locator(".forest-drawing").evaluate(node => ({ globe: node.dataset.globe, growth: node.dataset.growth }));
/** Frames drawn per second over `ms`, counted by the page's own animation frames. */
const fps = (page, ms) => page.evaluate(ms => new Promise(resolve => { let n = 0; const start = performance.now(); const tick = now => { n++; if (now - start < ms) requestAnimationFrame(tick); else resolve(n * 1000 / (now - start)); }; requestAnimationFrame(tick); }), ms);
const go = async (page, id) => { await page.locator(`#tour-pips [data-step="${id}"]`).click(); assert.equal(await stepOf(page), id); };
const shot = (page, name) => page.screenshot({ path: path.join(pictures, `${name}.png`) });
const pause = async page => { if (await page.locator("#tour-play").getAttribute("aria-label") === "Pause the tour") await page.locator("#tour-play").click(); };
const play = async page => { if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click(); };

const runs = {
  // 2.11 with the live globe: the pain before any globe, the growth on the tour's clock, then whole.
  async arrival() {
    for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const page = await open(viewport);
      assert.equal(await stepOf(page), "pain", "Act 2 opens on the pain");
      assert.deepEqual(await drawing(page), { globe: "own", growth: "0.00" }, "under the pain storytree's own globe is still its point");
      assert.equal(await page.locator(".tour-heading h1").evaluate(node => getComputedStyle(node).opacity), "0", "nor is storytree named yet");
      await page.waitForTimeout(9000); await shot(page, `${tag}-1-pain`);
      await go(page, "grow");
      const moments = [];
      const sample = async (index, wait) => {
        await page.waitForTimeout(wait);
        // A slow machine can finish the time-lapse before the last sample: whole is its end.
        const { growth } = await drawing(page);
        moments.push(growth === "whole" ? Infinity : Number(growth));
        if (tag === "1440" || index % 2 === 1) await shot(page, `${tag}-2-grow-${index}`);
      };
      await sample(0, 0);
      const rate = await fps(page, 2500);
      observed.push(`${tag}: ${rate.toFixed(1)} fps over 2.5 s of the time-lapse`);
      for (const [index, wait] of [[1, 0], [2, 2800]]) await sample(index, wait);
      // The pause lands on the next frame: read the held moment once it has.
      await pause(page); await page.waitForTimeout(300); const held = (await drawing(page)).growth;
      await page.waitForTimeout(2500);
      assert.equal((await drawing(page)).growth, held, "pausing the tour holds the growth");
      await play(page);
      for (const [index, wait] of [[3, 2400], [4, 2400]]) await sample(index, wait);
      assert.ok(moments.every((at, index) => index === 0 || at >= moments[index - 1]) && moments.at(-1) > moments[0] + 7, `storytree's globe grows as the step plays: ${moments}`);
      await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "value", null, { timeout: 30_000 });
      await page.waitForTimeout(400);
      assert.deepEqual(await drawing(page), { globe: "own", growth: "whole" }, "after the time-lapse storytree's globe is whole");
      assert.equal(await page.locator("#tour-title").textContent(), "Storytree builds a map of your project and glues it to your code.");
      assert.equal(await page.locator("#tour-chips .chip").count(), 0, "the value statement is alone on its slide");
      await page.waitForTimeout(2200); await shot(page, `${tag}-3-value`);
      for (const look of ["beside", "resolve"]) {
        await page.locator("#chapter2").evaluate((node, look) => { node.dataset.fixesLook = look; }, look);
        await go(page, "fixes"); await pause(page);
        assert.equal(await page.locator("#tour-lines .tour-line.on").count(), 3, "all three fixes show while the tour waits");
        await page.waitForTimeout(2600); await shot(page, `${tag}-4-fixes-${look}`);
      }
      await page.locator("#tour-depth").click(); await page.waitForTimeout(500);
      assert.match(await page.locator("#tour-why").textContent(), /four principles/, "the principles are the fixes' depth");
      assert.equal(await page.locator("#tour-why .tour-decisions").count(), 0, "with no decision list");
      await shot(page, `${tag}-5-principles-depth`);
      await page.locator("#tour-depth").click();
      // 2.12: the map chapter opens on the shop's empty globe, swelling from a point where storytree's was.
      await go(page, "map-empty"); await play(page); await page.waitForTimeout(300);
      assert.equal((await drawing(page)).globe, "shop", "the shop's point replaces storytree's globe at once");
      await page.waitForTimeout(4500); await shot(page, `${tag}-6-map-empty`);
      await page.close();
    }
    observed.push("2.11 arrival on storytree's own globe and 2.12 the map chapter's empty globe, live globe at 1440 and 390: pass");
  },
  // The look of each fixes treatment as it plays: three frames of one row turning.
  async turning() {
    for (const look of ["beside", "resolve"]) {
      const page = await open({ width: 1440, height: 900 });
      await page.locator("#chapter2").evaluate((node, look) => { node.dataset.fixesLook = look; }, look);
      await go(page, "fixes");
      for (const [index, wait] of [[0, 350], [1, 650], [2, 1400]]) { await page.waitForTimeout(wait); await shot(page, `1440-4-fixes-${look}-turn-${index}`); }
      await page.close();
    }
  },
  // Reduced motion draws the shop whole at once, so under the pain nothing is drawn; without WebGL the still stays hidden.
  async reduced() {
    const page = await open({ width: 1440, height: 900 }, { reducedMotion: "reduce" });
    assert.equal(await page.locator("#website-forest").evaluate(node => getComputedStyle(node).opacity), "0", "reduced motion: no globe under the pain");
    await shot(page, "1440-reduced-1-pain");
    await go(page, "value"); await page.waitForTimeout(800); await shot(page, "1440-reduced-3-value");
    await page.close();
    const still = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    still.on("pageerror", error => errors.push(error.message));
    await still.addInitScript(() => {
      localStorage.setItem("storytree-opening-seen", "yes");
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith("webgl") ? null : original.call(this, kind, ...args); };
    });
    await still.goto(url); await still.locator("#tour-play").waitFor();
    assert.equal(await stepOf(still), "pain");
    assert.equal(await still.locator(".forest-still img").evaluate(node => node.checkVisibility({ visibilityProperty: true })), false, "no WebGL: storytree's saved still never stands in under the pain");
    await go(still, "fixes"); await pause(still); await still.waitForTimeout(300);
    await still.screenshot({ path: path.join(pictures, "390-no-webgl-4-fixes.png") });
    await still.close();
    // While the globe is still loading, storytree's saved still never stands in under the pain either.
    const loading = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    loading.on("pageerror", error => errors.push(error.message));
    await loading.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await loading.route(/forest-scene-[^/]*\.js$/, () => {});
    await loading.goto(url); await loading.locator("#tour-play").waitFor();
    await loading.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "loading");
    assert.equal(await loading.locator(".forest-still img").evaluate(node => node.checkVisibility({ visibilityProperty: true })), false, "loading: no still of storytree's globe under the pain");
    await loading.close();
    observed.push("2.11 reduced motion, no WebGL and a loading globe keep the arrival dark under the pain: pass");
  },
  // A first-time visitor: Act 1 to its finale, out through its exit, onto the pain and the growth from its point of light.
  async handoff() {
    const page = await open({ width: 1440, height: 900 }, { firstVisit: true });
    await page.locator("#opening-run").click();
    await page.locator("#opening-better").waitFor({ state: "visible", timeout: 90_000 });
    await page.locator("#opening-better").click();
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "pain" && document.querySelector("#opening")?.hidden !== false, null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1400); await shot(page, "1440-0a-turn");
    await page.waitForTimeout(3000); await shot(page, "1440-0b-pain");
    assert.equal(await stepOf(page), "pain");
    await page.close();
    observed.push("Act 1's exit lands on the pain: pass");
  },
  // The map chapter's health beat: Checkout's recorded CI change; its last step offers the sourced comparison.
  async map() {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await open({ width, height });
      await go(page, "map-health");
      await page.waitForTimeout(2000); await shot(page, `${width}-health-yellow`);
      assert.equal(Number(await page.locator(".forest-drawing").getAttribute("data-risen")), 4);
      await page.waitForTimeout(13_000); await pause(page);
      assert.equal(await stepOf(page), "map-health");
      assert.equal(Number(await page.locator(".forest-drawing").getAttribute("data-risen")), 4);
      await shot(page, `${width}-health-green`);
      await page.locator("#tour-depth").click();
      assert.equal(await page.locator(".tour-compare a").count(), 2);
      await page.close();
    }
    observed.push("2.16: Health holds the first round's four stories and, the chapter's last step, offers the sourced comparison: pass");
  },
  // Every chapter step told in the tour's one format (2.19), the map's, played in order with motion, at 1920,
  // 1440, 1280, 390 and 320, each with its How and Why opened once. --to <folder> (beside this one) says where they go.
  async chapters() {
    const to = process.argv.includes("--to") ? process.argv[process.argv.indexOf("--to") + 1] : "one-format/after";
    const out = name => path.join(pictures, `../${to}/${name}.png`);
    await mkdir(path.join(pictures, `../${to}`), { recursive: true });
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [390, 844], [320, 700]]) {
      const page = await open({ width, height });
      const ids = await page.locator("#tour-pips [data-step]").evaluateAll(pips => pips.map(pip => pip.dataset.step).filter(id => /^map-/.test(id)));
      for (const id of ["fixes", ...ids]) {
        await go(page, id); await pause(page);
        await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await page.screenshot({ path: out(`${width}-${id}`) });
        if (["map-claims", "map-health"].includes(id)) { await page.locator("#tour-depth").click(); await page.waitForTimeout(600); await page.screenshot({ path: out(`${width}-${id}-depth`) }); await page.locator("#tour-depth").click(); }
        await play(page);
      }
      await page.close();
    }
    observed.push(`Every chapter step in the tour's one format: pictured in ${to}`);
  },
  // The map chapter in six steps (2.16, ADR-0891 amended 2026-10-11), played in order at 1920, 1440, 1280, 390 and 320: each
  // step pictured as it settles, and on the lines that change what it shows (the dots, the flags, the arcs panel), with where the
  // names of the islands it frames stand against the screen's edges, the header, the card, the bar and the panels; and a clip
  // of the whole chapter at 1440 at the tour's own pace. --to <folder> (beside this one) says where they go.
  async mapSteps() {
    const to = process.argv.includes("--to") ? process.argv[process.argv.indexOf("--to") + 1] : "map-six-steps";
    const out = name => path.join(pictures, `../${to}/${name}`);
    await mkdir(path.join(pictures, `../${to}`), { recursive: true });
    const four = ["Signing in", "Browsing", "Cart", "Checkout"];
    // A picture taken as line N of a step is said, named `<step>-line-<N>`; every step is also pictured as it settles.
    const lines = { "map-capabilities": [2], "map-claims": [1, 2] };
    const frames = { "map-empty": [], "map-arcs": [], "map-stories": four, "map-capabilities-line-2": ["Signing in"], "map-capabilities": ["Signing in"],
      "map-claims-line-1": four, "map-claims-line-2": [], "map-claims": ["Browsing", "Cart", "Checkout"], "map-health": four };
    // The arcs panel lies over the globe while its line is said, and names no island; the sessions list's line names none
    // either, and on a laptop it may lie over signing in, which holds no flag. On a phone the list lies over the globe.
    const phoneFrames = { ...frames, "map-claims": [] };
    const measure = page => page.evaluate(names => {
      const box = node => { const r = node?.getBoundingClientRect(); return r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined; };
      const plates = [...document.querySelectorAll(".planet-nameplate[data-story-id]")].map(node => ({ title: node.querySelector(".planet-nameplate-title")?.textContent, box: box(node), name: box(node.querySelector(".planet-nameplate-title")), shown: getComputedStyle(node).opacity !== "0" }));
      return { step: document.querySelector("#chapter2").dataset.tourStep, progress: Number(document.querySelector('#tour-pips [aria-current="step"]')?.style.getPropertyValue("--fill")), arrived: document.querySelector(".forest-drawing")?.dataset.arrived,
        room: { width: innerWidth, height: innerHeight }, drawing: box(document.querySelector(".forest-drawing")), card: box(document.querySelector("#tour-card")), bar: box(document.querySelector("#tour-bar")), panel: box(document.querySelector(".story-panel")),
        sessions: document.querySelector(".tour-session-surface")?.hidden === false ? box(document.querySelector(".tour-session-surface .sessions-list")) : undefined,
        // The header is the band across the top that holds the name and the note on the right.
        header: { x: 0, y: 0, width: innerWidth, height: Math.max(...[".tour-heading", "#tour-note"].map(selector => box(document.querySelector(selector))).map(found => found ? found.y + found.height : 0)) }, plates: plates.filter(plate => names.includes(plate.title)) };
    }, Object.values(frames).flat());
    const meet = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const report = [];
    const play = async (page, width, clip) => {
      const settled = new Map();
      // Faster than the tour's 0.75× everywhere but the clip: each step still settles where it would.
      if (!clip) { if (width > 600) await page.locator('#tour-bar [data-speed="1.5"]').click(); else for (let tap = 0; tap < 2; tap++) await page.locator("#tour-speed-cycle").click(); }
      if (clip) {
        await go(page, "map-empty");
        await page.waitForFunction(() => !document.querySelector("#chapter2").dataset.tourStep.startsWith("map-"), null, { timeout: 360_000 });
      } else {
        const ids = await page.locator('#tour-pips [data-step^="map-"]').evaluateAll(pips => pips.map(pip => pip.dataset.step));
        for (const id of ids) {
          if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
          await go(page, id);
          // A line's picture is taken while the step plays: a paused step shows all its lines.
          for (const line of lines[id] ?? []) {
            await page.waitForFunction(line => document.querySelectorAll("#tour-lines .tour-line.on").length === line, line, { timeout: 60_000 });
            await page.waitForTimeout(line === 1 ? 3500 : 1800);
            settled.set(`${id}-line-${line}`, { picture: await page.screenshot(), seen: await measure(page) });
          }
          await page.waitForFunction(() => Number(document.querySelector('#tour-pips [aria-current="step"]').style.getPropertyValue("--fill")) >= .88, null, { timeout: 60_000 });
          await pause(page); await page.waitForTimeout(700);
          settled.set(id, { picture: await page.screenshot(), seen: await measure(page) });
        }
      }
      for (const [id, { picture, seen }] of settled) {
        await writeFile(out(`${width}-${id}.png`), picture);
        if (width === 1440 && id === "map-capabilities") await writeFile(out("1440-story-panel.png"), picture);
        const names = (typeof width === "number" && width <= 600 ? phoneFrames : frames)[id] ?? [];
        const misses = names.flatMap(title => {
          const plate = seen.plates.find(item => item.title === title);
          if (!plate?.box || !plate.shown) return [`${title}: not drawn`];
          // Islands shrink with the drawing on phones; their HTML names keep the same font size.
          // Reserve three name-heights at desktop scale, scaled by the drawing's short side (at least 20px). A name's height is its
          // title line's: an island with no code yet carries a second line, its landed count, beneath its name, not above it.
          const reach = Math.max(20, (plate.name ?? plate.box).height * 3 * Math.min(1, Math.min(seen.drawing.width, seen.drawing.height) / 600)), island = { ...plate.box, y: plate.box.y - reach, height: plate.box.height + reach };
          const inside = island.x >= 0 && island.y >= 0 && island.x + island.width <= seen.room.width && island.y + island.height <= seen.room.height;
          return [...(inside ? [] : [`${title}: off screen`]), ...["header", "card", "bar", "panel", "sessions"].filter(part => meet(island, seen[part])).map(part => `${title}: under the ${part}`)];
        });
        if (!clip) report.push({ width, step: id, framed: names, misses, seen });
      }
    };
    // --widths 1440,390 pictures only those, without the clip, while a look is being tuned.
    const widths = process.argv.includes("--widths") ? process.argv[process.argv.indexOf("--widths") + 1].split(",").map(Number) : undefined;
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [390, 844], [320, 700]]) {
      if (widths && !widths.includes(width)) continue;
      const page = await open({ width, height });
      await play(page, width, false);
      await page.close();
    }
    await writeFile(out("framing.json"), JSON.stringify(report, null, 2) + "\n");
    // Known, and said in the README: on the 320px globe the stories step's four two-line names crowd, and Checkout's hides
    // rather than stray from its island (forest 3.31); the island stands in frame.
    const known = new Set(["320 map-stories Checkout: not drawn"]);
    assert.deepEqual(report.flatMap(item => item.misses.map(miss => `${item.width} ${item.step} ${miss}`)).filter(miss => !known.has(miss)), [], "2.16: every named island stays clear of the header, narration and panels");
    if (widths) { observed.push(`Framing misses: ${JSON.stringify(report.filter(item => item.misses.length))}`); return; }
    const page = await open({ width: 1440, height: 900 }, { video: true });
    await play(page, "clip-1440", true);
    const video = page.video(); await page.close();
    await rm(out("1440-map-chapter.webm"), { force: true });
    await rename(await video.path(), out("1440-map-chapter.webm"));
    for (const name of await readdir(path.join(pictures, `../${to}`))) if (name.startsWith("clip-1440-")) await rm(out(name));
    await writeFile(out("framing.json"), JSON.stringify(report, null, 2) + "\n");
    observed.push(`The map chapter's steps: pictured in ${to}; framing misses: ${JSON.stringify(report.filter(item => item.misses.length).map(item => [item.width, item.step, item.misses]))}`);
  },
  // A clip of the arrival playing at the default 0.75×, pain to fixes.
  async clip() {
    const page = await open({ width: 1440, height: 900 }, { video: true });
    await page.waitForTimeout(500);
    await page.waitForFunction(() => document.querySelector("#chapter2").dataset.tourStep === "map-empty", null, { timeout: 120_000 });
    await page.waitForTimeout(6000);
    const video = page.video(); await page.close();
    const file = await video.path();
    await rm(path.join(pictures, "arrival.webm"), { force: true });
    await rename(file, path.join(pictures, "arrival.webm"));
  },
};
try {
  for (const [name, run] of Object.entries(runs)) if (!only || only === name) { console.log(`run ${name}`); await run(); }
  assert.deepEqual(errors, [], "the browser reports no errors");
  if (!only) await writeFile(path.join(pictures, "observations.json"), JSON.stringify({ contract: "2.11, 2.12", source: "Locally built unpublished working tree, SwiftShader", observed }, null, 2) + "\n");
  console.log(observed.join("\n"));
  if (pictures !== here) console.log(`--check: pictures in ${path.dirname(pictures)}, nothing committed was written`);
} finally {
  await browser.close(); server.close();
  for (const name of await readdir(pictures)) if (name.endsWith(".webm") && name !== "arrival.webm") await rm(path.join(pictures, name));
}
