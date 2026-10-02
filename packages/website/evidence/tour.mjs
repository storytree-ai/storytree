import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
async function replay(page) { await page.locator(".tour-options summary").click(); await page.locator("#tour-replay").click(); await page.locator(".tour-options summary").click(); }
async function goToStep(page, id) { for (let i = 0; i < 50; i++) { if (await page.locator("#chapter2").getAttribute("data-tour-step") === id) return; await page.locator("#tour-next").click(); } throw new Error(`Tour never reached ${id}`); }


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
    await goToStep(page, "capabilities-territories");
    await page.waitForTimeout(1800);
    const destination = await positions();
    await replay(page); await goToStep(page, "stories-islands");
    await page.waitForTimeout(1800);
    await goToStep(page, "capabilities-territories");
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
    await replay(page);
    await page.waitForTimeout(1000);
    if (JSON.stringify(await positions()) === JSON.stringify(dragged)) failures.push("Replay on the first step did not restore the guided camera after a drag");
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
  console.log("PASS contract 2.4: Resume completes an interrupted camera move; Replay restores guidance after dragging");
}

// Contracts 2.4–2.6 through the built page and the app's actual saved-reading surfaces.
export async function verifyTour(browser, url, output) {
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, reducedMotion:"reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen", "yes");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind,...args) { return kind.startsWith("webgl") ? null : original.call(this,kind,...args); };
  });
  await page.clock.install({ time:new Date("2030-01-01T00:00:00Z") });
  await page.goto(url); await page.locator("#tour-pause").waitFor();
  const lineCount = () => page.locator("#tour-lines p:visible").count();
  await page.locator("#tour-pause").click(); const first = await lineCount();
  await page.clock.runFor(15000); assert.equal(await lineCount(),first,"Pause holds tour words");
  await page.locator("#tour-speed").selectOption("1.5"); await page.locator("#tour-pause").click();
  await page.clock.runFor(7000); assert.ok(await lineCount() > first,"Speed advances narration");
  await page.locator("#tour-depth").click();
  const held = await page.locator("#chapter2").getAttribute("data-tour-step");
  await page.clock.runFor(30000); assert.equal(await page.locator("#chapter2").getAttribute("data-tour-step"),held);
  assert.equal(await page.evaluate(() => document.activeElement.id),"tour-why-title");
  await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => document.activeElement.id),"tour-depth");
  await page.locator(".tour-options summary").click(); await page.locator("#tour-everything").click(); await page.locator(".tour-options summary").click();
  await page.clock.runFor(30000); assert.equal(await page.locator("#chapter2").getAttribute("data-tour-step"),held);
  await page.locator("#tour-next").focus(); await page.keyboard.press("Enter");
  assert.notEqual(await page.locator("#chapter2").getAttribute("data-tour-step"),held);
  await replay(page);
  for (const subject of ["stories","capabilities","knowledge","sessions","arcs"]) {
    await goToStep(page,`${subject}-comparison`);
    if (await page.locator("#tour-pause").getAttribute("aria-pressed") === "true") await page.locator("#tour-pause").click();
    await page.clock.runFor(6000);
    assert.ok(await page.locator("#tour-comparisons").isVisible(),`${subject} keeps sourced comparisons`);
    const links = await page.locator("#tour-comparisons a").evaluateAll(nodes => nodes.map(node => node.href));
    assert.ok(links.length >= 2 && links.every(href => href.startsWith("https://")));
    await page.locator("#tour-pause").click();
  }
  await replay(page); await goToStep(page,"sessions-recording");
  await page.locator(".tour-recording-controls summary").click();
  if (await page.locator("#tour-pause").getAttribute("aria-pressed") === "true") await page.locator("#tour-pause").click();
  await page.locator("#recording-replay").click(); await page.clock.runFor(3500);
  const recordingIndex = async () => Number(await page.locator("#recording-progress").getAttribute("data-recording-index"));
  assert.ok(await recordingIndex() > 0 && await recordingIndex() < 287);
  await page.locator("#tour-pause").click(); const stopped = await recordingIndex();
  await page.clock.runFor(5000); assert.equal(await recordingIndex(),stopped,"Pause freezes the dated recording");
  await page.locator("#recording-end").click(); assert.equal(await recordingIndex(),287);
  await page.locator(".tour-recording-controls summary").click();
  await page.locator("#tour-skip").click();
  assert.equal(await page.locator("#website-forest").getAttribute("data-forest-state"),"still");
  await page.getByRole("button",{name:"Explore saved project",exact:true}).click();
  await page.locator("#tour-story-choice").selectOption("story_deee4230348c");
  await page.locator(".panel-tree [data-capability-id]").first().focus(); await page.keyboard.press("Enter");
  await page.locator(".panel-detail").waitFor();
  await page.locator(".panel-close").click();
  await page.getByRole("button",{name:"Explore saved project",exact:true}).click();
  await page.locator("#tour-note-choice").selectOption({index:1});
  await page.locator(".core-card").waitFor(); await page.locator(".core-card button").focus(); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".core-card").count(),0); assert.equal(await page.evaluate(() => document.activeElement.id),"tour-note-choice");
  await page.getByRole("button",{name:"Close project browser",exact:true}).click();
  await page.locator("[data-open-arcs]").click(); await page.locator(".arc-lane").last().click();
  assert.ok(await page.locator(".arc-briefing").isVisible()); await page.locator("[data-close-arcs]").click();
  assert.ok(await page.locator(".session-row").count() > 0,"Saved sessions remain available without WebGL");
  await page.screenshot({path:path.join(output,"390-no-webgl.png")});
  await page.locator("#tour-hatch").click(); assert.equal(new URL(page.url()).pathname,"/waitlist.html");
  assert.deepEqual(errors,[]); await page.close();
  console.log("PASS contracts2.4–2.6: narration, holds, continuous sourced tour, keyboard and no-WebGL exploration");
}

// Website 2.6 and 5.4: an immersive chapter and the desktop surfaces share one viewport.
export async function verifyImmersive(browser, url, output) {
  const measurements = [];
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(url);
    await page.locator("#tour-pause").waitFor();
    await page.locator("#tour-pause").click();
    assert.equal(await page.locator("[data-explainer]").count(), 0, "No chapter category buttons");
    assert.equal(await page.locator(".forest-controls").count(), 0, "The globe uses desktop direct manipulation");
    assert.equal(await page.locator("#waitlist, .explanation").count(), 0, "The chapter contains neither the waitlist form nor the removed explanation");
    for (const selector of ["#tour-pause", "#tour-next", "#tour-depth", "#tour-skip", "#tour-hatch"]) {
      const target = await page.locator(selector).boundingBox(); assert.ok(target.height >= 44, `${selector} keeps a 44px touch target`); assert.ok(target.x >= 0 && target.x + target.width <= width, `${selector} remains inside the viewport`);
    }
    const chapter = await page.locator("#chapter2").boundingBox();
    const globe = await page.locator("#website-forest").boundingBox();
    assert.ok(globe.width >= width * .95 && globe.height >= (width < 600 ? 844 : 1000) * .95, "The globe occupies the viewport");
    await page.screenshot({path:path.join(output,`tour-${width}.png`)});
    await page.locator("#tour-skip").click();
    await page.locator(".forest-views").waitFor();
    assert.equal(await page.locator("#chapter2").getAttribute("data-tour-mode"), "freeplay");
    assert.equal(await page.locator(".tour-copy").isVisible(), false, "Free play clears the guide text");
    await page.getByRole("button", { name: "Library", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Library", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Forest", exact: true }).click();
    await page.getByRole("button", { name: "Explore saved project", exact: true }).click();
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
    assert.ok(panel.x + panel.width <= width && panel.y + panel.height <= (width < 600 ? 844 : 1000), "The story panel is inside the viewport");
    await page.screenshot({path:path.join(output,`story-${width}.png`)});
    await page.locator(".panel-close").click();
    assert.equal(await page.locator(".story-panel").count(), 0, "Close returns to unobscured free play");
    measurements.push({ width, chapter, globe, panel });
    await page.screenshot({ path: path.join(output, `immersive-${width}.png`) });
    await page.locator("#tour-hatch").click();
    assert.equal(new URL(page.url()).pathname, "/waitlist.html");
    await page.locator("#waitlist-form").waitFor();
    await page.screenshot({path:path.join(output,`waitlist-${width}.png`),fullPage:true});
    await page.close();
  }
  await writeFile(path.join(output,"immersive-measurements.json"), JSON.stringify({ source:"Locally built unpublished working tree", viewports:measurements },null,2)+"\n");
  console.log(JSON.stringify(measurements));
}

export async function verifyRecordingFreeplay(browser, url, output) {
  const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
  await page.addInitScript(() => {
    localStorage.setItem("storytree-opening-seen","yes");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind,...args) { return kind.startsWith("webgl") ? null : original.call(this,kind,...args); };
  });
  await page.clock.install({time:new Date("2030-01-01T00:00:00Z")});
  await page.goto(url); await page.locator("#tour-skip").click();
  await page.getByRole("button",{name:"Library",exact:true}).click();
  await page.locator(".tour-recording-controls summary").click();
  await page.locator("#recording-replay").click(); await page.clock.runFor(2500);
  const at = async () => Number(await page.locator("#recording-progress").getAttribute("data-recording-index"));
  assert.ok(await at() > 0,"Free-play Replay starts after interacting with the project");
  await page.locator("#recording-pause").click(); const stopped=await at();
  await page.clock.runFor(2500); assert.equal(await at(),stopped,"The recording drawer can pause playback");
  await page.locator("#recording-speed").selectOption("1.5"); await page.locator("#recording-pause").click();
  await page.clock.runFor(2200); assert.ok(await at() >= stopped+3,"The recording drawer resumes at its chosen speed");
  await page.locator("#recording-pause").click();
  await page.screenshot({path:path.join(output,"recording-390.png")});
  await page.locator(".tour-recording-controls summary").click();
  await replay(page);
  for (const step of ["stories-comparison","arcs-intent"]) {
    await goToStep(page,step);
    if (step.endsWith("comparison")) await page.clock.runFor(6000);
    await page.locator("#tour-depth").click();
    assert.equal(await page.locator("#tour-why-close").evaluate(button => { const box=button.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===button; }),true,"Why remains above comparison and arc overlays");
    await page.locator("#tour-why-close").click();
  }
  await page.close();
  console.log("PASS: free-play recording replay/resume/pause/speed and readable Why overlays");
}
