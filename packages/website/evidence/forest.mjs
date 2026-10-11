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

  // 2.2: with no WebGL, or a scene that fails to start, every view the globe would draw shows a saved picture of that same
  // project, or says plainly why one cannot stand for it, and the narration, panels and waitlist stay usable. Seen, not loaded:
  // each check reads computed visibility and the pixels on screen, so a loaded but hidden picture fails it.
  const noWebGL = (page) => page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) ? null : original.call(this, kind, ...rest); }; });
  const sceneFails = (page) => page.route(/forest-scene-[^/]*\.js$/, (route) => route.fulfill({ status: 500, body: "" }));
  for (const [how, setup, width, height] of [
    ["WebGL is unavailable", noWebGL, 1440, 900], ["WebGL is unavailable", noWebGL, 1280, 800],
    ["WebGL is unavailable", noWebGL, 390, 844], ["WebGL is unavailable", noWebGL, 320, 844],
    ["the scene's code fails to load", sceneFails, 1440, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await setup(page);
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#website-forest").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("#website-forest").dataset.forestState === "still", null, { timeout: 30_000 }).catch(() => {});
    const name = `${how.startsWith("WebGL") ? "no-webgl" : "scene-fails"}-${width}`;
    await step("2.2", `at ${width}px, when ${how}, every view shows a saved picture of its own project or says why it cannot, and the page stays usable`, async () => {
      const state = await page.locator("#website-forest").getAttribute("data-forest-state");
      const failures = [];
      // A shop step replaying a recorded moment: no picture stands in for it; a plain note says so, and the words play on.
      await page.locator('#tour-pips [data-step="map-stories"]').click();
      await page.waitForTimeout(400);
      const replay = await seen(page, ".forest-unavailable");
      if (!replay.shown || !/WebGL/.test(replay.text)) failures.push(`shop step: note shown ${replay.shown}, says "${replay.text}"`);
      for (const still of [".storytree-still", ".shop-still"]) if ((await seen(page, `#website-forest ${still} img`)).shown) failures.push(`shop step: ${still} stands in for a recorded moment`);
      if (!(await page.locator("#tour-lines").isVisible())) failures.push("shop step: the narration is hidden");
      await picture(page, `forest-${name}-shop-step.png`);
      // Free play on the shop: the shop's own saved picture, never storytree's.
      await page.locator("#tour-skip").click();
      await page.waitForTimeout(400);
      const shop = await seen(page, "#website-forest .shop-still img", true);
      if (!shop.shown || shop.colours <= 8) failures.push(`shop free play: shop still shown ${shop.shown}, ${shop.colours} colours`);
      if ((await seen(page, "#website-forest .storytree-still img")).shown) failures.push("shop free play: storytree's still stands in for the shop");
      if ((await seen(page, ".forest-unavailable")).shown) failures.push("shop free play: the replay note is shown over the shop's picture");
      await picture(page, `forest-${name}-shop.png`);
      // Free play on storytree: storytree's own saved picture.
      await page.getByRole("button", { name: "storytree", exact: true }).click();
      await page.waitForTimeout(400);
      const own = await seen(page, "#website-forest .storytree-still img", true);
      if (!own.shown || own.colours <= 8) failures.push(`storytree free play: still shown ${own.shown}, ${own.colours} colours`);
      if ((await seen(page, "#website-forest .shop-still img")).shown) failures.push("storytree free play: the shop's still stands in for storytree");
      await picture(page, `forest-${name}-storytree.png`);
      // Its read-only panels (which arrive with the scene's code, so only when that code loads) and the waitlist still work.
      if (setup === noWebGL) {
        await page.locator("[data-open-arcs]").click();
        const arcs = await page.locator(".arc-lanes").isVisible();
        await page.locator("[data-close-arcs]").click();
        if (!arcs) failures.push("the arcs panel did not open");
      }
      await page.locator("#tour-hatch").click();
      await page.locator("#waitlist-email").waitFor({ state: "visible" });
      const usable = (await page.locator("#waitlist-email").isVisible()) && (await page.locator("#waitlist-submit").isVisible());
      if (!usable) failures.push("the waitlist is not usable");
      if (state !== "still") failures.push(`state ${state}`);
      return [failures.length === 0, failures.length ? failures.join("; ") : `state ${state}; shop step note "${replay.text}"; shop still ${shop.colours} colours; storytree still ${own.colours} colours; ${setup === noWebGL ? "arcs panel and " : ""}waitlist usable`];
    });
    await page.close();
  }
}

// What the visitor sees of an element: shown when it is visible by computed style and has area on screen; its text; and, if asked,
// how many distinct colours its pixels show (a blank or failed picture is one flat colour).
async function seen(page, selector, pixels = false) {
  const element = page.locator(selector);
  if (await element.count() === 0) return { shown: false, text: "", colours: 0 };
  const shown = await element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const loaded = node instanceof HTMLImageElement ? node.complete && node.naturalWidth > 0 : true;
    return loaded && node.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && box.width > 0 && box.height > 0;
  });
  const text = (await element.textContent())?.trim() ?? "";
  if (!shown || !pixels) return { shown, text, colours: 0 };
  const shot = await element.screenshot();
  const colours = await page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const copy = document.createElement("canvas");
    copy.width = 64; copy.height = 64;
    const context = copy.getContext("2d");
    context.drawImage(image, 0, 0, 64, 64);
    const data = context.getImageData(0, 0, 64, 64).data;
    const found = new Set();
    for (let i = 0; i < data.length; i += 4) found.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    return found.size;
  }, shot.toString("base64"));
  return { shown, text, colours };
}
