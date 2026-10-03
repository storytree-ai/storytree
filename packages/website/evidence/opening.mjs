import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const counter = page => page.evaluate(() => [...document.querySelectorAll("#opening-count span")].map(span => span.textContent));
const run = page => page.getByRole("button", { name: "Run", exact: true });
const better = page => page.getByRole("button", { name: "show me where to look" });
const peak = ["AGENTS: 12 ▲", "WAITING ON YOU: 12", "ANSWERED: 00"];

// Contracts 2.3 and 2.10: measure real page frames with the globe below the fold, then prove its handover.
// The caller launches SwiftShader explicitly; no virtual clock or hidden chapter changes the load.
export async function verifyOpeningFrames(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    // Playing is Run to the finale: the swarm until every helper waits on the visitor, then the quiet before the finale.
    window.openingFrames = { ready: [], playing: [], swarm: [], quiet: [] };
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
    // When chapter 1 hands the screen to chapter 2: from here the globe should draw at once.
    window.addEventListener("storytree-opening", event => { if (!event.detail.active && window.runAt) window.handoverAt ??= performance.now(); });
    let last;
    const frame = now => {
      if (last !== undefined) {
        window.openingFrames[window.runAt ? "playing" : "ready"].push(now - last);
        if (window.runAt && !window.finaleAt) window.openingFrames[window.parkedAt ? "quiet" : "swarm"].push(now - last);
      }
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.addEventListener("click", event => {
      if (event.target.id !== "opening-run") return;
      window.runAt = performance.now(); last = undefined;
      window.beforeRun = {
        activations: performance.getEntriesByName("forest-activate").length,
        sceneRequested: performance.getEntriesByType("resource").some(entry => /forest-scene-[^/]*\.js$/.test(entry.name)),
      };
    }, true);
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
  try {
    await page.goto(url);
    await run(page).waitFor();
    await page.waitForTimeout(2500);
    await run(page).click();
    await better(page).waitFor({ timeout: 45000 });
    const measured = await page.evaluate(() => {
      const summarize = values => {
        const sorted = [...values].sort((a, b) => a - b);
        const elapsedMs = values.reduce((a, b) => a + b, 0);
        return { frames: values.length, elapsedMs, fps: values.length * 1000 / elapsedMs, p95FrameMs: sorted[Math.floor(sorted.length * .95)] };
      };
      const activated = performance.getEntriesByName("forest-activate").at(0)?.startTime;
      return {
        viewport: [innerWidth, innerHeight], renderer: "SwiftShader",
        ready: summarize(window.openingFrames.ready), playing: summarize(window.openingFrames.playing),
        swarm: summarize(window.openingFrames.swarm), quiet: summarize(window.openingFrames.quiet),
        finaleMs: window.finaleAt - window.runAt,
        parkedAfterRunMs: window.parkedAt - window.runAt,
        activatedAfterRunMs: activated === undefined ? null : activated - window.runAt,
        beforeRun: window.beforeRun,
        activationCount: performance.getEntriesByName("forest-activate").length,
        sceneRequested: performance.getEntriesByType("resource").some(entry => /forest-scene-[^/]*\.js$/.test(entry.name)),
        mountedLayers: document.querySelectorAll("#website-forest .forest-canvas").length,
        forestState: document.querySelector("#website-forest").dataset.forestState,
        globeDraws: window.globeDraws,
      };
    });
    await writeFile(path.join(output, "opening-frames.json"), JSON.stringify(measured, null, 2) + "\n");
    console.log(JSON.stringify(measured));
    assert.deepEqual(measured.beforeRun, { activations: 0, sceneRequested: false }, "website 2.3: nothing about the globe starts or is requested before Run");
    assert.equal(measured.activationCount, 1, "website 2.10: Run starts the globe while Chapter 1 plays");
    assert.ok(measured.activatedAfterRunMs >= measured.parkedAfterRunMs, "website 2.10: the globe starts only once every helper waits on the visitor, so its setup stalls none of the swarm");
    assert.equal(measured.mountedLayers, 1, "website 2.10: one globe is mounted below Chapter 1");
    assert.equal(measured.forestState, "live", "website 2.10: the globe is live before the turn");
    assert.equal(measured.globeDraws, 0, "website 2.10: the globe draws nothing while Chapter 1 plays");
    await better(page).click();
    await page.waitForFunction(() => window.firstDrawAfterHandover !== undefined && document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 30000 });
    Object.assign(measured, await page.evaluate(() => ({
      handoverToFirstDrawMs: window.firstDrawAfterHandover - window.handoverAt,
      loadMs: performance.getEntriesByName("forest-ready").at(-1).startTime - performance.getEntriesByName("forest-activate").at(-1).startTime,
      activationsAfterHandover: performance.getEntriesByName("forest-activate").length,
    })));
    await writeFile(path.join(output, "opening-frames.json"), JSON.stringify(measured, null, 2) + "\n");
    console.log(JSON.stringify({ handoverToFirstDrawMs: measured.handoverToFirstDrawMs, loadMs: measured.loadMs }));
    assert.equal(measured.activationsAfterHandover, 1, "website 2.10: the turn lands on the globe Run started, with no second load");
    await page.waitForTimeout(3000); // Let the first camera flight arrive before its picture.
    await page.screenshot({ path: path.join(output, "handover-1440.png") });
    await page.getByRole("button", { name: "Replay chapter 1" }).click();
    assert.equal(await page.locator("#website-forest .forest-canvas").count(), 0, "website 2.3: replay releases the globe while Chapter 1 is visible");
    await page.evaluate(() => scrollTo(0, document.querySelector("#opening").offsetHeight + 40));
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 30000 });
    assert.equal(await page.locator("#website-forest .forest-canvas").count(), 1, "website 2.3: scroll remounts one globe");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 30000 });
  } finally { await page.close(); }
  // Without IntersectionObserver the globe cannot tell it is off screen, so even Run leaves it until the handover.
  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requested;
  const request = new Promise(resolve => { requested = resolve; });
  try {
    await fallback.addInitScript(() => { delete window.IntersectionObserver; });
    await fallback.route(/forest-scene-[^/]*\.js$/, async route => { requested(); await held; await route.continue(); });
    await fallback.goto(url);
    await run(fallback).click();
    await fallback.waitForTimeout(1500);
    assert.equal(await fallback.locator("#website-forest .forest-canvas").count(), 0, "website 2.10: without IntersectionObserver, Run does not start a globe that could not pause");
    await fallback.getByRole("button", { name: "skip intro" }).click();
    await request;
    await fallback.getByRole("button", { name: "Replay chapter 1" }).click();
    release();
    await fallback.waitForTimeout(1500);
    assert.equal(await fallback.locator("#website-forest .forest-canvas").count(), 0, "website 2.3: a scene arriving after Replay cannot mount");
    await fallback.getByRole("button", { name: "skip intro" }).click();
    await fallback.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 30000 });
    await fallback.waitForTimeout(3000);
    await fallback.screenshot({ path: path.join(output, "handover-390.png") });
  } finally { release(); await fallback.close(); }
  console.log("PASS contracts 2.3 and 2.10: nothing before Run, a warm globe drawing nothing in Chapter 1, live handover, replay, scroll, return and no-observer fallback");
}

// ADR-0879 D6: nothing may overflow sideways and no window may cover the HUD row, at any size or zoom.
async function assertFits(page, label) {
  const result = await page.evaluate(() => {
    const hud = document.querySelector(".opening-hud").getBoundingClientRect();
    const covering = [...document.querySelectorAll("#opening .opening-window")]
      .filter(window => !window.hidden && getComputedStyle(window).display !== "none")
      .filter(window => window.getBoundingClientRect().top < hud.bottom - 1)
      .map(window => window.id || window.dataset.agent);
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, covering };
  });
  assert.ok(result.scrollWidth <= result.innerWidth, `${label}: no horizontal scroll (${result.scrollWidth} > ${result.innerWidth})`);
  assert.deepEqual(result.covering, [], `${label}: no window covers the HUD row`);
}

// Contract 1.8: exercise the built page, including its real timers and storage.
export async function verifyOpening(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audioStarts = 0;
    // Page time, not the harness round trips, measures how long Run takes to reach the finale.
    document.addEventListener("click", event => { if (event.target.id === "opening-run") window.runAt = performance.now(); }, true);
    // When each helper's window opens, in page time after Run: the pace of the swarm.
    window.spawns = [];
    document.addEventListener("DOMContentLoaded", () => new MutationObserver(records => {
      for (const record of records) if (window.runAt && !record.target.hidden && record.oldValue !== null) window.spawns.push(performance.now() - window.runAt);
    }).observe(document.getElementById("opening-agents"), { subtree: true, attributes: true, attributeFilter: ["hidden"], attributeOldValue: true }));
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { window.audioStarts++; return start.apply(this, args); };
    // Streamed lines arrive in several chunks: count how many times each line's text changed.
    window.maxLineChanges = 0;
    document.addEventListener("DOMContentLoaded", () => {
      const lengths = new WeakMap(); const changes = new WeakMap();
      const note = p => {
        const length = p.textContent.length;
        if (lengths.has(p) && lengths.get(p) !== length) { const n = (changes.get(p) ?? 0) + 1; changes.set(p, n); window.maxLineChanges = Math.max(window.maxLineChanges, n); }
        lengths.set(p, length);
      };
      new MutationObserver(records => {
        for (const record of records) {
          record.addedNodes.forEach(node => { if (node.nodeName === "P") note(node); });
          const element = record.target.nodeType === 3 ? record.target.parentElement : record.target;
          const p = element?.closest?.("#opening .opening-lines p");
          if (p) note(p);
        }
      }).observe(document.getElementById("opening"), { subtree: true, childList: true, characterData: true });
    });
  });
  await page.goto(url);
  await run(page).waitFor({ timeout: 2500 });
  assert.equal(await page.locator("#opening-count").isVisible(), false, "The counter appears only after Run");
  assert.ok(await page.locator("#opening .opening-wordmark").isVisible(), "The first screen still says storytree");
  assert.equal(await page.locator("#opening a:visible").count(), 0, "No website chrome: the first screen has no links");
  await page.screenshot({ path: path.join(output, "1440-ready.png") });
  await run(page).tap();
  assert.deepEqual(await counter(page), ["AGENTS: 01", "WAITING ON YOU: 00", "ANSWERED: 00"], "One agent is singular: two digits, no arrow");
  await better(page).waitFor({ timeout: 50000 });
  const elapsed = await page.evaluate(() => performance.now() - window.runAt);
  // ADR-0888 1.2-1.3: 0.2's escalating clock. About 4 s of thinking, the first helpers far apart so their
  // lines read whole, then a frantic pile-up; the last helper parks at about 33 s.
  const spawns = await page.evaluate(() => window.spawns);
  const gaps = spawns.slice(1).map((at, i) => at - spawns[i]);
  console.log(`spawns: ${spawns.map(at => (at / 1000).toFixed(1)).join(", ")} s; finale actions at ${(elapsed / 1000).toFixed(1)} s`);
  assert.equal(spawns.length, 11, "Eleven helpers open");
  assert.ok(spawns[0] >= 3500 && spawns[0] < 4800, `The lead agent thinks for about 4 seconds before the first helper (${Math.round(spawns[0])} ms)`);
  assert.ok(gaps[0] >= 3500, `The first helpers open about 4 seconds apart (${Math.round(gaps[0])} ms)`);
  assert.ok(gaps.at(-1) < 1600, `The last helpers pile up about a second apart (${Math.round(gaps.at(-1))} ms)`);
  assert.ok(elapsed >= 36000 && elapsed < 46000, `One tap reaches the finale's choice in about 40 seconds (took ${Math.round(elapsed)} ms)`);
  assert.deepEqual(await counter(page), peak);
  assert.ok(await page.evaluate(() => window.maxLineChanges) >= 2, "Lines stream in chunks, not whole");
  assert.equal(await page.evaluate(() => window.audioStarts), 0, "Silent until explicitly enabled");
  await assertFits(page, "1440 peak");
  await page.screenshot({ path: path.join(output, "1440-peak.png") });
  for (const [width, height, name] of [[1280, 720, "1280"], [390, 844, "390"], [320, 640, "320"], [640, 450, "1280-at-200pct"], [195, 422, "390-at-200pct"]]) {
    await page.setViewportSize({ width, height });
    await assertFits(page, `${name} peak`);
    if (name === "390") await page.screenshot({ path: path.join(output, "390-peak.png") });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "sound off" }).click();
  assert.equal(await page.getByRole("button", { name: "sound on" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "i'll keep babysitting" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#opening-count span")[1].textContent === "WAITING ON YOU: 15");
  assert.deepEqual(await counter(page), ["AGENTS: 15 ▲", "WAITING ON YOU: 15", "ANSWERED: 00"]);
  await better(page).waitFor();
  assert.ok(await page.evaluate(() => window.audioStarts) > 0);
  await page.getByRole("button", { name: "restart chapter 1" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "opening-run", "website 1.8: restarting returns keyboard focus to Run");
  await page.keyboard.press("Enter");
  await better(page).waitFor({ timeout: 50000 });
  // ADR-0879 D6: the turn is a CRT switching off: windows, then a line, then a point, inside ~1.4 seconds.
  const turn = await page.evaluate(() => new Promise(resolve => {
    const root = document.querySelector("#opening"); const seen = []; const t0 = performance.now();
    new MutationObserver(() => {
      const phase = root.dataset.crt;
      if (phase && seen.at(-1)?.[0] !== phase) seen.push([phase, Math.round(performance.now() - t0)]);
      if (root.hidden) resolve({ seen, total: performance.now() - t0 });
    }).observe(root, { attributes: true, attributeFilter: ["data-crt", "hidden"] });
    document.getElementById("opening-better").click();
  }));
  assert.deepEqual(turn.seen.map(step => step[0]), ["line", "point"], "The screen collapses to a line, then to a point");
  assert.ok(turn.total < 1500, `The turn takes under 1.5 seconds (took ${Math.round(turn.total)} ms)`);
  console.log(`turn: line at ${turn.seen[0][1]} ms, point at ${turn.seen[1][1]} ms, handed over at ${Math.round(turn.total)} ms; finale reached ${Math.round(elapsed)} ms after Run`);
  assert.equal(page.url(), url, "The turn does not navigate or change the hash");
  assert.ok(await page.locator("#website-forest").evaluate(el => el.getBoundingClientRect().top < innerHeight));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "opening-run", "Replay returns keyboard focus to the scene");
  await run(page).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  await page.getByRole("button", { name: "skip intro" }).click();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  await run(page).click();
  await page.evaluate(() => scrollTo(0, document.querySelector("#opening").offsetHeight + 40));
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  assert.deepEqual(errors, []);
  await page.close();

  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: "reduce" }]) {
    const still = await browser.newPage({ ...options, viewport: { width: 390, height: 844 } });
    await still.goto(url);
    assert.deepEqual(await counter(still), peak);
    assert.ok(await still.locator("#opening-count").isVisible());
    assert.ok(await still.getByText("want me to show you?", { exact: true }).isVisible());
    assert.equal(await run(still).isVisible(), false);
    await still.screenshot({ path: path.join(output, options.javaScriptEnabled === false ? "390-no-script.png" : "390-reduced-motion.png") });
    if (options.reducedMotion) {
      assert.equal(await still.evaluate(() => document.querySelector("#opening").getAnimations({ subtree: true }).length), 0);
      await still.clock.install();
      await still.emulateMedia({ reducedMotion: "no-preference" });
      await run(still).click();
      await still.clock.fastForward(46000);
      await better(still).click();
      await still.emulateMedia({ reducedMotion: "reduce" });
      await still.waitForFunction(() => document.querySelector("#opening").dataset.phase === "peak");
      assert.equal(await still.evaluate(() => document.querySelector("#opening").getAnimations({ subtree: true }).length), 0, "Changing motion preference cancels the collapse");
      assert.equal(await still.locator("#opening-finale").evaluate(el => getComputedStyle(el).opacity), "1");
      // Reduced motion: the turn hands over at once, with no animation on the globe.
      await better(still).click();
      assert.equal(await still.evaluate(() => document.querySelector("#opening").hidden), true, "Reduced motion goes straight to chapter 2");
      assert.equal(await still.evaluate(() => document.getElementById("website-forest").getAnimations().length), 0);
    }
    await still.close();
  }
  const denied = await browser.newPage();
  await denied.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage denied"); } }));
  await denied.goto(url);
  await denied.getByRole("button", { name: "skip intro" }).click();
  await denied.waitForFunction(() => document.querySelector("#opening").hidden);
  await denied.close();
  console.log("PASS contract 1.8: playback, joke, turn, exits, sound, storage, static fallbacks");
}
