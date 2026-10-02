import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";

import { outputFolder, runCapture } from "./index.js";

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
      assert.equal(await (await fetch(url)).text(), "<body>capture fixture</body>");
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
  await assert.rejects(fetch(origin));

  await assert.rejects(runCapture({ folder, dist: folder, seed, views: [{ name: "broken", picture: false,
    prepare: () => { throw new Error("view failed"); },
  }] }), /view failed/);
  assert.equal(closed, 2, "a failed view also closes the browser");
  await assert.rejects(fetch(origin), "a failed view also closes the server");
});
