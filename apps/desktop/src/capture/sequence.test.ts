import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, errors, type Browser, type Page } from "playwright-core";

import { removeTemp } from "@storytree/test-waits";

import { captureSequence } from "./index.js";

// Chrome is installed on the three CI runner images, as runner.test.ts's launch says; a launch that never answers is retried.
async function launchChrome(): Promise<Browser> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await chromium.launch({ channel: "chrome", headless: true, timeout: 60_000 });
    } catch (error) {
      if (attempt === 3 || !(error instanceof errors.TimeoutError)) throw error;
    }
  }
}

/**
 * A stand-in map posed as the app's is: a still eye on the z axis looking at the origin, and a sheet group spun and tipped about the
 * middle of the view, opening turned 10° and tilted 40°. Each redraw paints the page in a colour of the pose it draws, read from
 * the group's rotation matrix and the eye's distance, so each frame's picture says which pose it was taken at.
 */
async function standInMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.setContent("<body style='margin:0;width:100vw;height:100vh'></body>");
  await page.evaluate(`(() => {
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
    const vector = (x, y, z) => ({ x, y, z, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
    const quaternion = (x, y, z, w) => ({ x, y, z, w, set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } });
    const focal = 160 / Math.tan(20 * Math.PI / 180), pivot = 100;
    const camera = { isPerspectiveCamera: true, fov: 40, zoom: 1, position: vector(0, 0, pivot + focal / 2), quaternion: quaternion(0, 0, 0, 1),
      updateMatrixWorld() {}, updateProjectionMatrix() {} };
    // Spun 10° about the eye's axis, then tipped 40° about the window's horizontal, its north edge away.
    const spin = 10 * Math.PI / 360, tip = -40 * Math.PI / 360;
    const sheet = { quaternion: quaternion(Math.sin(tip) * Math.cos(spin), -Math.sin(tip) * Math.sin(spin), Math.cos(tip) * Math.sin(spin), Math.cos(tip) * Math.cos(spin)), position: vector(0, 0, 0) };
    globalThis.__globe = { camera, size: { width: 480, height: 320 }, scene: { getObjectByName: name => name === 'globe' ? sheet : undefined },
      controls: { target: vector(0, 0, pivot), minDistance: focal / 30, maxDistance: focal / 0.25 },
      invalidate() {
        const { x, y, z, w } = sheet.quaternion;
        // The rotation matrix's third column is the sheet's normal; its second, the sheet's north.
        const normal = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)], north = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
        const tilt = Math.acos(normal[2]) * 180 / Math.PI;
        // Untipped about the window's horizontal, north points at the heading, anticlockwise from the window's up.
        const t = tilt * Math.PI / 180, northUp = north[1] * Math.cos(t) - north[2] * Math.sin(t);
        const turn = Math.atan2(-north[0], northUp) * 180 / Math.PI, zoom = focal / (camera.position.z - pivot);
        document.body.style.background = 'rgb(' + [Math.round(turn) + 100, Math.round(tilt) + 20, Math.round(zoom * 40)].join(',') + ')';
      } };
    globalThis.__globe.invalidate();
  })()`);
}

/** The colour the stand-in paints for a pose. */
const painted = ({ turn, tilt, zoom }: { turn: number; tilt: number; zoom: number }) => [Math.round(turn) + 100, Math.round(tilt) + 20, Math.round(zoom * 40)];

/** The colour at each point of a PNG file, read through a canvas in `page`. */
async function colours(page: Page, file: string, points: { x: number; y: number }[]): Promise<number[][]> {
  return page.evaluate(`(async ({ src, points }) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return points.map(({ x, y }) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
  })(${JSON.stringify({ src: `data:image/png;base64,${readFileSync(file).toString("base64")}`, points })})`);
}

test("2.65 · a capture's frame sequence sets the map's turn, tilt or zoom by the asked step at each frame, and its contact sheet holds every frame in order, captioned", { timeout: 120_000 }, async t => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const out = mkdtempSync(path.join(tmpdir(), "storytree-capture-sequence-"));
  t.after(() => removeTemp(out));
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await standInMap(page);
  const opening = await page.evaluate(`({ ...globalThis.__globe.scene.getObjectByName('globe').quaternion, eye: globalThis.__globe.camera.position.z })`);
  const reader = await browser.newPage();
  const centre = { x: 240, y: 160 };
  /** The asked values, read back, and each frame's picture and sheet cell painted in the pose asked, in order. */
  const taken = async (sequence: Awaited<ReturnType<typeof captureSequence>>, kind: "turn" | "tilt" | "zoom", asked: number[]) => {
    const rest = { turn: 10, tilt: 40, zoom: 2 };
    assert.deepEqual(sequence.frames.map(frame => Math.round(frame.pose[kind] * 1e6) / 1e6), asked, `each frame's ${kind} is the asked step`);
    for (const frame of sequence.frames) {
      for (const part of ["turn", "tilt", "zoom"] as const) if (part !== kind) assert.ok(Math.abs(frame.pose[part] - rest[part]) < 1e-6, `a ${kind} keeps the ${part}`);
    }
    const expected = asked.map(value => painted({ ...rest, [kind]: value }));
    const framed = await Promise.all(sequence.frames.map(async frame => (await colours(reader, frame.file, [centre]))[0]));
    assert.deepEqual(framed, expected, "each frame pictures the map drawn in its asked pose");
    const sheeted = await colours(reader, sequence.sheet.file, sequence.sheet.cells.map(cell => ({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 })));
    assert.deepEqual(sheeted, expected, "the sheet's cells hold the frames, in order");
    assert.deepEqual(await page.evaluate(`({ ...globalThis.__globe.scene.getObjectByName('globe').quaternion, eye: globalThis.__globe.camera.position.z })`), opening, "the map is back in its opening pose after the sequence");
  };

  const turn = await captureSequence(page, { kind: "turn", frames: 4, from: -30, to: 60, out, view: "spin" });
  assert.deepEqual(turn.frames.map(frame => path.basename(frame.file)), ["spin-01.png", "spin-02.png", "spin-03.png", "spin-04.png"]);
  assert.equal(path.basename(turn.sheet.file), "spin-sheet.png");
  assert.equal(turn.sheet.width, 2576, "the sheet is as wide as Claude reads one image");
  assert.deepEqual(turn.sheet.cells.map(cell => cell.caption), ["1 · turn -30°", "2 · turn 0°", "3 · turn 30°", "4 · turn 60°"]);
  await taken(turn, "turn", [-30, 0, 30, 60]);

  const tilt = await captureSequence(page, { kind: "tilt", frames: 3, from: 0, to: 120, out, view: "lean" });
  assert.deepEqual(tilt.sheet.cells.map(cell => cell.caption), ["1 · tilt 0°", "2 · tilt 60°", "3 · tilt 120°"]);
  await taken(tilt, "tilt", [0, 60, 120]);

  const zoom = await captureSequence(page, { kind: "zoom", frames: 2, from: 1, to: 4, out, view: "near" });
  assert.deepEqual(zoom.sheet.cells.map(cell => cell.caption), ["1 · zoom 1×", "2 · zoom 4×"]);
  await taken(zoom, "zoom", [1, 4]);
  assert.ok(existsSync(path.join(out, "near-sheet.png")));

  const six = await captureSequence(page, { kind: "turn", from: 0, to: 300, out, view: "round" });
  assert.equal(six.frames.length, 6, "a sequence takes six frames unless asked for another number");

  await assert.rejects(captureSequence(page, { kind: "zoom", frames: 2, from: 1, to: 40, out, view: "far" }), /zoom 40.*outside/);
  await assert.rejects(captureSequence(page, { kind: "tilt", frames: 2, from: 0, to: 200, out, view: "top" }), /tilt 200.*between/);
  await assert.rejects(captureSequence(page, { kind: "turn", frames: 0, from: 0, to: 90, out, view: "none" }), /frames/);
});
