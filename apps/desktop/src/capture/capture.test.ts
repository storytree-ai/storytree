/**
 * The capture kit's promises to a renderer evidence capture: a fake bridge that fails naming the
 * method it cannot answer, a launch that finds Playwright on any machine, and seeded work states
 * the arc surface and the forest read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link";
import { workStates } from "@storytree/arc-surface";

import { fakeBridge, launchPlan, seedWorkStates } from "./index.js";

test("a call the fake bridge cannot answer fails at once, naming the method", async () => {
  const bridge = fakeBridge({ listProjects: async () => ["storytree"] });
  assert.deepEqual(await bridge.call("listProjects", []), ["storytree"]);
  await assert.rejects(bridge.call("heldOnQuestion", []), /heldOnQuestion/);
  await assert.rejects(bridge.unanswered, /the fake bridge does not answer heldOnQuestion/);
});

test("a bridge method the capture left unanswered gets a safe answer, and the fake records the page asked for it", async () => {
  const bridge = fakeBridge({ listProjects: async () => ["storytree"] });
  await bridge.call("listProjects", []);
  assert.deepEqual(await bridge.call("readSignIn", []), { available: false, on: false });
  const [window] = await bridge.call("windowReadings", ["storytree", ["s1"]]) as { session: string; absent?: string }[];
  assert.equal(window?.session, "s1");
  assert.ok(window?.absent);
  assert.deepEqual(bridge.defaulted, ["readSignIn", "windowReadings"]);
});

test("on Windows, launch finds Playwright and Chromium from the checkout, with no /home path", () => {
  const plan = launchPlan({ env: {}, platform: "win32" });
  assert.equal(plan.module, "playwright-core");
  assert.equal(plan.options.executablePath, undefined);
  assert.doesNotMatch(JSON.stringify(plan), /\/home\//);
});

test("on Windows, a Playwright named by path is imported by its file URL", () => {
  const plan = launchPlan({ env: { CAPTURE_PLAYWRIGHT: "C:\\tools\\playwright-core\\index.mjs", CAPTURE_CHROMIUM: "C:\\tools\\chrome.exe" }, platform: "win32" });
  assert.equal(plan.module, "file:///C:/tools/playwright-core/index.mjs");
  assert.equal(plan.options.executablePath, "C:\\tools\\chrome.exe");
});

test("seeding a capability landed makes the work states read it landed", async () => {
  const lines: Line[] = [];
  const log = { append: async (project: string, line: NewLine) => { const kept = { ...line, project, seq: lines.length + 1, at: new Date().toISOString() } as Line; lines.push(kept); return kept; } };
  await seedWorkStates(log, "storytree", { capability_a: "landed", capability_b: "in-progress", capability_c: "planned" });
  const states = workStates(lines);
  assert.equal(states.part("capability_a"), "landed");
  assert.equal(states.part("capability_b"), "in-progress");
  assert.equal(states.part("capability_c"), "planned");
});
