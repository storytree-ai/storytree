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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { commit: { type: "string" }, evidence: { type: "string" }, url: { type: "string" } },
});
const out = path.resolve(positionals[0]);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../../dist");

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
  // 1.3: the no-script visitor can read the page and join by contacting Mick.
  const plain = await plainBrowser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await plain.goto(url);
  await picture(plain, "no-js-390.png", { fullPage: true });
  await step("1.3", "with JavaScript off, the page reads and the waitlist offers LinkedIn joining", async () => {
    const heading = await plain.locator("h1").isVisible();
    const fallback = await plain.locator('#waitlist noscript a[href="https://www.linkedin.com/in/mick-hua-353353a/"]').isVisible();
    const hidden = !(await plain.locator('#waitlist-form').isVisible());
    return [heading && fallback && hidden, `heading ${heading}, LinkedIn fallback ${fallback}, inactive form hidden ${hidden}`];
  });
  for (const [label, href] of [["repository", "https://github.com/storytree-ai/storytree"], ["license", "https://github.com/storytree-ai/storytree/blob/main/LICENSE"], ["LinkedIn contact", "https://www.linkedin.com/in/mick-hua-353353a/"]]) {
    await step("1.3", `with JavaScript off, the ${label} link is visible and following it reaches a page`, async () => {
      const link = plain.locator(`a[href="${href}"]`).first();
      if (!(await link.isVisible())) return [false, "not visible"];
      const visit = await browser.newPage({ javaScriptEnabled: false });
      await visit.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
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

  // 5.1, 5.2: the transport is intercepted on the local build only. No live row is created.
  if (values.url === undefined) {
    const form = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await form.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    let respond;
    let received;
    async function activate(action) {
      let timer;
      const request = new Promise((resolve, reject) => {
        received = resolve;
        timer = setTimeout(() => reject(new Error('No intercepted waitlist request arrived')), 5000);
      });
      try { await action(); await request; } finally { clearTimeout(timer); }
    }
    async function retained() {
      return await form.locator('#waitlist-email').inputValue() === 'offline-proof@example.invalid' && await form.locator('input[name="computer"][value="linux"]').isChecked() && await form.locator('input[name="agent"][value="codex"]').isChecked();
    }
    const sent = [];
    await form.route('**/.herenow/data/waitlist', async route => {
      sent.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      await new Promise(resolve => { respond = response => resolve(route.fulfill(response)); received(); });
    });
    await form.goto(url);
    await step('5.2', 'missing and malformed email are refused without a request', async () => {
      await form.locator('#waitlist-submit').click();
      await form.locator('#waitlist-email').fill('invalid');
      await form.locator('#waitlist-submit').click();
      return [sent.length === 0 && await form.locator('#waitlist-form').getAttribute('data-waitlist-state') === 'invalid', `${sent.length} requests`];
    });
    await form.locator('#waitlist-email').fill('offline-proof@example.invalid');
    await form.locator('input[name="computer"][value="linux"]').check();
    await form.locator('input[name="agent"][value="codex"]').check();
    await step('5.1', 'pending keyboard activation submits once and leaves focus on submit', async () => {
      await form.locator('#waitlist-submit').focus();
      await activate(() => form.keyboard.press('Enter'));
      await form.waitForFunction(() => document.querySelector('#waitlist-form').dataset.waitlistState === 'pending');
      await form.keyboard.press('Enter');
      return [sent.length === 1 && await form.evaluate(() => document.activeElement.id) === 'waitlist-submit', `${sent.length} request; focus ${await form.evaluate(() => document.activeElement.id)}`];
    });
    await step('5.2', 'a rate limit retains email and choices, and completion does not steal focus after Tab', async () => {
      await form.keyboard.press('Tab');
      const focus = await form.evaluate(() => document.activeElement.outerHTML);
      respond({ status: 429, contentType: 'application/json', body: '{"error":"rate_limit"}' });
      await form.waitForFunction(() => document.querySelector('#waitlist-form').dataset.waitlistState === 'rate-limited');
      const kept = await retained();
      return [kept && await form.evaluate(() => document.activeElement.outerHTML) === focus, `input retained ${kept}; ${await form.locator('#waitlist-status').textContent()}`];
    });
    for (const [status, state] of [[403, 'refused'], [500, 'failed']]) {
      await step('5.2', `HTTP ${status} preserves the form for retry`, async () => {
        await activate(() => form.locator('#waitlist-submit').tap());
          respond({ status, contentType: 'application/json', body: '{"error":"offline proof"}' });
        await form.waitForFunction(expected => document.querySelector('#waitlist-form').dataset.waitlistState === expected, state);
        return [await retained(), await form.locator('#waitlist-status').textContent()];
      });
    }
    await step('5.1', 'touch retry reports joined only after acceptance and reuses the unchanged request key', async () => {
      await activate(() => form.locator('#waitlist-submit').tap());
      const pending = await form.locator('#waitlist-form').getAttribute('data-waitlist-state') === 'pending';
      respond({ status: 201, contentType: 'application/json', body: '{"record":{"id":"offline-only"}}' });
      await form.waitForFunction(() => document.querySelector('#waitlist-form').dataset.waitlistState === 'joined');
      const keys = new Set(sent.map(request => request.key));
      measured.offlineWaitlist = { requests: sent.length, distinctKeys: keys.size, requestsInterceptedLocally: true, first: sent[0] };
      return [pending && keys.size === 1 && !!sent[0].key, `local responses only; ${sent.length} attempts, ${keys.size} idempotency key`];
    });
    await picture(form.locator('#waitlist'), 'offline-synthetic-joined-390.png');
    await form.close();
  } else {
    check('5.1', 'live waitlist insertion awaits owner approval and an owner-provided address', undefined, 'No live form submitted. Offline transport proof is separate.');
  }

  // 1.6: at phone width, every standalone control is at least 44 px high, and keyboard focus is seen, unclipped.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  await phone.goto(url);
  await step('5.4', 'menu and hero open the same waitlist; one keyboard action opens its disclosure', async () => {
    await phone.locator('.site-header a[href="#waitlist"]').focus();
    await phone.keyboard.press('Enter');
    const menu = new URL(phone.url()).hash === '#waitlist';
    await phone.locator('.hero a[href="#waitlist"]').tap();
    const hero = new URL(phone.url()).hash === '#waitlist';
    await phone.locator('#waitlist-disclosure summary').focus();
    await phone.keyboard.press('Enter');
    const disclosure = await phone.locator('#waitlist-disclosure p').first().isVisible();
    const promise = await phone.locator('#waitlist-promise').isVisible() && await phone.locator('#waitlist-ai').isVisible();
    return [menu && hero && disclosure && promise, `menu ${menu}, hero ${hero}, disclosure ${disclosure}, adjacent promise and AI disclosure ${promise}`];
  });
  await step("1.6", "at 390 px, every header, footer, text-link and waitlist submit control is at least 44 CSS px high", async () => {
    const controls = await phone.locator(".site-header a, .site-footer a, .text-link, #waitlist-submit, #waitlist-email, .waitlist-choice, #waitlist-disclosure summary").evaluateAll((all) => all.map((control) => ({ name: control.textContent.trim(), height: Math.round(control.getBoundingClientRect().height) })));
    measured.controls = controls;
    const short = controls.filter(({ height }) => height < 44);
    return [controls.length > 0 && short.length === 0, short.length === 0 ? `${controls.length} controls, the lowest ${Math.min(...controls.map(({ height }) => height))} px` : short.map(({ name, height }) => `${name}: ${height} px`).join("; ")];
  });
  await step("1.6", "at 390 px, keyboard focus on the email field and the waitlist submit control is visible and not clipped by its panel", async () => {
    const seen = [];
    for (const selector of ["#waitlist-email", "#waitlist-submit"]) {
      await phone.keyboard.press("Tab"); // keyboard focus, so :focus-visible applies
      await phone.locator(selector).focus();
      seen.push(await phone.locator(selector).evaluate((control) => {
        const style = getComputedStyle(control);
        const extent = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
        const rect = control.getBoundingClientRect();
        const box = control.closest("#waitlist-form").getBoundingClientRect();
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, inside: rect.left - extent >= box.left && rect.right + extent <= box.right && rect.top - extent >= box.top && rect.bottom + extent <= box.bottom };
      }));
    }
    await picture(phone.locator("#waitlist-form"), "focus-390.png");
    measured.focus = seen;
    return [seen.every(({ width, style, inside }) => width > 0 && style !== "none" && inside), JSON.stringify(seen)];
  });
  await phone.close();

  // 1.7: text enlarged to 200% at 320 and 390 px keeps headers, headings and the waitlist submit control readable and whole.
  const problems = [];
  for (const width of [320, 390]) for (const route of ["home", "not found"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
    await page.goto(route === "home" ? url : new URL("missing-page", url).href);
    const issues = await page.evaluate(() => {
      for (const [element, size] of [...document.querySelectorAll("body, body *")].map((element) => [element, parseFloat(getComputedStyle(element).fontSize)])) element.style.setProperty("font-size", `${size * 2}px`, "important");
      const rects = (element) => { const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()]; };
      const found = [];
      const header = [...document.querySelectorAll(".site-header a")].map((element) => ({ text: element.textContent.trim(), rects: rects(element) }));
      for (let i = 0; i < header.length; i++) for (let j = i + 1; j < header.length; j++) {
        if (header[i].rects.some((a) => header[j].rects.some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))) found.push(`${header[i].text} overlaps ${header[j].text}`);
      }
      for (const element of [...document.querySelectorAll(".site-header a, h1, #waitlist-title, .email-label, #waitlist-form legend, .waitlist-choice, #waitlist-promise, #waitlist-ai, #waitlist-disclosure")]) if (rects(element).some((rect) => rect.left < 0 || rect.right > innerWidth + 1)) found.push(`${element.textContent.trim()} runs off the screen`);
      const button = document.querySelector("#waitlist-submit");
      if (button) {
        const box = button.closest("#waitlist-form").getBoundingClientRect();
        if ([button.getBoundingClientRect(), ...rects(button)].some((rect) => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom)) found.push("the waitlist submit control is clipped by its panel");
        if (button.hidden || getComputedStyle(button).visibility === "hidden") found.push("the waitlist submit control is not shown");
      }
      if (document.documentElement.scrollWidth > innerWidth) found.push(`the page scrolls sideways (${document.documentElement.scrollWidth} px wide)`);
      return found;
    });
    await picture(page, `text200-${route === "home" ? "home" : "404"}-${width}.png`);
    problems.push(...issues.map((issue) => `${route} at ${width} px: ${issue}`));
    await page.close();
  }
  check("1.7", "with text at 200% at 320 and 390 px, home and not-found headers do not overlap, nothing runs off the screen or scrolls sideways, and the waitlist submit control stays whole", problems.length === 0, problems.join("; ") || "home and not found, at 320 and 390 px");

  // 2.3, 2.1: the text and waitlist form come first; then the live scene draws the saved plan's islands.
  const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await live.addInitScript(() => localStorage.setItem("storytree-opening-seen", "yes"));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let requested = false;
  await live.route(/forest-scene-[^/]*\.js$/, async (route) => { requested = true; await held; await route.continue(); });
  await live.goto(url, { waitUntil: "load" });
  await step("2.3", "before the 3D scene's code arrives, the heading and the waitlist form work before the scene arrives", async () => {
    const ready = (await live.locator("h1").isVisible()) && (await live.locator("#waitlist-form").isVisible());
    await live.locator('#waitlist-email').fill('invalid');
    await live.locator('#waitlist-submit').click();
    const invalid = await live.locator('#waitlist-form').getAttribute('data-waitlist-state') === 'invalid';
    return [ready && invalid, `scene code requested yet: ${requested}; form validation available ${invalid}`];
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
      const usable = (await page.locator("#waitlist-email").isVisible()) && (await page.locator("#waitlist-submit").isVisible());
      await picture(page.locator("#website-forest"), `forest-still-${how.startsWith("WebGL") ? "no-webgl" : "scene-fails"}.png`);
      return [state === "still" && still && usable, `state ${state}, still shown ${still}, waitlist usable ${usable}`];
    });
    await page.close();
  }
} finally {
  await browser.close();
  await plainBrowser.close();
  server.close();
}
await writeFile(path.join(out, "measurements.json"), JSON.stringify(measured, null, 2) + "\n");
const where = values.url === undefined ? "the locally built site (packages/website/dist), with waitlist writes intercepted locally" : `the published site, ${values.url}`;
console.log(JSON.stringify({ story: "The website", commit: values.commit, evidence: values.evidence, note: `visited ${where}`, checks }, null, 2));
