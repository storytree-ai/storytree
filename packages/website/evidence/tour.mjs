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
    await goToStep(page, "knowledge-shelves");
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
    if (await stepOf(page) !== "knowledge-shelves") failures.push(`Play restarted or moved the step: ${await stepOf(page)}`);
    const globe = () => page.locator(".forest-drawing").evaluate(node => ({ map: node.dataset.globe, islands: Number(node.dataset.islands) }));
    if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
    // 2.12: from the fixes, the map chapter swaps storytree's globe for the shop's point at once, with no pull back and dive,
    // and the empty globe swells with no story on it.
    const drawn = () => page.locator(".forest-drawing").evaluate(node => ({ map: node.dataset.globe, growth: node.dataset.growth, risen: Number(node.dataset.risen) }));
    const risen = () => page.locator(".forest-drawing").evaluate(node => Number(node.dataset.risen));
    const lines = count => page.waitForFunction(count => document.querySelectorAll("#tour-lines .tour-line.on").length === count, count, { timeout: 45_000 });
    const step = id => page.waitForFunction(id => document.querySelector("#chapter2").dataset.tourStep === id, id, { timeout: 45_000 });
    // Signing in's name, where it stands on the screen: the camera's view, read from the drawing.
    const signingIn = async () => (await positions()).filter(plate => plate.id === "story_d263ef0f3f72");
    // Where it stands once the camera has stopped: two looks 400 ms apart agree.
    const settled = async () => {
      let look = await signingIn();
      for (let tries = 0; tries < 20; tries++) { await page.waitForTimeout(400); const again = await signingIn(); if (distance(look, again) < 1) return again; look = again; }
      return look;
    };
    await goToStep(page, "fixes");
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.globe === "own" && document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
    await goToStep(page, "map-empty");
    await page.waitForTimeout(250);
    const swapped = await drawn();
    if (swapped.map !== "shop" || !(Number(swapped.growth) < 1)) failures.push(`The shop's point replaces storytree's globe at once: ${JSON.stringify(swapped)}`);
    await page.waitForTimeout(3000);
    if ((await drawn()).risen !== 0) failures.push(`The empty globe carries no story yet: ${JSON.stringify(await drawn())}`);
    await page.waitForFunction(() => document.querySelector(".forest-drawing")?.dataset.arrived === "true", null, { timeout: 30_000 });
    const empty = await settled();
    // 2.16: the arcs panel opens over the bare globe, on the same view.
    await step("map-arcs");
    await page.waitForTimeout(1500);
    if (await page.locator(".tour-arc-surface").evaluate(node => node.hidden)) failures.push("The arcs panel opens over the bare globe");
    if (await risen() !== 0) failures.push(`The globe stays bare while the arcs are shown: ${await risen()}`);
    // 2.16: each island rises as it is named, signing in first, on the same view; then all four, with their pathways.
    await step("map-stories");
    const counts = new Set();
    for (let look = 0; look < 60 && await stepOf(page) === "map-stories" && await risen() < 4; look++) { counts.add(await risen()); await page.waitForTimeout(250); }
    counts.add(await risen());
    if (![1, 2, 4].every(count => counts.has(count))) failures.push(`The islands rise one by one as they are named: ${[...counts]}`);
    await lines(2);
    const stories = await settled();
    if (distance(empty, stories) > 6) failures.push(`The first three steps keep one view: ${JSON.stringify({ empty, stories })}`);
    // 2.16: the camera flies into signing in as capabilities are named; the dots, then the panel, follow with no move.
    await step("map-capabilities");
    await page.waitForTimeout(3500);
    const inside = await settled();
    if (distance(stories, inside) < 30) failures.push(`The camera flies into signing in for its capabilities: ${JSON.stringify({ stories, inside })}`);
    assert.equal(await page.locator(".story-panel").count(), 0, "2.16: the capabilities and their dots arrive before the panel");
    await lines(3);
    await page.locator(".story-panel").waitFor({ state: "visible" });
    assert.match(await page.locator(".story-panel").textContent(), /Signing in.*Session/s, "2.16: the real story panel opens on the third line");
    if (distance(inside, await signingIn()) > 6) failures.push(`The panel opens with no camera move: ${JSON.stringify({ inside, now: await signingIn() })}`);
    // 2.16: back to the four stories for the claims; the arcs panel, then the sessions list, on their lines.
    await step("map-claims");
    await page.waitForTimeout(3500);
    // Signing in is drawn smaller and reshaped once its code lands, so its name, below its coast, rises and shifts a little;
    // a camera left at the close-up would leave it hundreds of pixels away.
    const back = await settled();
    if (distance(stories, back) > 40) failures.push(`The claims step returns to the four stories' view: ${JSON.stringify({ stories, back })}`);
    if (!(await page.locator(".tour-arc-surface").evaluate(node => node.hidden)) || !(await page.locator(".tour-session-surface").evaluate(node => node.hidden))) failures.push("The flags are shown before any panel");
    await lines(2); await page.waitForTimeout(400);
    if (await page.locator(".tour-arc-surface").evaluate(node => node.hidden)) failures.push("The arcs panel opens on the claims step's second line");
    await lines(3); await page.waitForTimeout(400);
    if (await page.locator(".tour-session-surface").evaluate(node => node.hidden) || !(await page.locator(".tour-arc-surface").evaluate(node => node.hidden))) failures.push("The arcs panel gives way to the sessions list on the third line");
    // 2.16: health keeps the first round's four stories, and the chapter ends on them: the second round never rises.
    await step("map-health");
    await page.waitForTimeout(800);
    if (await risen() !== 4) failures.push("Health opens on the first round's four stories");
    await page.waitForTimeout(15_000);
    if (await risen() !== 4) failures.push(`The chapter stays on the four stories: ${await risen()}`);
    await goToStep(page, "knowledge-kinds"); await page.waitForTimeout(2500);
    if ((await globe()).map !== "storytree") failures.push("The knowledge steps return to storytree's globe");
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
  console.log("PASS contract 2.16: the map chapter keeps its globe bare under the arcs, raises its islands one by one, flies into signing in and back for the claims, opens each panel on its line and stays on its four stories, then storytree's returns");
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
  const rows = () => page.locator(".tour-session-surface .session-row").allTextContents();
  // 2.8: one pip per step, grouped by explainer; a pip jumps to its step.
  const pips = await page.locator("#tour-pips [data-go]").count();
  assert.equal(pips, 16, "one pip per step, with six in the map chapter");
  assert.deepEqual(await page.locator("#tour-pips .tb-group").evaluateAll(groups => groups.map(group => group.dataset.group)),
    ["opening", "map", "knowledge", "ending"]);
  await goToStep(page, "map-capabilities");
  assert.equal(await page.locator('#tour-pips [data-step="map-capabilities"]').getAttribute("aria-current"), "step");
  // 2.4: the lines arrive at a readable pace; pause holds them; a faster speed brings the next sooner.
  assert.equal(await shown(), 1);
  await page.locator("#tour-play").click();
  assert.equal(await holds(page), "Paused");
  await page.clock.runFor(15000); assert.equal(await stepOf(page), "map-capabilities", "Pause holds the step");
  await page.locator("#tour-play").click();
  // A waiting step shows all its lines, so the pace is timed on a fresh step: its first line reads for about 7.7 s at 1×.
  assert.equal(await page.locator("#tour-speed-cycle").textContent(), "0.75×", "Act 2 arrives at 0.75×");
  await page.locator("#tour-speed-cycle").click(); await page.locator("#tour-speed-cycle").click(); assert.equal(await page.locator("#tour-speed-cycle").textContent(), "1.5×");
  await goToStep(page, "map-claims"); assert.equal(await shown(), 1);
  await page.clock.runFor(5500); assert.equal(await shown(), 2, "1.5× brings the next line in two thirds of the time");
  await goToStep(page, "map-capabilities");
  // 2.4, 2.7: depth holds the tour, says why, and Escape returns to the button; play continues the same step.
  await page.locator("#tour-depth").click();
  assert.equal(await holds(page), "Waiting while you read");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H3");
  await page.clock.runFor(30000); assert.equal(await stepOf(page), "map-capabilities");
  await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => document.activeElement?.id), "tour-depth");
  await page.locator("#tour-everything").click();
  assert.equal(await holds(page), "Showing everything");
  await page.clock.runFor(30000); assert.equal(await stepOf(page), "map-capabilities");
  await page.locator("#tour-depth").click();
  await page.locator("#tour-play").click();
  assert.equal(await holds(page), "", "Play clears every hold");
  assert.equal(await page.locator("#tour-everything").getAttribute("aria-checked"), "false");
  assert.equal(await stepOf(page), "map-capabilities", "Play continues the step it stopped in");
  await page.locator("#tour-next").focus(); await page.keyboard.press("Enter");
  assert.equal(await stepOf(page), "map-claims");
  // 2.16: the map chapter's depth is How and Why, never decision numbers; its last step offers the dated, sourced comparison.
  for (const id of await page.locator("#tour-pips [data-step]").evaluateAll(pips => pips.map(pip => pip.dataset.step).filter(id => id.startsWith("map-")))) {
    await goToStep(page, id);
    await page.locator("#tour-depth").click();
    const depth = await page.locator("#tour-why").textContent();
    assert.match(depth, /How it works.*Why it exists/s, `${id}: its depth explains how and why`);
    assert.doesNotMatch(depth, /ADR-\d/, `${id}: its depth names no decision numbers`);
    await page.locator("#tour-depth").click();
  }
  await page.locator("#tour-depth").click();
  const compared = await page.locator("#tour-why a.source").evaluateAll(nodes => nodes.map(node => node.href));
  assert.ok(compared.length >= 2 && compared.every(href => href.startsWith("https://")), "the map chapter's last step offers sourced comparisons");
  assert.match(await page.locator("#tour-why").textContent(), /Checked against each tool's own documentation on \d+ \w+ \d{4}/);
  await page.screenshot({ path: path.join(output, "390-map-depth.png") });
  await page.locator("#tour-depth").click();
  // 2.16: the arcs step opens the shop's first arc over the bare globe, its four parts none held yet.
  await goToStep(page, "map-arcs"); await page.clock.runFor(500);
  assert.equal(await page.locator(".tour-arc-surface").evaluate(node => node.hidden), false, "the arcs panel is open");
  await page.locator(".arc-lanes").waitFor();
  assert.match(await page.locator(".arc-lanes").textContent(), /Swag Labs copy/, "the shop's own first arc");
  await page.screenshot({ path: path.join(output, "390-map-arcs.png") });
  // 2.16: the claims step opens the arcs on its second line and the sessions list on its third, with the three sessions live then.
  await goToStep(page, "map-claims");
  if (await page.locator("#tour-play").getAttribute("aria-label") === "Play the tour") await page.locator("#tour-play").click();
  await page.clock.runFor(500);
  assert.equal(await page.locator(".tour-session-surface").evaluate(node => node.hidden), true, "the sessions list waits for its line");
  assert.equal(await page.locator(".tour-arc-surface").evaluate(node => node.hidden), true, "so does the arcs panel");
  for (let tick = 0; tick < 160 && await shown() < 2; tick++) await page.clock.runFor(250);
  assert.equal(await page.locator(".tour-arc-surface").evaluate(node => node.hidden), false, "the arcs panel opens on the second line");
  for (let tick = 0; tick < 160 && await shown() < 3; tick++) await page.clock.runFor(250);
  assert.equal(await stepOf(page), "map-claims");
  assert.equal(await page.locator(".tour-session-surface").evaluate(node => node.hidden), false, "the sessions list is open");
  assert.equal(await page.locator(".tour-arc-surface").evaluate(node => node.hidden), true, "and the arcs panel has given way to it");
  const live = await rows();
  for (const name of ["Part 2: product page, sorting, cart", "Part 4: Checkout"]) assert.ok(live.some(row => row.includes(name)), `the list lists ${name}: ${live}`);
  assert.equal(live.length, 3, `three live sessions: ${live}`);
  await page.screenshot({ path: path.join(output, "390-map-claims-sessions.png") });
  await page.locator("#tour-depth").click();
  const agentsCompared = await page.locator("#tour-why a.source").evaluateAll(nodes => nodes.map(node => node.href));
  assert.ok(agentsCompared.length >= 3, "the claims step's depth keeps the comparison with Cursor, LangSmith and Linear");
  await page.locator("#tour-depth").click();
  // 2.5: the knowledge explainer reaches its dated, sourced comparison.
  for (const subject of ["knowledge"]) {
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
  // At the recording's end every shop session has finished: none is live, and History lists them.
  assert.match(await page.locator(".tour-session-surface #sessions-body").textContent(), /No running sessions/, "the shop's sessions are at rest at its end");
  await page.locator(".tour-session-surface").getByRole("tab", { name: "History" }).click();
  assert.ok(await page.locator(".tour-session-surface .history-row").count() > 0, "History lists the shop's sessions");
  await page.locator(".tour-session-surface").getByRole("tab", { name: "Live" }).click();
  await page.getByRole("button", { name: "Find a story or note in the saved project", exact: true }).click();
  await page.locator("#tour-story-choice").selectOption("story_2de9e8f4db21");
  await page.locator('.story-panel[data-story-id="story_2de9e8f4db21"] .panel-head').waitFor();
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
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
// 2.16's framing, at every width: no island's name shown in the map chapter, as it plays through, hides under the heading or
// the dated note above the globe.
async function verifyNamesClearHeader(page, width, output) {
  const map = ["map-empty", "map-arcs", "map-stories", "map-capabilities", "map-claims", "map-health"];
  await goToStep(page, map[0]);
  await page.locator('#tour-bar [data-speed="1.5"]').evaluate(button => button.click());
  if (await page.locator("#tour-play").getAttribute("aria-label") !== "Pause the tour") await page.locator("#tour-play").click();
  const seen = new Set();
  for (let step = await stepOf(page); map.includes(step); step = await stepOf(page)) {
    const { header, plates } = await page.evaluate(() => {
      const box = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      return {
        header: [...document.querySelectorAll("#chapter2 :is(.tour-heading, .tour-note)")].filter(node => node.getBoundingClientRect().width).map(box),
        // A name under the claims step's open arcs panel or sessions list is covered by it, not read: those lines name no island.
        plates: (() => {
          const panels = [...document.querySelectorAll(".tour-session-surface:not([hidden]) .sessions-list, .tour-arc-surface:not([hidden]) .arc-overlay")].map(node => node.getBoundingClientRect()).filter(box => box.width);
          const under = plate => panels.some(list => plate.x < list.right && list.left < plate.x + plate.width && plate.y < list.bottom && list.top < plate.y + plate.height);
          return [...document.querySelectorAll("#website-forest .planet-nameplate[data-story-id]:not(.crowded)")]
            .filter(node => getComputedStyle(node).visibility === "visible" && Number(getComputedStyle(node).opacity) > 0)
            .map(node => ({ text: node.textContent, ...box(node) })).filter(plate => plate.width && !under(plate));
        })(),
      };
    });
    for (const plate of plates) for (const above of header) if (overlap(plate, above) > 0) {
      await page.screenshot({ path: path.join(output, `names-${step}-${width}.png`) });
      assert.fail(`${plate.text}'s name is clear of the heading on the ${step} step at ${width}px: ${JSON.stringify({ plate, above })}`);
    }
    if (!seen.has(step)) { seen.add(step); await page.screenshot({ path: path.join(output, `names-${step}-${width}.png`) }); }
    await page.waitForTimeout(250);
  }
  assert.deepEqual([...seen], map, `the map chapter played through at ${width}px`);
  await page.locator('#tour-bar [data-speed="0.75"]').evaluate(button => button.click());
}

// 2.19 at every width: a chapter step is told like the arrival's beats, as plain lines with no card and no bullet points,
// only smaller (explain mode after the arrival's impact mode), with its How and Why beneath the lines.
async function verifyOneFormat(page, width, output) {
  await goToStep(page, "pain");
  const impact = await page.locator("#tour-lines .tour-line.on .said").first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  for (const id of ["map-capabilities", "map-claims", "knowledge-kinds"]) {
    await goToStep(page, id);
    if (await page.locator("#tour-play").getAttribute("aria-label") === "Pause the tour") await page.locator("#tour-play").click();
    const look = await page.locator("#tour-card").evaluate(card => {
      const style = getComputedStyle(card);
      const lines = [...card.querySelectorAll(".tour-line.on")];
      return {
        background: style.backgroundColor, border: parseFloat(style.borderTopWidth), shadow: style.boxShadow,
        bullets: lines.map(line => getComputedStyle(line, "::before")).filter(before => before.display !== "none" && before.content !== "none").length,
        sizes: lines.map(line => parseFloat(getComputedStyle(line.querySelector(".said")).fontSize)),
        last: Math.max(...lines.map(line => line.getBoundingClientRect().bottom)),
        overflow: card.scrollHeight - card.clientHeight,
      };
    });
    const depth = await page.locator("#tour-depth").boundingBox();
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(look.background) && look.border === 0 && look.shadow === "none", `${id} has no card at ${width}px: ${JSON.stringify(look)}`);
    assert.equal(look.bullets, 0, `${id} has no bullet points at ${width}px`);
    assert.ok(look.sizes.length && look.sizes.every(size => size < impact && size >= 16), `${id} is told in explain mode, smaller than the arrival's ${impact}px, at ${width}px: ${look.sizes}`);
    assert.ok(depth && depth.y >= look.last - 1, `${id}'s How and Why sit beneath its lines at ${width}px`);
    await page.screenshot({ path: path.join(output, `format-${id}-${width}.png`) });
  }
  await verifyEveryStepFits(page, `${width}px`);
}

// 2.19's room: every step's lines and its How and Why fit without scrolling, the arrival's as well as the chapters'.
async function verifyEveryStepFits(page, size) {
  const over = [];
  for (const id of await page.locator("#tour-pips [data-step]").evaluateAll(pips => pips.map(pip => pip.dataset.step))) {
    await goToStep(page, id);
    if (await page.locator("#tour-play").getAttribute("aria-label") === "Pause the tour") await page.locator("#tour-play").click();
    const overflow = await page.locator("#tour-card").evaluate(card => card.scrollHeight - card.clientHeight);
    if (overflow > 1) over.push(`${id} ${overflow}px`);
  }
  assert.deepEqual(over, [], `Every step's lines and its How and Why fit their room without scrolling at ${size}: ${over.join(", ")} over`);
}

// 2.19 on short phones: the room under the globe still holds every step.
async function verifyShortPhones(browser, url) {
  for (const [width, height] of [[320, 700], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.locator("#tour-play").click();
    await verifyEveryStepFits(page, `${width}x${height}`);
    await page.close();
  }
}

// 2.16 on short phones: the map's names still read clear where the words take room from the globe.
async function verifyShortPhoneNames(browser, url, output) {
  for (const [width, height] of [[320, 700], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.locator("#tour-play").click();
    await verifyNamesClearHeader(page, `${width}x${height}`, output);
    await page.close();
  }
}

export async function verifyImmersive(browser, url, output) {
  const measurements = [];
  for (const width of [1920, 1440, 1280, 390, 320]) {
    const height = { 1920: 1080, 1440: 900, 1280: 800 }[width] ?? 844;
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
    if (width > 600) assert.equal(await page.locator('#tour-bar [data-speed="0.75"]').getAttribute("aria-pressed"), "true", "Act 2 arrives at 0.75×");
    // 2.11: with no globe yet, the pain is centred on the screen, in two lines.
    await goToStep(page, "pain");
    const said = await page.locator("#tour-lines .tour-line.on").evaluateAll(lines => lines.map(line => { const box = line.querySelector(".said").getBoundingClientRect(); return box.x + box.width / 2; }));
    assert.equal(said.length, 2, "the pain is said in two lines");
    for (const centre of said) assert.ok(Math.abs(centre - width / 2) < width * .04, `the pain is centred at ${width}px (${Math.round(centre)})`);
    await page.screenshot({ path: path.join(output, `pain-${width}.png`) });
    // The recording's date is small print in the bottom-left corner, not a chip on the card.
    await goToStep(page, "grow");
    assert.equal(await page.locator("#tour-card .chip-recording").count(), 0, "no recording chip on the card");
    const recorded = page.locator("#tour-recorded");
    assert.match(await recorded.textContent(), /Recorded \d+ \w+ \d{4} to \d+ \w+ \d{4} · timing compressed/);
    const corner = await recorded.boundingBox(), barTop = (await page.locator("#tour-bar").boundingBox()).y;
    assert.ok(corner.x < 30 && corner.x + corner.width <= (width < 600 ? width - 10 : width * .5) && corner.y + corner.height <= barTop && corner.y > barTop - 60, `the recording's date sits bottom left at ${width}px: ${JSON.stringify(corner)}`);
    assert.ok(await recorded.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) <= 11.5, "it is small print");
    await page.screenshot({ path: path.join(output, `grow-${width}.png`) });
    await goToStep(page, "value");
    assert.equal(await recorded.isVisible(), false, "a step without a recording has no small print");
    await verifyNamesClearHeader(page, width, output);
    // A failure here is 2.19's own, so its observation can say so (capture.mjs writes it).
    await verifyOneFormat(page, width, output).catch(error => { error.contract = "2.19"; throw error; });
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
    await page.locator("#tour-story-choice").selectOption("story_2de9e8f4db21");
    await page.locator('.story-panel[data-story-id="story_2de9e8f4db21"] .panel-head').waitFor();
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
  await verifyShortPhoneNames(browser, url, output);
  await verifyShortPhones(browser, url).catch(error => { error.contract = "2.19"; throw error; });
  await writeFile(path.join(output, "immersive-measurements.json"), JSON.stringify({ source: "Locally built unpublished working tree", viewports: measurements }, null, 2) + "\n");
  console.log(JSON.stringify(measurements));
}

// The recording follows the tour's speed, and a step's depth stays readable above the app's drawers.
export async function verifyRecordingFreeplay(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const phoneProblems = [];
  const touchTarget = async selector => {
    await page.locator(selector).waitFor({ state: 'visible' });
    if ((await page.locator(selector).boundingBox()).height < 44) phoneProblems.push(`1.6: ${selector} is shorter than 44px`);
  };
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
  for (const step of ["map-health", "knowledge-kinds"]) {
    await goToStep(page, step);
    await touchTarget('#tour-depth');
    await page.locator("#tour-depth").click();
    await page.locator(".tour-back").scrollIntoViewIfNeeded();
    await touchTarget('.tour-back');
    assert.equal(await page.locator(".tour-back").evaluate(button => { const box = button.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button; }), true, "A step's depth stays above comparisons and the arc drawer");
    await page.locator(".tour-back").click();
  }
  await page.locator("#tour-skip").click();
  assert.equal(await at(), Number(await page.locator(".tour-recording-progress").getAttribute("data-recording-total")), "Free play shows the recording's end");
  await touchTarget('.tour-browse-toggle');
  if (!await page.locator('#tour-label').isVisible()) phoneProblems.push('2.6: phone free play hides its date and read-only status');
  await page.close();
  assert.deepEqual(phoneProblems, [], 'Phone controls and dated free play remain usable');
  console.log("PASS: the recording follows the tour's speed and holds; depth stays readable above the app's drawers");
}

// Review captures of every chapter at its own controls, with each growth allowed to finish before pausing.
export async function reviewChapters(browser, url, output) {
  const observations = [];
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 844]]) {
    if (process.env.WEBSITE_REVIEW_WIDTH && width !== Number(process.env.WEBSITE_REVIEW_WIDTH)) continue;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('storytree-opening-seen', 'yes'));
    try {
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'live');
      await page.locator('#tour-play').click();
      const steps = await page.locator('#tour-pips [data-step]').evaluateAll(nodes => nodes.map(node => node.dataset.step));
      for (const id of steps) {
        await goToStep(page, id);
        const plays = { grow: 20, 'map-empty': 14, 'map-arcs': 14, 'map-stories': 24, 'map-capabilities': 18, 'map-claims': 22, 'map-health': 22 };
        if (id in plays) {
          await page.locator('#tour-play').click();
          await page.waitForTimeout(plays[id] * 1000);
          // A step's lines can end before its review interval; return to its start if so.
          if (await stepOf(page) !== id) await goToStep(page, id);
          if (await page.locator('#tour-play').getAttribute('aria-label') === 'Pause the tour') await page.locator('#tour-play').click();
        }
        await page.waitForTimeout(1800);
        const shot = `${width}-${id}.png`;
        await page.screenshot({ path: path.join(output, shot) });
        const measured = await page.evaluate(() => {
          const card = document.querySelector('#tour-card');
          const box = card.getBoundingClientRect();
          const panels = [...document.querySelectorAll('.sessions-list, .arc-overlay, .story-panel')].filter(node => node.checkVisibility({ visibilityProperty: true })).map(node => node.getBoundingClientRect());
          return { overflow: card.scrollHeight - card.clientHeight, sideways: document.documentElement.scrollWidth > innerWidth,
            panelOverlap: panels.some(panel => Math.min(box.right, panel.right) > Math.max(box.left, panel.left) && Math.min(box.bottom, panel.bottom) > Math.max(box.top, panel.top)) };
        });
        observations.push({ width, height, step: id, picture: shot, ...measured });
        if (await page.locator('#tour-depth').isVisible()) {
          await page.locator('#tour-depth').click();
          await page.screenshot({ path: path.join(output, `${width}-${id}-depth.png`) });
          await page.locator('.tour-back').click();
        }
      }
      await page.locator('#tour-skip').click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(output, `${width}-freeplay.png`) });
      observations.push({ width, errors });
      await writeFile(path.join(output, `${width}-chapter-review.json`), JSON.stringify(observations.filter(row => row.width === width), null, 2) + '\n');
    } finally { await page.close(); }
  }
  await writeFile(path.join(output, 'chapter-review.json'), JSON.stringify(observations, null, 2) + '\n');
  assert.deepEqual(observations.flatMap(row => row.errors ?? []), [], 'The reviewed chapters have no console errors');
}

// Inspect 2.2's still and the separately tracked missing shop fallback, without claiming the missing picture passes.
export async function reviewFallbacks(browser, url, output) {
  const observations = [];
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('storytree-opening-seen', 'yes');
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith('webgl') ? null : original.call(this, kind, ...args); };
    });
    try {
      await page.goto(url);
      await page.locator('#tour-play').click();
      await goToStep(page, 'knowledge-kinds');
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(output, `${width}-no-webgl-knowledge.png`) });
      await page.locator('#tour-skip').click();
      await page.locator('.forest-views').waitFor();
      await page.screenshot({ path: path.join(output, `${width}-no-webgl-shop.png`) });
      observations.push({ width, shopStillVisible: await page.locator('.forest-still img').evaluate(node => node.checkVisibility({ visibilityProperty: true })) });
      await page.getByRole('button', { name: 'storytree', exact: true }).click();
      await page.screenshot({ path: path.join(output, `${width}-no-webgl-storytree.png`) });
    } finally { await page.close(); }
  }
  await writeFile(path.join(output, 'fallback-review.json'), JSON.stringify(observations, null, 2) + '\n');
}
