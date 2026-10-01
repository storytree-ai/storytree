// The website as a visitor sees it (ADR-0825 D5): a real browser reads the built site the way a visitor
// would (with and without JavaScript, at phone width, with text enlarged, with and without WebGL) and every
// check reads the page itself or the network, never a model's account. Prints the observations for
// `pnpm record:acceptance` and saves what it saw (pictures, measurements) beside them.
// The site is served from packages/website/dist, built first with `pnpm --filter @storytree/website build`;
// with --url it visits a published copy instead, and the observations say which in their note.
// Usage: node visit.mjs <outDir> --commit <sha> --evidence <path> [--url <published site>]
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { installCommand } from "../../../src/install-command.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { commit: { type: "string" }, evidence: { type: "string" }, url: { type: "string" } },
});
const out = path.resolve(positionals[0]);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../../dist");
const expected = installCommand(await readFile(path.resolve(here, "../../../../../README.md"), "utf8"));

const checks = [];
const check = (contract, name, observed, detail) => checks.push({ contract, name, observed: observed === undefined ? "not-observed" : observed ? "pass" : "fail", ...(detail ? { detail } : {}) });
/** Runs one check's steps; a step that throws is a failure the check names, never a crash of the run. */
async function step(contract, name, run) {
  try {
    const [observed, detail] = await run();
    check(contract, name, observed, detail);
  } catch (error) {
    check(contract, name, false, `threw: ${error.message.split("\n")[0]}`);
  }
}

/** A picture of what the visitor saw, kept as evidence; a picture that cannot be taken is no check, so it never ends the run. */
async function picture(target, file, options = {}) {
  try {
    return await target.screenshot({ path: path.join(out, file), ...options });
  } catch (error) {
    console.error(`picture ${file} not taken: ${error.message.split("\n")[0]}`);
    return undefined;
  }
}

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(await readFile(path.join(dist, "404.html")));
  }
});
let url = values.url;
if (url === undefined) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
}
await mkdir(out, { recursive: true });
const measured = {};
// Software WebGL for the live scene; the no-JavaScript visit gets a plain browser, since with those flags
// Chromium cannot picture a page that never runs a script.
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const plainBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  // 1.2, 1.3: with JavaScript off, the page reads, its install command is the README's and can be selected,
  // and each of its links leads somewhere real.
  const plain = await plainBrowser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await plain.goto(url);
  await picture(plain, "no-js-390.png", { fullPage: true });
  await step("1.2", "the install command the page shows is the README's Install PowerShell block, whole", async () => {
    const shown = await plain.locator("#install-command").textContent();
    return [shown === expected, shown];
  });
  await step("1.3", "with JavaScript off, the page's heading and install command are visible", async () => {
    const heading = await plain.locator("h1").isVisible();
    const command = await plain.locator("#install-command").isVisible();
    return [heading && command, `heading ${heading}, command ${command}`];
  });
  await step("1.3", "with JavaScript off, a visitor can select the whole install command", async () => {
    await plain.locator(".command-box pre").click({ clickCount: 3 });
    const selected = (await plain.evaluate(() => getSelection().toString())).trim();
    return [selected === expected.trim(), `${selected.length} of ${expected.trim().length} characters selected`];
  });
  for (const [label, href] of [["repository", "https://github.com/storytree-ai/storytree"], ["license", "https://github.com/storytree-ai/storytree/blob/main/LICENSE"], ["LinkedIn contact", "https://www.linkedin.com/in/mick-hua-353353a/"]]) {
    await step("1.3", `with JavaScript off, the ${label} link is visible and following it reaches a page`, async () => {
      const link = plain.locator(`a[href="${href}"]`).first();
      if (!(await link.isVisible())) return [false, "not visible"];
      const visit = await browser.newPage({ javaScriptEnabled: false });
      try {
        const response = await visit.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const status = response?.status();
        // LinkedIn answers any automated browser with its own 999 refusal: its server is there and the
        // address is not missing, but the harness cannot see the page a visitor's browser gets.
        const reached = status !== undefined && (status < 400 || (status === 999 && href.includes("linkedin.com")));
        return [reached, `${href} answered ${status}${status === 999 ? " (LinkedIn's refusal of automated browsers, not a missing page)" : ""}`];
      } finally {
        await visit.close();
      }
    });
  }

  // 1.4: an address with no page answers 404 with a working way home.
  await step("1.4", "an address with no page answers 404, and its link back takes the visitor home", async () => {
    const missing = await plain.goto(new URL("a-path-that-does-not-exist", url).href);
    await picture(plain, "not-found-390.png");
    await plain.locator('main a[href="/"]').first().click();
    const home = new URL(plain.url()).pathname;
    return [missing.status() === 404 && home === "/", `${missing.status()}, then ${home}`];
  });
  await plain.close();

  // 1.5: the copy control copies exactly what is shown; a denied copy says so and leaves the command.
  const copy = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  await copy.goto(url);
  await step("1.5", "the copy control copies exactly the visible install command, and says so once the copy is done", async () => {
    await copy.locator("#copy-command").click();
    await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "copied", null, { timeout: 5000 });
    const copied = await copy.evaluate(() => navigator.clipboard.readText());
    return [copied === (await copy.locator("#install-command").textContent()) && copied === expected, `${copied.length} characters copied`];
  });
  await step("1.5", "a denied copy reports failure and the command stays shown", async () => {
    await copy.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied by the visitor's browser"); } } }));
    await copy.locator("#copy-command").click();
    await copy.waitForFunction(() => document.querySelector("#copy-command").dataset.copyState === "failed", null, { timeout: 5000 });
    const status = (await copy.locator("#copy-status").textContent()).trim();
    return [status !== "" && (await copy.locator("#install-command").textContent()) === expected, status];
  });
  await copy.close();

  // 1.6: at phone width, every standalone control is at least 44 px high, and keyboard focus is seen, unclipped.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.goto(url);
  await step("1.6", "at 390 px, every header, footer, text-link and copy control is at least 44 CSS px high", async () => {
    const controls = await phone.locator(".site-header a, .site-footer a, .text-link, #copy-command").evaluateAll((all) => all.map((control) => ({ name: control.textContent.trim(), height: Math.round(control.getBoundingClientRect().height) })));
    measured.controls = controls;
    const short = controls.filter(({ height }) => height < 44);
    return [controls.length > 0 && short.length === 0, short.length === 0 ? `${controls.length} controls, the lowest ${Math.min(...controls.map(({ height }) => height))} px` : short.map(({ name, height }) => `${name}: ${height} px`).join("; ")];
  });
  await step("1.6", "at 390 px, keyboard focus on the command and the copy control is visible and not clipped by its panel", async () => {
    const seen = [];
    for (const selector of [".command-box pre", "#copy-command"]) {
      await phone.keyboard.press("Tab"); // keyboard focus, so :focus-visible applies
      await phone.locator(selector).focus();
      seen.push(await phone.locator(selector).evaluate((control) => {
        const style = getComputedStyle(control);
        const extent = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
        const rect = control.getBoundingClientRect();
        const box = control.closest(".command-box").getBoundingClientRect();
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, inside: rect.left - extent >= box.left && rect.right + extent <= box.right && rect.top - extent >= box.top && rect.bottom + extent <= box.bottom };
      }));
    }
    await picture(phone.locator(".command-box"), "focus-390.png");
    measured.focus = seen;
    return [seen.every(({ width, style, inside }) => width > 0 && style !== "none" && inside), JSON.stringify(seen)];
  });
  await phone.close();

  // 1.7: text enlarged to 200% at 320 and 390 px keeps headers, headings and the copy control readable and whole.
  const problems = [];
  for (const width of [320, 390]) for (const route of ["home", "not found"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(route === "home" ? url : new URL("missing-page", url).href);
    const issues = await page.evaluate(() => {
      for (const [element, size] of [...document.querySelectorAll("body, body *")].map((element) => [element, parseFloat(getComputedStyle(element).fontSize)])) element.style.setProperty("font-size", `${size * 2}px`, "important");
      const rects = (element) => { const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()]; };
      const found = [];
      const header = [...document.querySelectorAll(".site-header a")].map((element) => ({ text: element.textContent.trim(), rects: rects(element) }));
      for (let i = 0; i < header.length; i++) for (let j = i + 1; j < header.length; j++) {
        if (header[i].rects.some((a) => header[j].rects.some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))) found.push(`${header[i].text} overlaps ${header[j].text}`);
      }
      for (const element of [...document.querySelectorAll(".site-header a, h1, #install-title")]) if (rects(element).some((rect) => rect.left < 0 || rect.right > innerWidth + 1)) found.push(`${element.textContent.trim()} runs off the screen`);
      const button = document.querySelector("#copy-command");
      if (button) {
        const box = button.closest(".command-box").getBoundingClientRect();
        if ([button.getBoundingClientRect(), ...rects(button)].some((rect) => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom)) found.push("the copy control is clipped by its panel");
        if (button.hidden || getComputedStyle(button).visibility === "hidden") found.push("the copy control is not shown");
      }
      if (document.documentElement.scrollWidth > innerWidth) found.push(`the page scrolls sideways (${document.documentElement.scrollWidth} px wide)`);
      return found;
    });
    await picture(page, `text200-${route === "home" ? "home" : "404"}-${width}.png`);
    problems.push(...issues.map((issue) => `${route} at ${width} px: ${issue}`));
    await page.close();
  }
  check("1.7", "with text at 200% at 320 and 390 px, home and not-found headers do not overlap, nothing runs off the screen or scrolls sideways, and the copy control stays whole", problems.length === 0, problems.join("; ") || "home and not found, at 320 and 390 px");

  // 2.3, 2.1: the text and install control come first; then the live scene draws the saved plan's islands.
  const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let requested = false;
  await live.route(/forest-scene-[^/]*\.js$/, async (route) => { requested = true; await held; await route.continue(); });
  await live.goto(url, { waitUntil: "load" });
  await step("2.3", "before the 3D scene's code arrives, the heading and the install command are already on the page", async () => {
    const ready = (await live.locator("h1").isVisible()) && (await live.locator("#install-command").textContent()) === expected;
    return [ready, `scene code requested yet: ${requested}`];
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
    await setup(page);
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#website-forest").scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);
    await step("2.2", `when ${how}, the visitor sees the forest's still and the page stays usable`, async () => {
      const state = await page.locator("#website-forest").getAttribute("data-forest-state");
      const still = await page.locator("#website-forest .forest-still img").evaluate((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().height > 0);
      const usable = (await page.locator("#install-command").textContent()) === expected && (await page.locator("#copy-command").isVisible());
      await picture(page.locator("#website-forest"), `forest-still-${how.startsWith("WebGL") ? "no-webgl" : "scene-fails"}.png`);
      return [state === "still" && still && usable, `state ${state}, still shown ${still}, install usable ${usable}`];
    });
    await page.close();
  }
} finally {
  await browser.close();
  await plainBrowser.close();
  server.close();
}
await writeFile(path.join(out, "measurements.json"), JSON.stringify(measured, null, 2) + "\n");
const where = values.url === undefined ? "the locally built site (packages/website/dist), since the site is not yet published" : `the published site, ${values.url}`;
console.log(JSON.stringify({ story: "The website", commit: values.commit, evidence: values.evidence, note: `visited ${where}`, checks }, null, 2));
