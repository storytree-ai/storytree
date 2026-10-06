/**
 * The capture kit's promises to a renderer evidence capture: a fake bridge that fails naming the
 * method it cannot answer, a launch that finds Playwright on any machine, and seeded work states
 * the arc surface and the forest read.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import type { Page } from "playwright-core";

import type { Line, NewLine } from "@storytree/agent-link";
import { workStates } from "@storytree/arc-surface";

import { fakeBridge, launchPlan, outputFolder, seedWorkStates, visibleGlobeTargets, zoomGlobe } from "./index.js";

const checkout = path.resolve(import.meta.dirname, "../../../..");

test("a capture finds front-facing dots and islands in canvas coordinates, excluding hidden and off-screen targets", async () => {
  const { Scene, Group, Object3D, OrthographicCamera } = createRequire(path.join(checkout, "packages/forest-world/package.json"))("three");
  const scene = new Scene(), globe = new Group();
  globe.name = "globe";
  scene.add(globe);
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 20;
  camera.updateMatrixWorld();
  const target = (name: string, x: number, z: number, parent = globe) => {
    const object = new Object3D();
    object.name = name;
    object.userData.id = name.split(":")[1];
    object.position.set(x, 0, z);
    parent.add(object);
    return object;
  };
  target("knowledge-point:front", 1, 2);
  target("knowledge-point:back", 0, -2);
  target("knowledge-point:offscreen", 8, 2);
  target("planet:island", -2, 3);
  const hidden = new Group();
  hidden.visible = false;
  globe.add(hidden);
  target("knowledge-point:hidden", 0, 2, hidden);
  scene.updateMatrixWorld(true);
  const state = { scene, camera, gl: { domElement: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) } } };
  const page = { evaluate: async (source: string) => runInNewContext(source, { globalThis: { __globe: state } }) } as unknown as Page;
  const found = await visibleGlobeTargets(page);
  assert.deepEqual(JSON.parse(JSON.stringify(found)), {
    zoom: 1,
    dots: [{ id: "front", x: 580, y: 350 }],
    islands: [{ id: "island", x: 340, y: 350 }],
  });
  assert.equal((await visibleGlobeTargets(page, { x: 0.1, y: 0.6 })).dots.length, 0);
  globe.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  assert.deepEqual(Array.from((await visibleGlobeTargets(page)).dots, dot => dot.id), ["back"]);
  await assert.rejects(visibleGlobeTargets({ evaluate: async (source: string) => runInNewContext(source, { globalThis: {} }) } as unknown as Page), /capture.*globe/i);
});

test("a capture zooms by wheel to a target scale and back, and refuses an unreachable scale", async () => {
  const camera = { zoom: 2, isOrthographicCamera: true };
  const state = { camera, controls: { minZoom: 0.1, maxZoom: 30 }, gl: { domElement: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) } } };
  const evaluate = async (source: string) => runInNewContext(source, { globalThis: { __globe: state } });
  const moves: number[][] = [], wheels: number[] = [];
  const page = { evaluate,
    mouse: { move: async (x: number, y: number) => { moves.push([x, y]); }, wheel: async (_x: number, y: number) => { wheels.push(y); camera.zoom *= y < 0 ? 1 / 0.95 : 0.95; } },
    waitForFunction: async (source: string) => { assert.ok(await evaluate(source), "wait until the wheel changed the camera"); },
  } as unknown as Page;
  const close = 2 / 0.95 ** 8;
  assert.ok(Math.abs(await zoomGlobe(page, close) - close) < 1e-12);
  assert.equal(wheels.length, 8);
  assert.deepEqual(moves[0], [500, 350]);
  assert.ok(Math.abs(await zoomGlobe(page, 2, { x: 580, y: 350 }) - 2) < 1e-12);
  assert.equal(wheels.length, 16);
  await assert.rejects(zoomGlobe(page, 31), /outside.*0\.1.*30/);
  await assert.rejects(zoomGlobe(page, Number.NaN), /positive.*finite/);
  assert.equal(wheels.length, 16, "bad targets never send a wheel event");
  page.waitForFunction = async () => { throw new Error("wheel blocked by an overlay"); };
  await assert.rejects(zoomGlobe(page, close), /wheel did not change zoom.*canvas receives the pointer/);
});

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

test("a capture launches an installed browser channel when one is named, and a Chromium named by path wins over it", () => {
  assert.equal(launchPlan({ env: { CAPTURE_CHANNEL: "chrome" }, platform: "linux" }).options.channel, "chrome");
  assert.equal(launchPlan({ env: {}, platform: "linux" }).options.channel, undefined);
  const named = launchPlan({ env: { CAPTURE_CHANNEL: "chrome", CAPTURE_CHROMIUM: "/opt/chromium" }, platform: "linux" }).options;
  assert.equal(named.executablePath, "/opt/chromium");
  assert.equal(named.channel, undefined);
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

test("a capture run to check it writes to a scratch folder, and re-takes into its own folder only when named", () => {
  const folder = path.join(checkout, "packages", "forest", "evidence", "sessions-list");
  const scratch = outputFolder(folder, { argv: ["node", "capture.mjs"], tmp: "/scratch" });
  assert.notEqual(scratch, folder);
  assert.ok(scratch.startsWith(path.join("/scratch", "")), scratch);
  assert.notEqual(outputFolder(path.join(checkout, "packages", "forest", "evidence", "wisps"), { argv: [], tmp: "/scratch" }), scratch, "two evidence folders get two scratch folders");
  assert.equal(outputFolder(folder, { argv: ["node", "capture.mjs", "--retake"], tmp: "/scratch" }), folder);
});
