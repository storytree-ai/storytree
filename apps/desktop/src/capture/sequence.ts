/**
 * Capability 2 · Storytree projects. A turn, tilt or zoom of the map as a seeded frame sequence and one captioned contact sheet:
 * Claude takes no video, so motion reaches it as pictures (2.65). The pose is set in code at each step, never dragged, so the same
 * call takes the same frames; the sheet is an HTML grid drawn in the same browser, so no image library is needed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";

import { settle as settleFrames } from "./runner.js";

export type SequenceKind = "turn" | "tilt" | "zoom";

/**
 * The map's pose as its user sets it, the eye standing still: `turn` the sheet's heading, spun about its upright axis through the
 * middle of the view, anticlockwise on its top face; `tilt` how far the sheet is tipped from facing the eye square-on, its north
 * edge away (0 straight down on its top face, 90 edge-on, 180 straight up at its underside); both in degrees. `zoom` in CSS pixels
 * per unit at the middle of the view, as the wheel measures it.
 */
export interface MapPose {
  turn: number;
  tilt: number;
  zoom: number;
}

export interface SequenceOptions {
  kind: SequenceKind;
  /** Frames from `from` to `to`, evenly spaced, both ends included; six unless asked. */
  frames?: number;
  from: number;
  to: number;
  /** The folder the frames and the sheet are written to (a capture's `out`). */
  out: string;
  /** The files' stem: `<view>-01.png` … and `<view>-sheet.png`. */
  view: string;
  settle?: (page: Page) => Promise<void>;
}

export interface SequenceCell {
  step: number;
  caption: string;
  /** The frame's place on the sheet, in its pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Sequence {
  frames: { step: number; file: string; pose: MapPose }[];
  sheet: { file: string; width: number; cells: SequenceCell[] };
}

/** As wide as Claude reads one image at full size (its long edge), so a sheet costs one image. */
const SHEET_WIDTH = 2576;

// Quaternion arithmetic on plain { x, y, z, w }, as text, not a function, so tsx copies none of its helpers into the page. The sheet
// is posed as the map's own navigation poses it (sheetTilted): spun about the eye's axis, then tipped about the window's
// horizontal line through the middle of the view, which stays where it is.
const POSE = `const mul = (a, b) => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });
  const about = (axis, angle) => ({ x: axis.x * Math.sin(angle / 2), y: axis.y * Math.sin(angle / 2), z: axis.z * Math.sin(angle / 2), w: Math.cos(angle / 2) });
  const turned = (q, v) => { const r = mul(mul(q, { ...v, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w }); return { x: r.x, y: r.y, z: r.z }; };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const state = globalThis.__globe;
  if (!state?.camera) throw new Error('Capture sequence needs the map; use buildCapture and wait for the globe');
  const { camera, controls, size, scene } = state, sheet = scene.getObjectByName('globe');
  if (!sheet || !controls?.target || !globalThis.__nav?.onRotate) throw new Error('Capture sequence needs the map\\'s sheet, its controls and its navigation; wait for the globe');
  const eye = { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w };
  const upright = turned(eye, { x: 0, y: 0, z: 1 }), across = turned(eye, { x: 1, y: 0, z: 0 }), above = turned(eye, { x: 0, y: 1, z: 0 });
  const pivot = { x: controls.target.x, y: controls.target.y, z: controls.target.z }, held = Math.hypot(pivot.x, pivot.y, pivot.z);
  const focal = Math.max(size.height, 1) / 2 / Math.tan(camera.fov * Math.PI / 360);
  const now = { x: sheet.quaternion.x, y: sheet.quaternion.y, z: sheet.quaternion.z, w: sheet.quaternion.w };
  const tilt = Math.acos(Math.min(1, Math.max(-1, dot(turned(now, { x: 0, y: 0, z: 1 }), upright))));
  const north = turned(mul(about(across, tilt), now), { x: 0, y: 1, z: 0 });
  const turn = Math.atan2(-dot(north, across), dot(north, above));
  const zoom = focal / (Math.hypot(camera.position.x, camera.position.y, camera.position.z) - held);
  const range = { min: focal / (controls.maxDistance ?? Infinity), max: focal / (controls.minDistance ?? 0) };`;

const READ_POSE = `(() => { ${POSE}
  return { pose: { turn: turn * 180 / Math.PI, tilt: tilt * 180 / Math.PI, zoom }, range };
})()`;

const setPose = (pose: MapPose) => `(pose => { ${POSE}
  // The sheet as it stands without its spin and tip (its pan alone), then spun and tipped as asked.
  const base = mul(about(upright, -turn), mul(about(across, tilt), now));
  const tip = about(across, -pose.tilt * Math.PI / 180), next = mul(tip, mul(about(upright, pose.turn * Math.PI / 180), base));
  const moved = turned(tip, pivot), centre = [pivot.x - moved.x, pivot.y - moved.y, pivot.z - moved.z];
  globalThis.__nav.onRotate(next, centre);
  // The eye moves along its line of sight, as the wheel moves it: a zoom moves the eye, never the lens.
  const away = held + focal / pose.zoom, length = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
  camera.position.set(camera.position.x * away / length, camera.position.y * away / length, camera.position.z * away / length);
  camera.updateMatrixWorld();
  state.invalidate();
})(${JSON.stringify(pose)})`;

/** The sheet's and the eye's pose as they stand, to put back exactly once the sequence is taken. */
const SAVE = `(() => {
  const { camera, scene } = globalThis.__globe, sheet = scene.getObjectByName('globe');
  return { rotation: { x: sheet.quaternion.x, y: sheet.quaternion.y, z: sheet.quaternion.z, w: sheet.quaternion.w },
    centre: [sheet.position.x, sheet.position.y, sheet.position.z], eye: [camera.position.x, camera.position.y, camera.position.z] };
})()`;

const restore = (saved: unknown) => `(saved => {
  const state = globalThis.__globe, { camera } = state;
  globalThis.__nav.onRotate(saved.rotation, saved.centre);
  camera.position.set(...saved.eye);
  camera.updateMatrixWorld();
  state.invalidate();
})(${JSON.stringify(saved)})`;

const UNITS: Record<SequenceKind, (value: number) => string> = {
  turn: value => `${round(value)}°`,
  tilt: value => `${round(value)}°`,
  zoom: value => `${round(value)}×`,
};

function round(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

/**
 * Takes `frames` pictures of the map with its sheet turned or tilted, or the eye zoomed, evenly from `from` to `to`, the rest of
 * the pose kept, each after the map has settled, then one contact sheet of them in order, each cell captioned with its step and
 * value, and puts the map back as it was.
 */
export async function captureSequence(page: Page, { kind, frames = 6, from, to, out, view, settle = settleFrames }: SequenceOptions): Promise<Sequence> {
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`A capture sequence takes a whole number of frames, at least 1, not ${frames}`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("A capture sequence's from and to must be finite");
  // The sheet is drawn in a page of the map's browser; a page whose context has none (an Electron window) cannot make one.
  const browser = page.context().browser();
  if (browser === null) throw new Error("A capture sequence draws its contact sheet in the map's browser; this page has none to open a page in");
  const values = Array.from({ length: frames }, (_, step) => frames === 1 ? from : from + (to - from) * step / (frames - 1));
  const { pose: opening, range } = await page.evaluate(READ_POSE) as { pose: MapPose; range: { min: number; max: number } };
  for (const value of values) {
    if (kind === "zoom" && !(value > 0 && value >= range.min * 0.999 && value <= range.max * 1.001)) {
      throw new Error(`Capture zoom ${value} is outside the controls' ${round(range.min)}–${round(range.max)}`);
    }
    if (kind === "tilt" && !(value >= 0 && value <= 180)) throw new Error(`Capture tilt ${value} must be between 0° (straight down on the sheet) and 180° (straight up at its underside)`);
  }
  const saved = await page.evaluate(SAVE);
  const taken: Sequence["frames"] = [];
  try {
    for (const [index, value] of values.entries()) {
      await page.evaluate(setPose({ ...opening, [kind]: value }));
      await settle(page);
      const file = path.join(out, `${view}-${String(index + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: file, timeout: 180_000 });
      taken.push({ step: index + 1, file, pose: (await page.evaluate(READ_POSE) as { pose: MapPose }).pose });
    }
  } finally {
    await page.evaluate(restore(saved));
    await settle(page);
  }
  const captions = values.map((value, index) => `${index + 1} · ${kind} ${UNITS[kind](value)}`);
  return { frames: taken, sheet: await contactSheet(browser, taken.map(frame => frame.file), captions, path.join(out, `${view}-sheet.png`)) };
}

/** The frames in a grid as wide as one image Claude reads, each under its caption, drawn and photographed in a page of its own. */
async function contactSheet(browser: Browser, files: string[], captions: string[], file: string): Promise<Sequence["sheet"]> {
  const columns = Math.min(files.length, Math.max(3, Math.ceil(Math.sqrt(files.length))));
  // A page of its own in the same browser, so the sheet is not drawn at the map's viewport or in its context.
  const sheet = await browser.newPage({ viewport: { width: SHEET_WIDTH, height: 400 }, deviceScaleFactor: 1 });
  try {
    const cells = files.map((frame, index) => `<figure><figcaption>${captions[index]}</figcaption><img src="data:image/png;base64,${readFileSync(frame).toString("base64")}"></figure>`).join("");
    await sheet.setContent(`<style>
      body { margin: 0; padding: 8px; background: #0e1418; color: #e8eef0; font: 600 22px system-ui, sans-serif;
        display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 8px; width: ${SHEET_WIDTH}px; box-sizing: border-box; }
      figure { margin: 0; } figcaption { padding: 4px 2px 6px; } img { display: block; width: 100%; }
    </style>${cells}`);
    await sheet.evaluate(`Promise.all(Array.from(document.images, image => image.decode()))`);
    const placed = await sheet.evaluate(`Array.from(document.images, image => { const box = image.getBoundingClientRect();
      return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height }; })`) as Omit<SequenceCell, "step" | "caption">[];
    await sheet.screenshot({ path: file, fullPage: true, timeout: 180_000 });
    return { file, width: SHEET_WIDTH, cells: placed.map((box, index) => ({ step: index + 1, caption: captions[index]!, ...box })) };
  } finally {
    await sheet.close();
  }
}
