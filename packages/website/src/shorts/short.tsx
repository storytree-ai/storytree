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
import { drawScene, SCRIPT, type Flag, type Marks, type SceneInputs, type Words } from "./scene.js";
import { FONT, LOW, SCALE, SCREEN } from "./script.js";
import { aimAt, growthAt, MAP, mapProps, quantise, selectedAt, snapshot } from "./view.js";

/** What a short with the forest's view on its screen hands the frame that draws it: the view's canvas, its tilt and its aims
 * (each settled before the first frame), the props the view is given at a moment and where it is aimed, the palette its
 * drawing is put into, and the scene that draws a frame from the time alone. */
export type MapShort = {
  map: { width: number; height: number; tilt: number; aims: Readonly<Record<string, { framing: number; sideOffset: number; story: string }>> };
  scene: { islands: readonly { story: string; title: string }[] };
  props: (seconds: number) => Omit<Parameters<typeof PlanetView>[0], "core" | "onPick" | "onNote" | "onControls">;
  aimAt: (seconds: number) => string;
  quantise: (pixels: Uint8ClampedArray) => void;
  draw: (ctx: CanvasRenderingContext2D, inputs: SceneInputs) => Words[];
};

/** The first short, "seeing what agents built". */
export const FIRST: MapShort = { map: MAP, scene: snapshot.scene, props: seconds => mapProps(selectedAt(SCRIPT.with, seconds), growthAt(SCRIPT.with, seconds)),
  aimAt: seconds => aimAt(SCRIPT.with, seconds), quantise, draw: drawScene };
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

/** The forest's drawing at the moment, shrunk to the full screen by averaging (so its thin lit edges survive) and put into the
 * map's palette. */
function shrinkView(state: RootState, at: number, quantise: MapShort["quantise"]): HTMLCanvasElement | OffscreenCanvas {
  state.advance(at);
  const { width, height } = SCREEN.full;
  const map = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  map.imageSmoothingEnabled = true;
  map.imageSmoothingQuality = "high";
  map.drawImage(state.gl.domElement, 0, 0, width, height);
  const pixels = map.getImageData(0, 0, width, height);
  quantise(pixels.data);
  map.putImageData(pixels, 0, 0);
  return map.canvas;
}

/** Where each claim's flag the view drew stands on its canvas, in its CSS pixels: the forest names each claim's group
 * `territory-claim:<capability>` and keeps its session's colour on it (claim-flag.ts); a flag turned away with its island is left
 * out. */
function flagsOf(state: RootState): Flag[] {
  const flags: Flag[] = [], { width, height } = state.size;
  state.scene.traverse(object => {
    const flag = object.name.startsWith("territory-claim:") ? object.getObjectByName("claim-flag") : undefined;
    if (!flag?.visible) return;
    const at = flag.getWorldPosition(flag.position.clone()).project(state.camera);
    flags.push({ capability: object.userData.capability as string, colour: object.userData.colour as string,
      x: Math.round((at.x + 1) / 2 * width), y: Math.round((1 - at.y) / 2 * height) });
  });
  return flags;
}

/** Aims the view at once (the page asks for reduced motion, so the view jumps where the app would glide). */
function aim(short: MapShort, controls: GlobeControls, to: string): void {
  const { story, framing, sideOffset } = short.map.aims[to]!;
  controls.stop({ target: { kind: "story", story }, framing, sideOffset, duration: 0 });
}

/** Tilts the sheet toward the eye by the app's own key for it (r, a step at a time), so the shop's rows stand taller; then for
 * each aim, aims the view and waits until it has drawn every island in the same place, and the same picture, several times
 * running (its roads are routed after its islands draw, later on a busy machine), and hands back where each island is. The view
 * is left at the last aim. */
async function settled(short: MapShort, controls: GlobeControls, get: () => RootState): Promise<Record<string, Marks>> {
  for (let step = 0; step < short.map.tilt; step++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
  const marks: Record<string, Marks> = {}, titles = new Map(short.scene.islands.map(island => [island.story, island.title]));
  for (const to of Object.keys(short.map.aims)) { aim(short, controls, to); marks[to] = await steady(short, controls, get, titles); }
  return marks;
}

async function steady(short: MapShort, controls: GlobeControls, get: () => RootState, titles: ReadonlyMap<string, string>): Promise<Marks> {
  let last = "", same = 0;
  for (;;) {
    await new Promise(done => setTimeout(done, 150));
    const islands = controls.islands().filter(island => island.width > 0);
    const canvas = shrinkView(get(), 0, short.quantise), seen = (canvas as OffscreenCanvas).getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const now = JSON.stringify(islands) + seen.join(",");
    same = islands.length && now === last ? same + 1 : 0;
    last = now;
    if (same >= 4) return { islands: islands.map(island => ({ ...island, title: titles.get(island.story) ?? "" })) };
  }
}

/** `lateBy` holds each frame's capture back that many milliseconds, as a slow machine does. */
export function SeeingWhatAgentsBuilt({ lateBy = 0 }: { lateBy?: number }) {
  return <MapShortFrame short={FIRST} lateBy={lateBy} />;
}

/** A short with the forest's view on its screen: the view mounted off screen, aimed and given its props at each frame's moment,
 * and the frame drawn by the short's scene onto the one 480×270 canvas the page shows ×4. */
export function MapShortFrame({ short, lateBy = 0 }: { short: MapShort; lateBy?: number }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [get, setGet] = useState<() => RootState>();
  const [controls, setControls] = useState<GlobeControls>();
  const [marks, setMarks] = useState<Record<string, Marks>>();
  const aimed = useRef<string>(Object.keys(short.map.aims).at(-1)!);
  const [assets, setAssets] = useState<{ cast: CastMap; sheet: HTMLImageElement }>();
  const [loading] = useState(() => delayRender("The map, the pixel font and the cast load"));
  const core = useMemo(() => createKnowledgeCore(snapshot.project), []);
  useState(() => { (globalThis as Record<string, unknown>)[CAPTURE_SEAM] = (state: () => RootState) => setGet(() => state); });
  useEffect(() => { void loadAssets().then(setAssets); }, []);
  useEffect(() => { if (controls && get) void settled(short, controls, get).then(setMarks); }, [short, controls, get]);
  useEffect(() => { if (get && assets && marks) continueRender(loading); }, [get, assets, marks, loading]);
  const seconds = frame / fps, props = short.props(seconds), at = short.aimAt(seconds);
  // A growth is held back until the view has settled whole and its islands are found, so a frame that grows the map finds every
  // island where the whole map has it.
  const growth = marks ? props.growth : undefined;
  // The view's props, as one value that changes only when they do: a selection, a claim taken or let go, or the growth's moment.
  const shown = JSON.stringify([props.selected, props.wisps, growth?.at]);
  const ignore = useCallback(() => {}, []);
  useLayoutEffect(() => {
    if (!get || !assets || !marks) return;
    // The view takes a selection on its own renderer's next pass, so the frame is drawn once that has run.
    const drawing = delayRender(`frame ${frame}`);
    if (aimed.current !== at) { aim(short, controls!, at); aimed.current = at; }
    void new Promise(done => setTimeout(done, lateBy)).then(nextFrame).then(() => {
      const map = shrinkView(get(), frame * 1000 / fps, short.quantise), flags = flagsOf(get());
      const ctx = canvas.current!.getContext("2d")!;
      pixelText(ctx, short.draw(ctx, { seconds, frames: durationInFrames, cast: assets.cast, sheet: assets.sheet, view: map,
        map: { width: short.map.width, height: short.map.height, ...(marks[at] ? { marks: marks[at] } : {}), flags } }));
      continueRender(drawing);
    });
  }, [short, get, controls, assets, marks, frame, fps, seconds, durationInFrames, shown, at, lateBy]);
  return <AbsoluteFill style={{ background: "#000" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: short.map.width, height: short.map.height, isolation: "isolate", zIndex: 0 }}>
      <PlanetView {...props} growth={growth} core={core} onPick={ignore} onNote={ignore} onControls={setControls} />
    </div>
    <canvas ref={canvas} width={LOW.width} height={LOW.height}
      style={{ position: "absolute", left: 0, top: 0, zIndex: 1, width: LOW.width * SCALE, height: LOW.height * SCALE, imageRendering: "pixelated" }} />
  </AbsoluteFill>;
}
