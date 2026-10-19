/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built" (increment_9294d76b04cf, ADR-1046, reworked
 * from the owner's notes in increment_4695144e6847 and polished in increment_ea834305fe2d and increment_fa48e88589f9): the same
 * developer at the same desk on both halves, and on the storytree side's screen the real map. The forest's own view draws the
 * shop's glass sheet, with the wishlist's new island, off screen (view.ts's MAP), lit by the selection when the developer clicks
 * it; each frame draws it by hand and hands it to the scene, which draws the one 480×270 canvas the page shows ×4 with no
 * smoothing. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { RootState } from "@react-three/fiber";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import type { CastMap } from "./cast.js";
import { drawScene, mapFit, SCRIPT, type Marks, type Words } from "./scene.js";
import { FONT, LOW, SCALE, SCREEN } from "./script.js";
import { MAP, mapProps, quantise, selectedAt, snapshot } from "./view.js";

const TITLES = new Map(snapshot.scene.islands.map(island => [island.story, island.title]));
/** The seam the forest hands an evidence capture its canvas's live state through (PlanetWorldCanvas's CAPTURE_SEAM). */
const CAPTURE_SEAM = "__storytreeCaptureGlobe";
/** The page asks the forest's view for reduced motion, which it honours by standing every transition (a selection's light,
 * land drawing on, islands moving) at its end: those play on the wall clock, so otherwise a frame would show wherever one had
 * got to when a machine, slower or faster, captured it, and not a picture of its own moment. */
const REDUCE = "(prefers-reduced-motion: reduce)";
if (typeof window !== "undefined") {
  const media = window.matchMedia.bind(window), reduced = Object.assign(new EventTarget(), {
    matches: true, media: REDUCE, onchange: null, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
  window.matchMedia = query => query === REDUCE ? reduced : media(query);
}
const nextFrame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));

/** Text in the pixel font on its own layer, every pixel either fully drawn or not at all: no soft edges. */
function pixelText(ctx: CanvasRenderingContext2D, words: readonly Words[]): void {
  const layer = new OffscreenCanvas(LOW.width, LOW.height).getContext("2d")!;
  layer.font = `8px "${FONT}"`;
  layer.textBaseline = "top";
  for (const { text, x, y, colour, centre } of words) {
    layer.fillStyle = colour;
    layer.fillText(text, centre ? Math.round(x - layer.measureText(text).width / 2) : x, y);
  }
  const image = layer.getImageData(0, 0, LOW.width, LOW.height);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = image.data[i]! >= 128 ? 255 : 0;
  layer.putImageData(image, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
}

/** The pixel font, the cast's sheet and its frame map, loaded once before the first frame draws. */
async function loadAssets(): Promise<{ cast: CastMap; sheet: HTMLImageElement }> {
  const face = await new FontFace(FONT, `url(${staticFile("fonts/PressStart2P-Regular.ttf")})`).load();
  document.fonts.add(face);
  const cast = await (await fetch(staticFile("sprites/cast.json"))).json() as CastMap;
  const sheet = new Image();
  sheet.src = staticFile(cast.image);
  await sheet.decode();
  return { cast, sheet };
}

/** The forest's drawing at the moment, shrunk by averaging (so its thin lit edges survive) to the full screen, or to `fit` of it
 * while the panel stands beside it, and put into the map's palette. */
function shrinkView(state: RootState, at: number, fit = 1): HTMLCanvasElement | OffscreenCanvas {
  state.advance(at);
  const [width, height] = [Math.round(SCREEN.full.width * fit), Math.round(SCREEN.full.height * fit)];
  const map = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  map.imageSmoothingEnabled = true;
  map.imageSmoothingQuality = "high";
  map.drawImage(state.gl.domElement, 0, 0, width, height);
  const pixels = map.getImageData(0, 0, width, height);
  quantise(pixels.data);
  map.putImageData(pixels, 0, 0);
  return map.canvas;
}

/** Aims the view, then waits until it has drawn every island in the same place, and the same picture, several times running:
 * its roads are routed after its islands draw, later on a busy machine. Then hands back where each island is. */
async function settled(controls: GlobeControls, get: () => RootState): Promise<Marks> {
  // The sheet tilted toward the eye by the app's own key for it (r, a step at a time), so the shop's rows stand taller.
  for (let step = 0; step < MAP.tilt; step++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
  controls.stop({ target: { kind: "story", story: MAP.aim.story }, framing: MAP.aim.framing, sideOffset: MAP.aim.sideOffset, duration: 0 });
  let last = "", same = 0;
  for (;;) {
    await new Promise(done => setTimeout(done, 150));
    const islands = controls.islands().filter(island => island.width > 0);
    const canvas = shrinkView(get(), 0), seen = (canvas as OffscreenCanvas).getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const now = JSON.stringify(islands) + seen.join(",");
    same = islands.length && now === last ? same + 1 : 0;
    last = now;
    if (same >= 4) return { islands: islands.map(island => ({ ...island, title: TITLES.get(island.story) ?? "" })) };
  }
}

/** `lateBy` holds each frame's capture back that many milliseconds, as a slow machine does. */
export function SeeingWhatAgentsBuilt({ lateBy = 0 }: { lateBy?: number }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const shown = useRef<HTMLCanvasElement>(null);
  const [get, setGet] = useState<() => RootState>();
  const [controls, setControls] = useState<GlobeControls>();
  const [marks, setMarks] = useState<Marks>();
  const [assets, setAssets] = useState<{ cast: CastMap; sheet: HTMLImageElement }>();
  const [loading] = useState(() => delayRender("The map, the pixel font and the cast load"));
  const core = useMemo(() => createKnowledgeCore(snapshot.project), []);
  useState(() => { (globalThis as Record<string, unknown>)[CAPTURE_SEAM] = (state: () => RootState) => setGet(() => state); });
  useEffect(() => { void loadAssets().then(setAssets); }, []);
  useEffect(() => { if (controls && get) void settled(controls, get).then(setMarks); }, [controls, get]);
  useEffect(() => { if (get && assets && marks) continueRender(loading); }, [get, assets, marks, loading]);
  const seconds = frame / fps, selected = selectedAt(SCRIPT.with, seconds);
  const ignore = useCallback(() => {}, []);
  useLayoutEffect(() => {
    if (!get || !assets || !marks) return;
    // The view takes a selection on its own renderer's next pass, so the frame is drawn once that has run.
    const drawing = delayRender(`frame ${frame}`);
    void new Promise(done => setTimeout(done, lateBy)).then(nextFrame).then(() => {
      const map = shrinkView(get(), frame * 1000 / fps, mapFit(seconds));
      const ctx = shown.current!.getContext("2d")!;
      pixelText(ctx, drawScene(ctx, { seconds, frames: durationInFrames, cast: assets.cast, sheet: assets.sheet, view: map,
        map: { width: MAP.width, height: MAP.height, marks } }));
      continueRender(drawing);
    });
  }, [get, assets, marks, frame, fps, seconds, durationInFrames, selected, lateBy]);
  return <AbsoluteFill style={{ background: "#000" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: MAP.width, height: MAP.height, isolation: "isolate", zIndex: 0 }}>
      <PlanetView {...mapProps(selected)} core={core} onPick={ignore} onNote={ignore} onControls={setControls} />
    </div>
    <canvas ref={shown} width={LOW.width} height={LOW.height}
      style={{ position: "absolute", left: 0, top: 0, zIndex: 1, width: LOW.width * SCALE, height: LOW.height * SCALE, imageRendering: "pixelated" }} />
  </AbsoluteFill>;
}
