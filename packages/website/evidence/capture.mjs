// Build first, then: node packages/website/evidence/capture.mjs [evidence subfolder]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { verifyOpening, verifyOpeningFrames } from "./opening.mjs";
import { verifyTour, verifyTourCamera, verifyImmersive, verifyRecordingFreeplay } from "./tour.mjs";
import { verifyForest } from "./forest.mjs";
import { withBrowserCoverage } from "./browser-coverage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, process.argv[2] ?? "scaffold");
const dist = path.resolve(here, "../dist");
const verifyOpeningRequested = process.argv.includes("--verify-opening");
const verifyOpeningFramesRequested = process.argv.includes("--verify-opening-frames");
const verifyEnlarged = process.argv.includes("--verify-enlarged");
const verifyControls = process.argv.includes("--verify-controls") || verifyEnlarged;
const verifyHome = process.argv.includes("--verify-home") || verifyControls;
const allocation = process.argv.includes("--allocation");
const journey = (proof, run, using = browser) => allocation ? withBrowserCoverage(using, { proof, dist, output }, run) : run(using);
await mkdir(output, { recursive: true });
let openingCommit;
if (verifyOpeningRequested) {
  await rm(path.join(output, "opening-observations.json"), { force: true });
  openingCommit = (await readFile(path.join(dist, "version.txt"), "utf8")).trim();
  assert.match(openingCommit, /^[0-9a-f]{40}$/, "Opening acceptance needs the locally built website's full commit in dist/version.txt");
}
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(await readFile(path.join(dist, "404.html")));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", ...(verifyOpeningFramesRequested ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] : [])] });
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (verifyOpeningFramesRequested) {
    const check = { contract: "2.10", name: "After Run the turn lands on a live globe that drew nothing in chapter 1", observed: "not-observed" };
    try { await verifyOpeningFrames(browser, url, output); check.observed = "pass"; }
    catch (error) { check.observed = "fail"; check.detail = error.message; throw error; }
    finally {
      await writeFile(path.join(output, "opening-frames-observations.json"), JSON.stringify({
        story: "The website", commit: (await readFile(path.join(dist, "version.txt"), "utf8")).trim(),
        evidence: path.relative(path.resolve(here, "../../.."), output).split(path.sep).join("/"),
        note: "Locally built website served from packages/website/dist, SwiftShader", checks: [check],
      }, null, 2) + "\n");
    }
  }
  else if (process.argv.includes("--verify-recording")) await verifyRecordingFreeplay(browser, url, output);
  else if (process.argv.includes("--verify-immersive")) await verifyImmersive(browser, url, output);
  else {
  if (process.argv.includes("--verify-forest")) {
    const checks = [];
    const forestBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
    try {
      await journey("website 2.1 live forest, deferred loading and still fallbacks", async measured => {
        await verifyForest(measured, url, output, async (contract, name, run) => {
          const [passed, detail] = await run();
          checks.push({ contract, name, observed: passed ? "pass" : "fail", detail });
          assert.ok(passed, `website ${contract}: ${name}: ${detail}`);
        }, (target, file, options = {}) => target.screenshot({ path: path.join(output, file), ...options }));
      }, forestBrowser);
    } finally {
      await forestBrowser.close();
      await writeFile(path.join(output, "forest-observations.json"), JSON.stringify({
        story: "The website", commit: (await readFile(path.join(dist, "version.txt"), "utf8")).trim(),
        evidence: path.relative(path.resolve(here, "../../.."), output).split(path.sep).join("/"),
        note: "Locally built website served from packages/website/dist", checks,
      }, null, 2) + "\n");
    }
  }
  if (process.argv.includes("--verify-camera")) await verifyTourCamera(browser, url);
  if (process.argv.includes("--verify-tour")) {
    const proof = { contracts: ["2.4", "2.5", "2.6", "2.7", "2.8"], observed: "not-observed", source: "Locally built unpublished working tree", baseCommit: (await readFile(path.join(dist, "version.txt"), "utf8")).trim() };
    try { await journey("website 2.4 guided tour and dated free play", measured => verifyTour(measured, url, output)); proof.observed = "pass"; }
    catch (error) { proof.observed = "fail"; proof.detail = error.message; throw error; }
    finally { await writeFile(path.join(output, "tour-observations.json"), JSON.stringify(proof, null, 2) + "\n"); }
  }
  if (verifyOpeningRequested) {
    const check = {
      contract: "1.8",
      name: "Chapter 1 playback, exits, sound, storage and static fallbacks",
      observed: "not-observed",
    };
    try {
      await journey("website 1.8 Chapter 1 playback, restart and exits", measured => verifyOpening(measured, url, output));
      check.observed = "pass";
    } catch (error) {
      check.observed = "fail";
      check.detail = error.message;
      throw error;
    } finally {
      await writeFile(path.join(output, "opening-observations.json"), JSON.stringify({
        story: "The website",
        commit: openingCommit,
        evidence: path.relative(path.resolve(here, "../../.."), output).split(path.sep).join("/"),
        note: "Locally built website served from packages/website/dist",
        checks: [check],
      }, null, 2) + "\n");
    }
  }
  if (verifyHome) {
    const noScript = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await noScript.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await noScript.goto(url + "waitlist.html");
    assert.equal(await noScript.locator('#waitlist-form').isVisible(), false);
    assert.ok(await noScript.locator('#waitlist noscript a[href="https://www.linkedin.com/in/mick-hua-353353a/"]').isVisible());
    for (const href of ["https://github.com/storytree-ai/storytree", "https://github.com/storytree-ai/storytree/blob/main/LICENSE", "https://www.linkedin.com/in/mick-hua-353353a/"]) {
      assert.ok(await noScript.locator(`a[href="${href}"]`).first().isVisible());
    }
    const missing = await noScript.goto(url + "a-path-that-does-not-exist");
    assert.equal(missing.status(), 404);
    await noScript.locator('main a[href="/"]').first().click();
    assert.equal(new URL(noScript.url()).pathname, "/");
    await noScript.close();
  }
  if (verifyEnlarged) {
    // Contract 1.7: injected text enlargement, not native browser zoom.
    const enlarged = [];
    const problems = [];
    for (const width of [320, 390, 1280]) for (const route of ["waitlist", "404"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
      await page.goto(url + (route === "404" ? "missing-page" : "waitlist.html"));
      await page.evaluate(() => {
        const sizes = [...document.querySelectorAll("body, body *")].map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
        for (const [element, size] of sizes) element.style.setProperty("font-size", `${size * 2}px`, "important");
      });
      const measured = await page.evaluate(() => {
        const textRects = element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].map(rect => rect.toJSON());
        };
        const header = [...document.querySelectorAll(".site-header a")].map(element => ({ text: element.textContent.trim(), rects: textRects(element) }));
        const issues = [];
        for (let i = 0; i < header.length; i++) for (let j = i + 1; j < header.length; j++) {
          if (header[i].rects.some(a => header[j].rects.some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))) issues.push(`${header[i].text} overlaps ${header[j].text}`);
        }
        const headings = [...document.querySelectorAll("h1, #waitlist-title, .email-label, #waitlist-form legend, .waitlist-choice, #waitlist-promise, #waitlist-ai, #waitlist-disclosure")].map(element => ({ text: element.textContent.trim(), rects: textRects(element) }));
        for (const element of [...header, ...headings]) if (element.rects.some(rect => rect.left < 0 || rect.right > innerWidth + 1)) issues.push(`${element.text} extends beyond the viewport`);
        const button = document.querySelector("#waitlist-submit");
        let form;
        if (button) {
          const box = button.closest("#waitlist-form").getBoundingClientRect();
          form = { control: button.getBoundingClientRect().toJSON(), text: textRects(button), panel: box.toJSON() };
          if ([form.control, ...form.text].some(rect => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom)) issues.push("Waitlist control or label is clipped by the form");
        }
        if (document.documentElement.scrollWidth > innerWidth) issues.push("Page overflows horizontally");
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, header, headings, form, issues };
      });
      enlarged.push({ route, ...measured });
      problems.push(...measured.issues.map(issue => `${route} at ${width}px: ${issue}`));
      const prefix = `${route}-text200-${width}`;
      await page.locator(".site-header").screenshot({ path: path.join(output, `${prefix}-header.png`) });
      await page.locator("h1").screenshot({ path: path.join(output, `${prefix}-heading.png`) });
      if (route === "waitlist") {
        await page.locator("#waitlist-title").screenshot({ path: path.join(output, `${prefix}-waitlist.png`) });
        await page.locator("#waitlist-form").screenshot({ path: path.join(output, `${prefix}-form.png`) });
      }
      if (measured.issues.length === 0) {
        const nav = route === "waitlist" ? page.locator("#waitlist-submit") : page.locator(".site-header nav a").first();
        await nav.focus();
        await page.keyboard.press("Enter");
        if (route === "waitlist") {
          await page.locator('#waitlist-email').fill('invalid');
          await page.locator('#waitlist-submit').click();
          assert.equal(await page.locator('#waitlist-email').evaluate(input => input.validity.valid), false);
          await page.locator('#waitlist-disclosure summary').focus(); await page.keyboard.press('Enter');
          assert.equal(await page.locator('#waitlist-disclosure').getAttribute('open'), '');
        } else await page.waitForURL(url);
        if (route === "waitlist") await page.locator(".site-header .wordmark").click();
        await page.waitForURL(url);
      }
      await page.close();
    }
    await writeFile(path.join(output, "enlarged-measurements.json"), JSON.stringify(enlarged, null, 2) + "\n");
    assert.deepEqual(problems, [], "Enlarged text remains readable and usable");
  }
  const measures = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, ...(verifyControls ? [{ width: 320, height: 720 }] : [])]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url + "waitlist.html", { waitUntil: "networkidle" });
    const measured = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      headings: document.querySelectorAll("h1").length,
      mount: document.querySelector("#website-forest")?.getBoundingClientRect().toJSON() ?? null,
      waitlist: document.querySelector('#waitlist').getBoundingClientRect().toJSON(),
      form: document.querySelector('#waitlist-form').getBoundingClientRect().toJSON(),
      emailFont: getComputedStyle(document.querySelector('#waitlist-email')).fontSize,
      primaryInputs: document.querySelectorAll('#waitlist-form input').length,
      bodyFont: getComputedStyle(document.querySelector(".waitlist-summary")).fontSize,
      assets: performance.getEntriesByType("resource").map(entry => ({ name: new URL(entry.name).pathname, bytes: entry.encodedBodySize })),
    }));
    assert.equal(measured.document, measured.viewport, "No horizontal page overflow");
    assert.equal(measured.headings, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true });
    await page.locator('#waitlist-disclosure').evaluate(details => { details.open = true; });
    const waitlistClip = await page.locator('#waitlist').evaluate(section => ({ x: 0, y: section.getBoundingClientRect().top + scrollY, width: innerWidth, height: section.getBoundingClientRect().height }));
    await page.screenshot({ path: path.join(output, `${viewport.width}-waitlist.png`), clip: waitlistClip, fullPage: true });
    if (verifyControls) {
      measured.controls = await page.locator(".site-header a, .site-footer a, .text-link, #waitlist-submit, #waitlist-email, .waitlist-choice, #waitlist-disclosure summary").evaluateAll(controls => controls.map(control => ({
        name: control.textContent.trim(), width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
      })));
      for (const control of measured.controls) assert.ok(control.height >= 44, `${control.name} needs a 44 px target height`);
      measured.focus = [];
      for (const [name, selector] of [["email", "#waitlist-email"], ["submit", "#waitlist-submit"]]) {
        await page.keyboard.press("Tab");
        await page.locator(selector).focus();
        const focus = await page.locator(selector).evaluate(control => {
          const box = control.closest("#waitlist-form");
          const style = getComputedStyle(control);
          const width = parseFloat(style.outlineWidth);
          const extent = Math.max(0, width + parseFloat(style.outlineOffset));
          const rect = control.getBoundingClientRect();
          const boundary = box.getBoundingClientRect();
          const light = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
          const levels = [light(style.outlineColor), light(getComputedStyle(box.closest(".paper")).backgroundColor)].sort((a, b) => b - a);
          return { width, contrast: (levels[0] + .05) / (levels[1] + .05), inside: rect.left - extent >= boundary.left && rect.right + extent <= boundary.right && rect.top - extent >= boundary.top && rect.bottom + extent <= boundary.bottom };
        });
        assert.ok(focus.width > 0 && focus.contrast >= 3, `${name} focus must be visible against the form`);
        assert.ok(focus.inside, `${name} focus must fit inside the form`);
        measured.focus.push({ name, ...focus });
        await page.locator("#waitlist-form").screenshot({ path: path.join(output, `${viewport.width}-focus-${name}.png`) });
      }
    }
    measures.push(measured);
    await page.close();
  }
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(measures, null, 2) + "\n");
  console.log(JSON.stringify(measures));
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
