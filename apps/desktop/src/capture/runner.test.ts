import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";

import { browserProcess, closeBrowser, fakeBridge, outputFolder, runCapture, settle, withCapture } from "./index.js";

test("2.9 · capture settling awaits each requested frame after invalidating the globe", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluate(`(() => {
    globalThis.events = [];
    globalThis.__globe = { invalidate() { events.push("invalidate"); } };
    const nextFrame = requestAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = callback => nextFrame(time => {
      events.push("frame");
      callback(time);
    });
  })()`);

  for (const frames of [3, undefined, 0]) {
    await page.evaluate("events.length = 0");
    await settle(page, frames);
    assert.deepEqual(await page.evaluate("events"),
      Array.from({ length: frames ?? 12 }, () => ["invalidate", "frame"]).flat(),
      "each redraw request is followed by a completed frame before settling returns");
  }

  await page.evaluate("delete globalThis.__globe; events.length = 0");
  await settle(page, 2);
  assert.deepEqual(await page.evaluate("events"), ["frame", "frame"],
    "a page without a globe hook still awaits its frames");
});

test("2.12 · a capture's stand-in bridge opens the page with the first-run guide already seen, unless the capture pictures the guide", async t => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const guideSeen = async (options?: { guide: "unseen" }) => {
    const page = await browser.newPage();
    await page.route("http://capture.test/**", route => route.fulfill({ contentType: "text/html", body: "<body>capture fixture</body>" }));
    await fakeBridge({}, options).install(page);
    await page.goto("http://capture.test/index.html");
    const seen = await page.evaluate(() => localStorage.getItem("storytree:setup:guide-seen:v1"));
    await page.close();
    return seen;
  };
  assert.equal(await guideSeen(), "yes", "the renderer's guideOffered reads exactly 'yes' as seen, so the page opens on the globe");
  assert.equal(await guideSeen({ guide: "unseen" }), null, "a capture of the guide itself opts back in to a first launch");
});

// Each probe owns its socket and finishes only after it closes. Global fetch leaves
// connection cleanup running, which can abort native Windows Node at test-force-exit.
function readPage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let failure: Error | undefined;
    const request = get(url, { agent: false }, response => {
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", error => { failure = error; });
    });
    request.on("error", error => { failure = error; });
    request.on("close", () => { if (failure) reject(failure); else resolve(body); });
  });
}

test("a seed-and-views capture uses workspace Playwright and quiet bridge reads, and closes its server and browser", async t => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-capture-runner-"));
  t.after(() => { rmSync(folder, { recursive: true, force: true }); rmSync(outputFolder(folder), { recursive: true, force: true }); });
  writeFileSync(path.join(folder, "index.html"), "<body>capture fixture</body>");
  let call!: (method: string, args: unknown[]) => Promise<unknown>;
  let origin = "", closed = 0;
  const page = {
    on() { return page; },
    async exposeFunction(_name: string, fn: typeof call) { call = fn; },
    async addInitScript() {},
    async goto(url: string) {
      origin = new URL(url).origin;
      assert.equal(await readPage(url), "<body>capture fixture</body>");
      assert.deepEqual(await call("listProjects", []), ["sample"]);
      assert.deepEqual(await call("readSignIn", []), { available: false, on: false });
    },
    async waitForFunction() {},
    async evaluate() {},
    async close() {},
  } as unknown as Page;
  const browser = Object.assign(new EventEmitter(), { isConnected: () => true, async newPage() { return page; }, async close() { closed++; } }) as unknown as Browser;
  // This is the workspace package. A runner importing a machine-specific copy would miss this mock.
  const launch = t.mock.method(chromium, "launch", async () => browser);
  const seed = { projects: ["sample"], tree: { stories: [], arcs: [] }, changes: { changes: [], cursor: 0 }, lines: { lines: [], cursor: 0 }, covers: {} };
  await runCapture({ folder, dist: folder, seed, views: [{ name: "quiet", picture: false,
    measure: async ({ bridge }) => bridge.call("agentConnections", []),
    expect: value => assert.deepEqual(value, []),
  }] });
  assert.equal(launch.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(outputFolder(folder), "quiet.json"), "utf8")), []);
  assert.equal(closed, 1);
  await assert.rejects(readPage(origin));

  await assert.rejects(runCapture({ folder, dist: folder, seed, views: [{ name: "broken", picture: false,
    prepare: () => { throw new Error("view failed"); },
  }] }), /view failed/);
  assert.equal(closed, 2, "a failed view also closes the browser");
  await assert.rejects(readPage(origin), "a failed view also closes the server");
});

// PR #1279's macOS run: the browser disconnected, then browser.close() never returned and 3.35 hit its timeout.
test("2.13 · a capture whose browser disconnects but whose close never returns still ends, its server closed", async t => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-capture-hung-close-"));
  t.after(() => { rmSync(folder, { recursive: true, force: true }); rmSync(outputFolder(folder), { recursive: true, force: true }); });
  writeFileSync(path.join(folder, "index.html"), "<body>hung close</body>");
  const browser = Object.assign(new EventEmitter(), {
    isConnected: () => true,
    close() { setImmediate(() => browser.emit("disconnected")); return new Promise<void>(() => {}); },
  }) as unknown as Browser;
  t.mock.method(chromium, "launch", async () => browser);
  let origin = "";
  const ended = withCapture({ folder, dist: folder, closeGraceMs: 50 }, async context => { origin = context.origin!; return "captured"; });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise(resolve => { timer = setTimeout(resolve, 10_000, "still waiting on close"); });
  try { assert.equal(await Promise.race([ended, late]), "captured"); } finally { clearTimeout(timer); }
  await assert.rejects(readPage(origin), "the capture's server is closed too");
});

test("2.14 · a real capture browser whose close hangs after disconnect is killed, so its pipes no longer hold the run open", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const child = browserProcess(browser);
  assert.ok(child?.pid, "the kit finds the process Playwright launched");
  const close = browser.close.bind(browser);
  // The real shutdown runs, but its promise is never seen to settle, as on the loaded macOS runner.
  browser.close = () => { void close().catch(() => {}); return new Promise<void>(() => {}); };
  assert.equal(await closeBrowser(browser, { afterDisconnectMs: 50 }), "killed");
  assert.ok(child.stdio.every(stream => stream === null || stream.destroyed), "the browser's pipes are let go");
});
