// Build first, then: node packages/website/evidence/capture.mjs [evidence subfolder]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installCommand } from "../src/install-command.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, process.argv[2] ?? "scaffold");
const dist = path.resolve(here, "../dist");
const verifyControls = process.argv.includes("--verify-controls");
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
    await copy.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async () => { throw new Error("Clipboard denied for this proof"); } },
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
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => {
            window.copyWrites++;
            return new Promise((resolve, reject) => { window.finishCopy = resolve; window.denyCopy = reject; });
          } } });
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
