import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";

import { outputFolder, runCapture, settle } from "./index.js";

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
  const browser = { async newPage() { return page; }, async close() { closed++; } } as unknown as Browser;
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
