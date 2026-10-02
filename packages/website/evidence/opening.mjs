import assert from "node:assert/strict";
import path from "node:path";

// Contract 1.8: exercise the built page, including its real timers and storage.
export async function verifyOpening(browser, url, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audioStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { window.audioStarts++; return start.apply(this, args); };
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Run", exact: true }).waitFor({ timeout: 2500 });
  await page.screenshot({ path: path.join(output, "1440-ready.png") });
  const started = Date.now();
  await page.getByRole("button", { name: "Run", exact: true }).tap();
  await page.getByRole("button", { name: "Show me the better way" }).waitFor({ timeout: 25000 });
  assert.ok(Date.now() - started < 25000, "One tap reaches the finale in about 22 seconds");
  assert.equal(await page.locator("#opening-count").textContent(), "12 agents · 12 waiting on you · 0 answered");
  assert.equal(await page.evaluate(() => window.audioStarts), 0, "Silent until explicitly enabled");
  await page.screenshot({ path: path.join(output, "1440-peak.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: path.join(output, "390-peak.png") });
  await page.getByRole("button", { name: "Sound off" }).click();
  await page.getByRole("button", { name: "I'll keep babysitting" }).click();
  await page.waitForFunction(() => document.querySelector("#opening-count").textContent === "15 agents · 15 waiting on you · 0 answered");
  await page.getByRole("button", { name: "Show me the better way" }).waitFor();
  assert.ok(await page.evaluate(() => window.audioStarts) > 0);
  await page.getByRole("button", { name: "Show me the better way" }).click();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  assert.equal(page.url(), url, "The turn does not navigate or change the hash");
  assert.ok(await page.locator("#website-forest").evaluate(el => el.getBoundingClientRect().top < innerHeight));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "opening-run", "Replay returns keyboard focus to the scene");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  await page.getByRole("button", { name: "Skip to the globe" }).click();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  await page.getByRole("button", { name: "Replay chapter 1" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator("#website-forest").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector("#opening").hidden);
  assert.deepEqual(errors, []);
  await page.close();

  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: "reduce" }]) {
    const still = await browser.newPage({ ...options, viewport: { width: 390, height: 844 } });
    await still.goto(url);
    assert.ok(await still.getByText("12 agents · 12 waiting on you · 0 answered", { exact: true }).isVisible());
    assert.ok(await still.getByText("want me to show you?", { exact: true }).isVisible());
    assert.equal(await still.getByRole("button", { name: "Run", exact: true }).isVisible(), false);
    await still.screenshot({ path: path.join(output, options.javaScriptEnabled === false ? "390-no-script.png" : "390-reduced-motion.png") });
    if (options.reducedMotion) {
      assert.equal(await still.evaluate(() => document.querySelector("#opening").getAnimations({ subtree: true }).length), 0);
      await still.clock.install();
      await still.emulateMedia({ reducedMotion: "no-preference" });
      await still.getByRole("button", { name: "Run", exact: true }).click();
      await still.clock.fastForward(16750);
      await still.clock.fastForward(5250);
      await still.getByRole("button", { name: "Show me the better way" }).click();
      await still.emulateMedia({ reducedMotion: "reduce" });
      await still.waitForFunction(() => document.querySelector("#opening").dataset.phase === "peak");
      assert.equal(await still.evaluate(() => document.querySelector("#opening").getAnimations({ subtree: true }).length), 0, "Changing motion preference cancels the collapse");
      assert.equal(await still.locator("#opening-finale").evaluate(el => getComputedStyle(el).opacity), "1");
    }
    await still.close();
  }
  const denied = await browser.newPage();
  await denied.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage denied"); } }));
  await denied.goto(url);
  await denied.getByRole("button", { name: "Skip to the globe" }).click();
  await denied.waitForFunction(() => document.querySelector("#opening").hidden);
  await denied.close();
  console.log("PASS contract 1.8: playback, joke, turn, exits, sound, storage, static fallbacks");
}
