import assert from "node:assert/strict";
import path from "node:path";

export async function verifyTourCamera(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  const positions = () => page.locator("#website-forest").evaluate(host => {
    const canvas = host.querySelector("canvas").getBoundingClientRect();
    return [...host.querySelectorAll(".planet-nameplate[data-story-id]")].map(node => ({
      id: node.dataset.storyId, x: Math.round(node.getBoundingClientRect().x - canvas.x), y: Math.round(node.getBoundingClientRect().y - canvas.y),
    }));
  });
  const failures = [];
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live");
    await page.locator('[data-explainer="capabilities"]').click();
    await page.waitForTimeout(1800);
    const destination = await positions();
    await page.locator('[data-explainer="stories"]').click();
    await page.waitForTimeout(1800);
    await page.locator('[data-explainer="capabilities"]').click();
    await page.waitForTimeout(40);
    await page.locator("#tour-pause").click();
    await page.waitForTimeout(900);
    await page.locator("#tour-pause").click();
    await page.waitForTimeout(1800);
    const resumed = await positions();
    const distance = destination.reduce((sum, target) => {
      const actual = resumed.find(item => item.id === target.id);
      return sum + (actual ? Math.hypot(target.x - actual.x, target.y - actual.y) : 1000);
    }, 0) / destination.length;
    if (distance > 5) failures.push(`Resume left the guided camera ${Math.round(distance)} pixels from its destination`);
    const canvas = await page.locator("#website-forest canvas").boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .75, canvas.y + canvas.height * .65, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const dragged = await positions();
    await page.locator("#tour-replay").click();
    await page.waitForTimeout(1000);
    if (JSON.stringify(await positions()) === JSON.stringify(dragged)) failures.push("Replay on the first step did not restore the guided camera after a drag");
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
  console.log("PASS contract 2.4: Resume completes an interrupted camera move; Replay restores guidance after dragging");
}

// Contracts 2.4–2.6 through the built page and the app's actual saved-reading surfaces.
export async function verifyTour(browser, url, output) {
  await verifyTourCamera(browser, url);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen", "yes");
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith("webgl") ? null : context.call(this, kind, ...args); };
  });
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.goto(url);
  await page.locator("#tour-pause").waitFor();
  const lineCount = () => page.locator("#tour-lines p:visible").count();
  const step = () => page.locator("#chapter2").getAttribute("data-tour-step");
  assert.equal(await lineCount(), 1);
  await page.locator("#tour-pause").click();
  await page.clock.runFor(15_000);
  assert.equal(await lineCount(), 1, "Pause holds words without a renderer");
  await page.locator("#tour-speed").selectOption("1.5");
  await page.locator("#tour-pause").click();
  await page.clock.runFor(7000);
  assert.ok(await lineCount() >= 2, "The next line gets reading time at the selected speed");
  await page.locator("#tour-depth").click();
  const heldStep = await step(), heldLines = await lineCount();
  assert.equal(await page.locator("#tour-why li").count(), 2);
  assert.equal(await page.evaluate(() => document.activeElement.id), "tour-why-title");
  await page.clock.runFor(30_000);
  assert.equal(await step(), heldStep); assert.equal(await lineCount(), heldLines);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tour-depth");
  await page.locator("#tour-everything").click();
  await page.clock.runFor(30_000);
  assert.equal(await step(), heldStep);
  await page.locator("#tour-next").focus(); await page.keyboard.press("Enter");
  assert.notEqual(await step(), heldStep, "Next works during an inspection hold");
  await page.locator("#tour-replay").click();
  assert.equal(await step(), "problem"); assert.equal(await lineCount(), 1);
  for (const explainer of ["stories", "capabilities", "knowledge", "sessions", "arcs"]) {
    await page.locator(`[data-explainer="${explainer}"]`).click();
    await page.locator("#tour-pause").click();
    let count = 0;
    while (!(await step()).endsWith("-comparison")) {
      assert.ok(++count < 10, "Every explainer reaches its comparison");
      await page.locator("#tour-depth").click();
      const decisions = await page.locator("#tour-why li").count();
      assert.ok(decisions >= 2 && decisions <= 3);
      await page.locator("#tour-why-close").click();
      for (const id of ["tour-pause", "tour-speed", "tour-next", "tour-replay", "tour-everything", "tour-depth", "tour-skip"]) assert.ok(await page.locator(`#${id}`).isVisible(), `${id} stays available`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
      await page.locator("#tour-next").click();
    }
    await page.locator("#tour-pause").click();
    await page.clock.runFor(8000);
    assert.ok(await page.locator("#tour-comparisons").isVisible());
    const links = await page.locator("#tour-comparisons a").evaluateAll(items => items.map(item => item.href));
    assert.ok(links.length >= 2 && links.every(href => href.startsWith("https://")));
    if (explainer === "capabilities") await page.locator("#chapter2").screenshot({ path: path.join(output, "390-comparison.png") });
    await page.locator("#tour-next").click();
    assert.equal(await page.locator("#chapter2").getAttribute("data-tour-mode"), "freeplay");
  }
  await page.locator("#tour-replay").click(); await page.locator("#tour-depth").click(); await page.locator("#tour-skip").click();
  assert.equal(await page.locator("#chapter2").getAttribute("data-tour-mode"), "freeplay");
  assert.equal(await page.locator("#website-forest").getAttribute("data-forest-state"), "still");
  const hatch = await page.locator("#tour-hatch").boundingBox();
  assert.ok(hatch && hatch.x >= 0 && hatch.x + hatch.width <= 390 && hatch.y >= 0 && hatch.y + hatch.height <= 844,
    "2.6 · the free-play waitlist exit is reachable in the viewport without scrolling past the saved surfaces");
  assert.ok(hatch.x + hatch.width >= 366 && hatch.y + hatch.height >= 820,
    "2.6 · the free-play exit stays in the bottom-right corner");
  await page.locator("#chapter2").screenshot({ path: path.join(output, "390-no-webgl.png") });
  await page.locator(".session-row[data-session-id='01a0fa93-ea61-7542-9574-6c752c763f16']").waitFor({ timeout: 5000 });
  assert.ok(await page.locator(".session-row").count() > 0, "Saved sessions use the recording clock, even in 2030");
  const recordingIndex = async () => Number(await page.locator("#recording-progress").getAttribute("data-recording-index"));
  if (await page.locator("#tour-pause").getAttribute("aria-pressed") === "true") await page.locator("#tour-pause").click();
  await page.locator("#recording-replay").click();
  await page.clock.runFor(3500);
  assert.ok(await recordingIndex() > 0 && await recordingIndex() < 287);
  assert.match(await page.locator("#recording-progress time").getAttribute("datetime"), /^2026-10-02T/);
  await page.locator("#tour-pause").click();
  const pausedAt = await recordingIndex();
  await page.clock.runFor(5000); assert.equal(await recordingIndex(), pausedAt);
  await page.locator("#tour-pause").click(); await page.locator("#tour-depth").click();
  const whyAt = await recordingIndex();
  await page.clock.runFor(5000); assert.equal(await recordingIndex(), whyAt);
  await page.locator("#tour-why-close").click(); await page.locator("#tour-everything").click();
  const everythingAt = await recordingIndex();
  await page.clock.runFor(5000); assert.equal(await recordingIndex(), everythingAt);
  await page.locator("#recording-end").click();
  assert.equal(await recordingIndex(), 287);
  await page.locator("#tour-story-choice").selectOption("story_deee4230348c");
  assert.ok(await page.locator(".tour-story-panel .panel-head").isVisible());
  await page.locator(".panel-tree [data-capability-id]").first().focus();
  await page.keyboard.press("Enter");
  await page.locator(".panel-detail").waitFor();
  await page.locator("#tour-note-choice").selectOption({ index: 1 });
  await page.locator(".core-card").waitFor();
  assert.ok(await page.locator(".arc-lane").count() > 0);
  await page.locator(".arc-lane").last().click();
  assert.ok(await page.locator(".arc-briefing").isVisible());
  await page.locator("#tour-hatch").click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "waitlist-email");
  assert.deepEqual(errors, []); await page.close();
  for (const width of [1440, 390]) {
    const live = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const liveErrors = [];
    live.on("pageerror", error => liveErrors.push(error.message));
    await live.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await live.goto(url); await live.locator("#tour-pause").click();
    await live.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "live", null, { timeout: 25000 });
    await live.locator("#chapter2").screenshot({ path: path.join(output, `${width}-busy.png`) });
    await live.locator('[data-explainer="capabilities"]').click(); await live.locator("#tour-pause").click();
    await live.locator("#chapter2").screenshot({ path: path.join(output, `${width}-capabilities.png`) });
    await live.locator("#tour-skip").click();
    const canvas = live.locator("#website-forest canvas");
    assert.equal(await canvas.evaluate(node => getComputedStyle(node).pointerEvents), "auto", "The real app globe accepts pointer interaction");
    const before = await live.locator(".planet-nameplate").evaluateAll(nodes => nodes.map(node => ({ name: node.textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    const box = await canvas.boundingBox();
    await live.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await live.mouse.down(); await live.mouse.move(box.x + box.width * .7, box.y + box.height * .65, { steps: 8 }); await live.mouse.up();
    await live.waitForFunction(before => JSON.stringify([...document.querySelectorAll(".planet-nameplate")].map(node => ({ name: node.textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y }))) !== JSON.stringify(before), before);
    await live.locator("#chapter2").screenshot({ path: path.join(output, `${width}-freeplay.png`) });
    assert.equal(await live.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(liveErrors, []); await live.close();
  }
  console.log("PASS contracts 2.4–2.6: pacing, holds, explainers, sources, recorded free play, phone and no-WebGL");
}
