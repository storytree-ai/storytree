// Build first, then: node packages/website/evidence/capture.mjs [evidence subfolder]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installCommand } from "../src/install-command.ts";
import { verifyOpening } from "./opening.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, process.argv[2] ?? "scaffold");
const dist = path.resolve(here, "../dist");
const verifyEnlarged = process.argv.includes("--verify-enlarged");
const verifyControls = process.argv.includes("--verify-controls") || verifyEnlarged;
const verifyHome = process.argv.includes("--verify-home") || verifyControls;
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
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  await mkdir(output, { recursive: true });
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (process.argv.includes("--verify-opening")) await verifyOpening(browser, url, output);
  if (verifyHome) {
    const expected = installCommand(await readFile(path.resolve(here, "../../../README.md"), "utf8"));
    const noScript = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await noScript.goto(url);
    assert.equal(await noScript.locator("#install-command").textContent(), expected);
    assert.equal(await noScript.locator("#copy-command").isVisible(), false);
    for (const href of ["https://github.com/storytree-ai/storytree", "https://github.com/storytree-ai/storytree/blob/main/LICENSE", "https://www.linkedin.com/in/mick-hua-353353a/"]) {
      assert.ok(await noScript.locator(`a[href="${href}"]`).first().isVisible());
    }
    const missing = await noScript.goto(url + "a-path-that-does-not-exist");
    assert.equal(missing.status(), 404);
    await noScript.locator('main a[href="/"]').first().click();
    assert.equal(new URL(noScript.url()).pathname, "/");
    await noScript.close();

    const copy = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"], hasTouch: verifyControls });
    await copy.goto(url);
    await copy.locator("#copy-command").click();
    await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "copied");
    assert.equal(await copy.evaluate(() => navigator.clipboard.readText()), expected);
    await copy.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true, value: async () => { throw new Error("Clipboard denied for this proof"); },
    }));
    await copy.locator("#copy-command").click();
    await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "failed");
    assert.equal(await copy.locator("#install-command").textContent(), expected);
    assert.ok((await copy.locator("#copy-status").textContent()).trim());
    if (verifyControls) {
      // Contract 1.6: pending copies keep focus and cannot steal it back after Tab.
      for (const outcome of ["copied", "failed", "tab-away"]) {
        await copy.evaluate(() => {
          window.copyWrites = 0;
          Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => {
            window.copyWrites++;
            return new Promise((resolve, reject) => { window.finishCopy = resolve; window.denyCopy = reject; });
          } });
        });
        await copy.locator("#copy-command").focus();
        await copy.keyboard.press("Enter");
        await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "pending");
        assert.equal(await copy.evaluate(() => document.activeElement.id), "copy-command", "Pending copy retains keyboard focus");
        await copy.keyboard.press("Enter");
        assert.equal(await copy.evaluate(() => window.copyWrites), 1, "A second activation cannot start a duplicate copy");
        if (outcome === "tab-away") await copy.keyboard.press("Tab");
        await copy.evaluate(failed => failed ? window.denyCopy(new Error("Denied")) : window.finishCopy(), outcome === "failed");
        await copy.waitForFunction(state => document.querySelector("#copy-command").dataset.copyState === state, outcome === "failed" ? "failed" : "copied");
        assert.equal(await copy.evaluate(moved => document.activeElement === document.querySelector(moved ? ".command-box pre" : "#copy-command"), outcome === "tab-away"), true, "Completion preserves the visitor's current focus");
      }
      await copy.locator("#copy-command").evaluate(button => button.blur());
      await copy.locator("#copy-command").tap();
      await copy.evaluate(() => window.finishCopy());
      await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "copied");
    }
    await copy.close();
  }
  if (verifyEnlarged) {
    // Contract 1.7: injected text enlargement, not native browser zoom.
    const enlarged = [];
    const problems = [];
    for (const width of [320, 390, 1280]) for (const route of ["home", "404"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
      await page.goto(url + (route === "404" ? "missing-page" : ""));
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
        const headings = [...document.querySelectorAll("h1, #install-title")].map(element => ({ text: element.textContent.trim(), rects: textRects(element) }));
        for (const element of [...header, ...headings]) if (element.rects.some(rect => rect.left < 0 || rect.right > innerWidth + 1)) issues.push(`${element.text} extends beyond the viewport`);
        const button = document.querySelector("#copy-command");
        let copy;
        if (button) {
          const box = button.closest(".command-box").getBoundingClientRect();
          copy = { control: button.getBoundingClientRect().toJSON(), text: textRects(button), panel: box.toJSON() };
          if ([copy.control, ...copy.text].some(rect => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom)) issues.push("Copy control or label is clipped by the command panel");
        }
        if (document.documentElement.scrollWidth > innerWidth) issues.push("Page overflows horizontally");
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, header, headings, copy, issues };
      });
      enlarged.push({ route, ...measured });
      problems.push(...measured.issues.map(issue => `${route} at ${width}px: ${issue}`));
      const prefix = `${route}-text200-${width}`;
      await page.locator(".site-header").screenshot({ path: path.join(output, `${prefix}-header.png`) });
      await page.locator("h1").screenshot({ path: path.join(output, `${prefix}-heading.png`) });
      if (route === "home") {
        await page.locator("#install-title").screenshot({ path: path.join(output, `${prefix}-install.png`) });
        await page.locator(".command-box").screenshot({ path: path.join(output, `${prefix}-command.png`) });
      }
      if (measured.issues.length === 0) {
        const nav = page.locator(".site-header nav a").first();
        await nav.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(route === "home" ? url + "#install" : url);
        if (route === "home") {
          assert.equal(new URL(page.url()).hash, "#install");
          const button = page.locator("#copy-command");
          await button.click();
          await page.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "copied");
          await button.focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "copied");
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator("#install-command").textContent());
        }
        await page.locator(".site-header .wordmark").click();
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
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    const measured = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      headings: document.querySelectorAll("h1").length,
      mount: document.querySelector("#website-forest").getBoundingClientRect().toJSON(),
      bodyFont: getComputedStyle(document.querySelector(".lede")).fontSize,
      assets: performance.getEntriesByType("resource").map(entry => ({ name: new URL(entry.name).pathname, bytes: entry.encodedBodySize })),
    }));
    assert.equal(measured.document, measured.viewport, "No horizontal page overflow");
    assert.equal(measured.headings, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true });
    if (verifyControls) {
      measured.controls = await page.locator(".site-header a, .site-footer a, .text-link, #copy-command").evaluateAll(controls => controls.map(control => ({
        name: control.textContent.trim(), width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
      })));
      for (const control of measured.controls) assert.ok(control.height >= 44, `${control.name} needs a 44 px target height`);
      measured.focus = [];
      for (const [name, selector] of [["command", ".command-box pre"], ["copy", "#copy-command"]]) {
        await page.locator(selector).focus();
        const focus = await page.locator(selector).evaluate(control => {
          const box = control.closest(".command-box");
          const style = getComputedStyle(control);
          const width = parseFloat(style.outlineWidth);
          const extent = Math.max(0, width + parseFloat(style.outlineOffset));
          const rect = control.getBoundingClientRect();
          const boundary = box.getBoundingClientRect();
          const light = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
          const levels = [light(style.outlineColor), light(getComputedStyle(box).backgroundColor)].sort((a, b) => b - a);
          return { width, contrast: (levels[0] + .05) / (levels[1] + .05), inside: rect.left - extent >= boundary.left && rect.right + extent <= boundary.right && rect.top - extent >= boundary.top && rect.bottom + extent <= boundary.bottom };
        });
        assert.ok(focus.width > 0 && focus.contrast >= 3, `${name} focus must be visible against the command panel`);
        assert.ok(focus.inside, `${name} focus must fit inside the clipping panel`);
        measured.focus.push({ name, ...focus });
        await page.locator(".command-box").screenshot({ path: path.join(output, `${viewport.width}-focus-${name}.png`) });
      }
    }
    measures.push(measured);
    await page.close();
  }
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(measures, null, 2) + "\n");
  console.log(JSON.stringify(measures));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
