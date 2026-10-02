import path from "node:path";

// Website contracts 2.1–2.3, shared with the verified acceptance visitor.
export async function verifyForest(browser, url, out, step, picture) {
  // 2.3, 2.1: the text and waitlist entry come first; then the live scene draws the saved plan's islands.
  const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await live.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let requested = false;
  await live.route(/forest-scene-[^/]*\.js$/, async (route) => { requested = true; await held; await route.continue(); });
  await live.goto(url, { waitUntil: "load" });
  await step("2.3", "before the 3D scene's code arrives, the explanation and waitlist entry are available", async () => {
    const ready = (await live.locator("#tour-title").isVisible()) && (await live.locator("#tour-hatch").isVisible());
    const href = await live.locator('#tour-hatch').getAttribute('href');
    const form = await browser.newPage();
    try {
      await form.goto(new URL(href, url).href);
      await form.locator('#waitlist-email').fill('invalid');
      await form.locator('#waitlist-submit').click();
      const invalid = await form.locator('#waitlist-form').getAttribute('data-waitlist-state') === 'invalid';
      return [ready && invalid, `scene code requested yet: ${requested}; separate form validation available ${invalid}`];
    } finally { await form.close(); }
  });
  release();
  await live.locator("#website-forest").scrollIntoViewIfNeeded();
  await step("2.1", "with WebGL, the live scene takes over from the still and draws on its canvas", async () => {
    await live.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState !== "loading", null, { timeout: 30_000 }).catch(() => {});
    const state = await live.locator("#website-forest").getAttribute("data-forest-state");
    await live.waitForTimeout(1500);
    const shot = await live.locator("#website-forest").screenshot({ path: path.join(out, "forest-live-1440.png") });
    // Pixels from what the visitor sees there (a WebGL canvas cannot be read back once drawn): a drawn
    // scene is many colours, an empty or failed one is one flat colour.
    const colours = await live.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = 64; copy.height = 64;
      const context = copy.getContext("2d");
      context.drawImage(image, 0, 0, 64, 64);
      const data = context.getImageData(0, 0, 64, 64).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      return seen.size;
    }, shot.toString("base64"));
    // What is on screen there is the scene's canvas, not the still behind it.
    const shown = await live.evaluate(() => {
      const canvas = document.querySelector("#website-forest .forest-canvas canvas");
      const still = document.querySelector("#website-forest .forest-still");
      const box = canvas?.getBoundingClientRect();
      return { canvas: canvas !== null && box.width > 0 && box.height > 0 && getComputedStyle(canvas).visibility === "visible", still: getComputedStyle(still).visibility !== "hidden" };
    });
    return [state === "live" && shown.canvas && !shown.still && colours > 8, `state ${state}, canvas shown ${shown.canvas}, still shown ${shown.still}, ${colours} distinct colours where the scene is`];
  });
  await live.close();

  // 2.2: with no WebGL, or a scene that fails to start, the still stays and the page still works.
  for (const [how, setup] of [
    ["WebGL is unavailable", (page) => page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) ? null : original.call(this, kind, ...rest); }; })],
    ["the scene's code fails to load", (page) => page.route(/forest-scene-[^/]*\.js$/, (route) => route.fulfill({ status: 500, body: "" }))],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await setup(page);
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#website-forest").scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);
    await step("2.2", `when ${how}, the visitor sees the forest's still and the page stays usable`, async () => {
      const state = await page.locator("#website-forest").getAttribute("data-forest-state");
      const still = await page.locator("#website-forest .forest-still img").evaluate((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().height > 0);
      await picture(page.locator("#website-forest"), `forest-still-${how.startsWith("WebGL") ? "no-webgl" : "scene-fails"}.png`);
      await page.locator("#tour-hatch").click();
      await page.locator("#waitlist-email").waitFor({ state: "visible" });
      const usable = (await page.locator("#waitlist-email").isVisible()) && (await page.locator("#waitlist-submit").isVisible());
      return [state === "still" && still && usable, `state ${state}, still shown ${still}, waitlist usable ${usable}`];
    });
    await page.close();
  }
}
