import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
const stepOf = page => page.locator("#chapter2").getAttribute("data-tour-step");
const holds = page => page.locator("#tour-held").evaluate(node => node.hidden ? "" : node.textContent);
async function goToStep(page, id) { await page.locator(`#tour-pips [data-step="${id}"]`).click(); assert.equal(await stepOf(page), id); }

// Contracts 2.4 and 2.7 with the live globe: exploring holds the tour and says so; play flies back to the step's view.
export async function verifyTourCamera(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  const positions = () => page.locator("#website-forest").evaluate(host => {
    const canvas = host.querySelector("canvas").getBoundingClientRect();
    return [...host.querySelectorAll(".planet-nameplate[data-story-id]")].map(node => ({
      id: node.dataset.storyId, x: Math.round(node.getBoundingClientRect().x - canvas.x), y: Math.round(node.getBoundingClientRect().y - canvas.y),
    }));
  });
  const distance = (from, to) => from.reduce((sum, target) => {
    const actual = to.find(item => item.id === target.id);
    return sum + (actual ? Math.hypot(target.x - actual.x, target.y - actual.y) : 1000);
  }, 0) / Math.max(1, from.length);
  const failures = [];
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live");
    await page.waitForTimeout(3500);
    await goToStep(page, "scale-territories");
    // Arriving from the shop's globe swaps globes first, which takes longer on a loaded machine.
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "storytree" && document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.locator("#tour-play").click();
    const destination = await positions();
    const canvas = await page.locator("#website-forest canvas").boundingBox();
    await page.locator("#tour-play").click();
    await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height / 2);
    await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .8, canvas.y + canvas.height * .65, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
    if (!/explore/i.test(await holds(page))) failures.push(`Exploring the globe should hold the tour and say so; the bar said "${await holds(page)}"`);
    if (await page.locator("#tour-play").getAttribute("aria-label") !== "Play the tour") failures.push("A held tour offers Play");
    const dragged = await positions();
    if (distance(destination, dragged) < 20) failures.push("The drag did not move the globe");
    await page.locator("#tour-play").click();
    await page.waitForTimeout(2600);
    await page.locator("#tour-play").click();
    const resumed = await positions();
    if (distance(destination, resumed) > 5) failures.push(`Play left the camera ${Math.round(distance(destination, resumed))} pixels from the step's view`);
    if (await stepOf(page) !== "scale-territories") failures.push(`Play restarted or moved the step: ${await stepOf(page)}`);
    // 2.9: after the opening, Conduit's globe grows a stage at a time as the lines arrive; the steps at scale and free play are storytree's.
    const globe = () => page.locator(".forest-drawing").evaluate(node => ({ map: node.dataset.globe, stage: node.dataset.stage, islands: Number(node.dataset.islands) }));
    if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
    await goToStep(page, "stories-grow");
    await page.waitForTimeout(1600);
    const empty = await globe();
    if (empty.map !== "conduit" || empty.islands !== 0) failures.push(`Conduit's globe opens empty: ${JSON.stringify(empty)}`);
    await page.waitForTimeout(13000);
    const five = await globe();
    if (five.stage !== "stories" || five.islands !== 5) failures.push(`Its five stories appear as the step is read: ${JSON.stringify(five)}`);
    await goToStep(page, "arcs-grow"); await page.waitForTimeout(2000);
    if ((await globe()).islands !== 12) failures.push(`The backend arc grows it to twelve islands: ${JSON.stringify(await globe())}`);
    await goToStep(page, "scale-files"); await page.waitForTimeout(2500);
    if ((await globe()).map !== "storytree") failures.push("The steps at scale return to storytree's globe");
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
  console.log("PASS contract 2.9: Conduit's globe grows as the tour reads it, then storytree's returns");
  console.log("PASS contracts 2.4 and 2.7: exploring holds the tour and says so; Play flies back to the step's view");
}

// Contracts 2.4–2.8 through the built page and the app's saved-reading surfaces, without WebGL, on a phone.
export async function verifyTour(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen", "yes");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith("webgl") ? null : original.call(this, kind, ...args); };
  });
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.goto(url); await page.locator("#tour-play").waitFor();
  const shown = () => page.locator("#tour-lines .tour-line.on").count();
  // 2.8: one pip per step, grouped by explainer; a pip jumps to its step.
  const pips = await page.locator("#tour-pips [data-go]").count();
  assert.ok(pips >= 20, `one pip per step (${pips})`);
  assert.deepEqual(await page.locator("#tour-pips .tb-group").evaluateAll(groups => groups.map(group => group.dataset.group)),
    ["opening", "stories", "capabilities", "sessions", "arcs", "scale", "knowledge", "ending"]);
  await goToStep(page, "stories-island");
  assert.equal(await page.locator('#tour-pips [data-step="stories-island"]').getAttribute("aria-current"), "step");
  // 2.4: the lines arrive at a readable pace; pause holds them; a faster speed brings the next sooner.
  assert.equal(await shown(), 1);
  await page.locator("#tour-play").click();
  assert.equal(await holds(page), "Paused");
  await page.clock.runFor(15000); assert.equal(await stepOf(page), "stories-island", "Pause holds the step");
  await page.locator("#tour-play").click();
  // A waiting step shows all its lines, so the pace is timed on a fresh step: its first line (9 words) reads for 3.5 s at 1×.
  await page.locator("#tour-speed-cycle").click(); assert.equal(await page.locator("#tour-speed-cycle").textContent(), "1.5×");
  await goToStep(page, "stories-roads"); assert.equal(await shown(), 1);
  await page.clock.runFor(3500); assert.equal(await shown(), 2, "1.5× brings the next line in two thirds of the time");
  await goToStep(page, "stories-island");
  // 2.4, 2.7: depth holds the tour, says why, and Escape returns to the button; play continues the same step.
  await page.locator("#tour-depth").click();
  assert.equal(await holds(page), "Waiting while you read");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H3");
  await page.clock.runFor(30000); assert.equal(await stepOf(page), "stories-island");
  await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => document.activeElement?.id), "tour-depth");
  await page.locator("#tour-everything").click();
  assert.equal(await holds(page), "Showing everything");
  await page.clock.runFor(30000); assert.equal(await stepOf(page), "stories-island");
  await page.locator("#tour-depth").click();
  await page.locator("#tour-play").click();
  assert.equal(await holds(page), "", "Play clears every hold");
  assert.equal(await page.locator("#tour-everything").getAttribute("aria-checked"), "false");
  assert.equal(await stepOf(page), "stories-island", "Play continues the step it stopped in");
  await page.locator("#tour-next").focus(); await page.keyboard.press("Enter");
  assert.equal(await stepOf(page), "stories-roads");
  // 2.5: every explainer reaches its dated, sourced comparison.
  for (const subject of ["stories", "capabilities", "knowledge", "sessions", "arcs"]) {
    await goToStep(page, `${subject}-compare`);
    await page.locator("#tour-play").click(); await page.locator("#tour-play").click();
    const links = await page.locator("#tour-lines a.source").evaluateAll(nodes => nodes.map(node => node.href));
    assert.ok(links.length >= 2 && links.every(href => href.startsWith("https://")), `${subject} keeps sourced comparisons`);
    await page.locator("#tour-depth").click();
    assert.match(await page.locator("#tour-why").textContent(), /Checked against each tool's own documentation on \d+ \w+ \d{4}/);
    await page.locator("#tour-depth").click();
  }
  // The recording plays with the tour's clock and holds with it.
  await goToStep(page, "knowledge-reads");
  const recordingIndex = async () => Number(await page.locator(".tour-recording-progress").getAttribute("data-recording-index"));
  await page.clock.runFor(3500);
  assert.ok(await recordingIndex() > 0 && await recordingIndex() < 287, "The dated recording replays");
  await page.locator("#tour-play").click(); const stopped = await recordingIndex();
  await page.clock.runFor(5000); assert.equal(await recordingIndex(), stopped, "Pause freezes the dated recording");
  await page.locator("#tour-play").click();
  // 2.6: skipping opens dated, read-only free play; the app's surfaces work without WebGL.
  await page.locator("#tour-skip").click();
  assert.equal(await page.locator("#chapter2").getAttribute("data-tour-mode"), "freeplay");
  // 2.13: free play opens on the whole shop; the selector switches it to storytree's own saved project.
  assert.equal(await page.locator("#chapter2").getAttribute("data-globe-map"), "shop");
  assert.match(await page.locator("#tour-label").textContent(), /online shop .* recorded \d+ \w+ \d{4} · read only/);
  assert.equal(await page.locator(".forest-still img").evaluate(node => node.checkVisibility({ visibilityProperty: true })), false, "storytree's still never stands in for the shop");
  await page.clock.runFor(500);
  // 2.14: on the shop, free play opens the shop's own recorded sessions, story panels and arcs.
  assert.equal(await page.locator(".tour-session-surface").evaluate(node => node.hidden), false, "the shop's recorded sessions are shown");
  assert.ok(await page.locator(".session-row").count() > 0, "the shop's sessions are listed");
  await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
  await page.locator("#tour-story-choice").selectOption("story_c3e9a28aef14");
  await page.locator('.story-panel[data-story-id="story_c3e9a28aef14"] .panel-head').waitFor();
  await page.locator(".panel-close").click();
  await page.locator("[data-open-arcs]").click(); await page.locator('[data-arc-scope="closed"]').click();
  assert.match(await page.locator(".arc-lanes").textContent(), /A proper shop/, "the shop's own arcs, closed ones under Closed");
  await page.locator(".arc-lane").last().click(); assert.ok(await page.locator(".arc-briefing").isVisible());
  await page.screenshot({ path: path.join(output, "390-no-webgl-shop-arcs.png") });
  await page.locator('[data-arc-scope="active"]').click(); await page.locator("[data-close-arcs]").click();
  await page.getByRole("button", { name: "storytree", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "storytree", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#chapter2").getAttribute("data-globe-map"), "storytree");
  assert.match(await page.locator("#tour-label").textContent(), /saved \d+ \w+ \d{4} · read only/);
  assert.equal(await page.locator("#website-forest").getAttribute("data-forest-state"), "still");
  await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
  await page.locator("#tour-story-choice").selectOption("story_deee4230348c");
  await page.locator(".panel-tree [data-capability-id]").first().focus(); await page.keyboard.press("Enter");
  await page.locator(".panel-detail").waitFor();
  await page.locator(".panel-close").click();
  await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
  await page.locator("#tour-note-choice").selectOption({ index: 1 });
  await page.locator(".core-card").waitFor(); await page.locator(".core-card button").focus(); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".core-card").count(), 0);
  await page.locator("[data-open-arcs]").click(); await page.locator(".arc-lane").last().click();
  assert.ok(await page.locator(".arc-briefing").isVisible()); await page.locator("[data-close-arcs]").click();
  assert.ok(await page.locator(".session-row").count() > 0, "Saved sessions remain available without WebGL");
  await page.screenshot({ path: path.join(output, "390-no-webgl.png") });
  await page.locator("#tour-hatch").click(); assert.equal(new URL(page.url()).pathname, "/waitlist.html");
  assert.deepEqual(errors, []); await page.close();
  console.log("PASS contracts 2.4–2.8: readable pace, holds that say why, play in place, grouped pips, sourced comparisons, dated free play without WebGL");
}

// Website 2.6, 1.6 and 5.4: the chapter fills the viewport, its controls are reachable and tappable, free play is the desktop's.
export async function verifyImmersive(browser, url, output) {
  const measurements = [];
  for (const width of [1440, 390, 320]) {
    const height = width < 600 ? 844 : 1000;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.locator("#tour-play").waitFor();
    await page.locator("#tour-play").click();
    assert.equal(await page.locator("[data-explainer]").count(), 0, "No chapter category buttons");
    assert.equal(await page.locator(".forest-controls").count(), 0, "The globe uses desktop direct manipulation");
    assert.equal(await page.locator("#waitlist, .explanation").count(), 0, "The chapter contains neither the waitlist form nor the removed explanation");
    const bar = await page.locator("#tour-bar").boundingBox();
    assert.ok(bar.y + bar.height <= height + 1 && bar.y >= height * .7, "The tour bar sits along the bottom of the viewport");
    for (const selector of ["#tour-play", "#tour-next", "#tour-skip", "#tour-replay", "#tour-everything", "#tour-hatch", ...(width < 600 ? ["#tour-speed-cycle"] : [])]) {
      const target = await page.locator(selector).boundingBox();
      if (width < 600) assert.ok(target.height >= 44, `${selector} keeps a 44px touch target at ${width}px`);
      assert.ok(target.x >= 0 && target.x + target.width <= width && target.y + target.height <= height, `${selector} remains inside the viewport at ${width}px`);
    }
    const hatch = await page.locator("#tour-hatch").boundingBox();
    const pipCount = await page.locator("#tour-pips [data-go]").count();
    for (const selector of ["#tour-next", "#tour-skip", "#tour-replay", "#tour-everything", ...Array.from({ length: pipCount }, (_, index) => `#tour-pips [data-go="${index}"]`)]) {
      const target = await page.locator(selector).boundingBox();
      const overlap = Math.max(0, Math.min(hatch.x + hatch.width, target.x + target.width) - Math.max(hatch.x, target.x)) * Math.max(0, Math.min(hatch.y + hatch.height, target.y + target.height) - Math.max(hatch.y, target.y));
      assert.equal(overlap, 0, `The waitlist hatch never covers ${selector} at ${width}px`);
    }
    const chapter = await page.locator("#chapter2").boundingBox();
    const globe = await page.locator("#website-forest").boundingBox();
    assert.ok(globe.width >= width * .95 && globe.height >= height * .95, "The globe occupies the viewport");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No sideways scroll");
    await page.screenshot({ path: path.join(output, `tour-${width}.png`) });
    await page.locator("#tour-skip").click();
    await page.locator(".forest-views").waitFor();
    assert.equal(await page.locator("#chapter2").getAttribute("data-tour-mode"), "freeplay");
    assert.equal(await page.locator(".tour-card").isVisible(), false, "Free play clears the guide card");
    // 2.13: it opens on the whole shop; the selector is small, inside the viewport, and switches to storytree's own.
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "shop");
    assert.equal(await page.locator(".forest-drawing").getAttribute("data-growth"), "whole");
    const selector = await page.locator("#tour-project").boundingBox();
    assert.ok(selector.x >= 0 && selector.x + selector.width <= width && selector.y >= 0, `The project selector is inside the viewport at ${width}px`);
    for (const button of await page.locator("#tour-project button").all()) if (width < 600) assert.ok((await button.boundingBox()).height >= 44, "The selector keeps 44px touch targets");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(output, `freeplay-shop-${width}.png`) });
    // 2.14: an island of the shop opens its story panel, read from the shop's saved growth.
    await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
    await page.locator("#tour-story-choice").selectOption("story_c3e9a28aef14");
    await page.locator('.story-panel[data-story-id="story_c3e9a28aef14"] .panel-head').waitFor();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(output, `freeplay-shop-story-${width}.png`) });
    await page.locator(".panel-close").click();
    await page.getByRole("button", { name: "storytree", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "storytree");
    await page.getByRole("button", { name: "Library", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Library", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Forest", exact: true }).click();
    await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
    await page.locator("#tour-story-choice").selectOption({ index: 1 });
    await page.locator(".story-panel .panel-head").waitFor();
    if (width > 900) {
      await page.locator("[data-open-tree]").click();
      const large = await page.locator(".tree-space").boundingBox();
      const side = await page.locator(".story-panel").boundingBox();
      assert.ok(large.x + large.width <= side.x, "The expanded capability tree sits beside the story panel");
      await page.locator(".tree-space-close").click();
    }
    const panel = await page.locator(".story-panel").boundingBox();
    assert.ok(panel.x + panel.width <= width && panel.y + panel.height <= height, "The story panel is inside the viewport");
    assert.ok(await page.locator(".story-panel .panel-head").evaluate(head => {
      const box = head.getBoundingClientRect();
      return head.contains(document.elementFromPoint(box.x + 24, box.y + box.height / 2));
    }), `Nothing covers the story panel's title at ${width}px`);
    await page.screenshot({ path: path.join(output, `story-${width}.png`) });
    await page.locator(".panel-close").click();
    assert.equal(await page.locator(".story-panel").count(), 0, "Close returns to unobscured free play");
    measurements.push({ width, chapter, globe, bar, panel });
    await page.screenshot({ path: path.join(output, `immersive-${width}.png`) });
    await page.locator("#tour-hatch").click();
    assert.equal(new URL(page.url()).pathname, "/waitlist.html");
    await page.locator("#waitlist-form").waitFor();
    await page.screenshot({ path: path.join(output, `waitlist-${width}.png`), fullPage: true });
    await page.close();
  }
  await writeFile(path.join(output, "immersive-measurements.json"), JSON.stringify({ source: "Locally built unpublished working tree", viewports: measurements }, null, 2) + "\n");
  console.log(JSON.stringify(measurements));
}

// The recording follows the tour's speed, and a step's depth stays readable above the app's drawers.
export async function verifyRecordingFreeplay(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen", "yes");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith("webgl") ? null : original.call(this, kind, ...args); };
  });
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.goto(url); await page.locator("#tour-play").waitFor();
  await goToStep(page, "knowledge-reads");
  const at = async () => Number(await page.locator(".tour-recording-progress").getAttribute("data-recording-index"));
  await page.clock.runFor(2000); const slow = await at();
  await page.locator("#tour-speed-cycle").click();
  await page.clock.runFor(2000); assert.ok(await at() - slow >= 2, "1.5× plays the recording faster");
  await page.screenshot({ path: path.join(output, "recording-390.png") });
  for (const step of ["stories-compare", "scale-questions"]) {
    await goToStep(page, step);
    await page.locator("#tour-depth").click();
    await page.locator(".tour-back").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".tour-back").evaluate(button => { const box = button.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button; }), true, "A step's depth stays above comparisons and the arc drawer");
    await page.locator(".tour-back").click();
  }
  await page.locator("#tour-skip").click();
  assert.equal(await at(), Number(await page.locator(".tour-recording-progress").getAttribute("data-recording-total")), "Free play shows the recording's end");
  await page.close();
  console.log("PASS: the recording follows the tour's speed and holds; depth stays readable above the app's drawers");
}
