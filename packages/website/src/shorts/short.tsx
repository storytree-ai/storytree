/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built" (increment_9294d76b04cf, ADR-1046): the
 * same developer on both halves, thinking in bubbles, and on the storytree side the real view in the corner inset. The
 * globe draws off screen at the inset's resolution; each frame turns it to that moment's angle, lights the island the
 * developer looks at, renders it once by hand and hands it to the scene, which draws the one 320×180 canvas the page
 * shows ×6 with no smoothing. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useThree, type RootState } from "@react-three/fiber";
import { PlanetWorldCanvas } from "@storytree/forest-world/planet";
import { planetPathwayDrawing } from "@storytree/forest-world/geometry";
import type { CastMap } from "./cast.js";
import { drawScene, type Words } from "./scene.js";
import { beats, FONT, INSET, LOW, SCALE } from "./script.js";
import { ISLAND, litAt, snapshot, turnAt } from "./view.js";

const spots = new Map(snapshot.spots);
const WITH = beats(ISLAND.title).with;
const LIT = "#ffd34d";
const quaternion = (angle: number): [number, number, number, number] => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

type Coloured = { isMesh?: boolean; material?: { clone(): Coloured["material"]; color: { clone(): unknown; copy(c: unknown): { lerp(c: unknown, t: number): unknown } }; opacity: number }; userData: Record<string, unknown> };
type Lit = { material: NonNullable<Coloured["material"]>; base: unknown; lit: unknown; opacity: number };

/** Tints each island toward the light by its own glow (0 for every island but the lit one), on copies of its materials. */
function lightIslands(scene: RootState["scene"], lit: { story: string; glow: number } | undefined): void {
  for (const [story] of spots) scene.getObjectByName(`planet:${story}`)?.traverse(node => {
    const mesh = node as unknown as Coloured;
    if (!mesh.isMesh || mesh.material === undefined || !("color" in mesh.material)) return;
    const own = (mesh.userData.lit ??= (() => {
      const material = mesh.material!.clone()!;
      const glow = (material.color.clone() as { set(c: string): unknown }).set(LIT);
      return { material, base: material.color.clone(), lit: glow, opacity: material.opacity };
    })()) as Lit;
    const glow = lit?.story === story ? lit.glow : 0;
    mesh.material = own.material;
    own.material.color.copy(own.base).lerp(own.lit, glow);
    own.material.opacity = own.opacity + (1 - own.opacity) * glow;
  });
}

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

/** Hands the globe's live state out of its canvas. */
function Grab({ onState }: { onState(get: () => RootState): void }) {
  const get = useThree(state => state.get);
  useEffect(() => onState(get), [get, onState]);
  return null;
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

export function SeeingWhatAgentsBuilt() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const shown = useRef<HTMLCanvasElement>(null);
  const [get, setGet] = useState<() => RootState>();
  const grabbed = useCallback((state: () => RootState) => setGet(() => state), []);
  const [assets, setAssets] = useState<{ cast: CastMap; sheet: HTMLImageElement }>();
  const [loading] = useState(() => delayRender("The globe, the pixel font and the cast load"));
  // The roads are routed before the globe mounts, so it draws them at once rather than a few frames in.
  useState(() => planetPathwayDrawing(snapshot.scene, spots, snapshot.radius));
  useEffect(() => { void loadAssets().then(setAssets); }, []);
  useEffect(() => { if (get && assets) continueRender(loading); }, [get, assets, loading]);
  const seconds = frame / fps;
  const rotation = useMemo(() => quaternion(turnAt(WITH, seconds)), [seconds]);
  useLayoutEffect(() => {
    if (!get || !assets) return;
    const state = get();
    state.scene.getObjectByName("globe")?.quaternion.set(...rotation);
    lightIslands(state.scene, litAt(WITH, seconds));
    state.advance(frame * 1000 / fps);
    const ctx = shown.current!.getContext("2d")!;
    pixelText(ctx, drawScene(ctx, { seconds, frames: durationInFrames, cast: assets.cast, sheet: assets.sheet, view: state.gl.domElement }));
  }, [get, assets, frame, fps, seconds, durationInFrames, rotation]);
  return <AbsoluteFill style={{ background: "#000" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: INSET.width, height: INSET.height }}>
      <PlanetWorldCanvas scene={snapshot.scene} spots={spots} radius={snapshot.radius} rotation={rotation} orbit={false}>
        <Grab onState={grabbed} />
      </PlanetWorldCanvas>
    </div>
    <canvas ref={shown} width={LOW.width} height={LOW.height}
      style={{ position: "absolute", left: 0, top: 0, width: LOW.width * SCALE, height: LOW.height * SCALE, imageRendering: "pixelated" }} />
  </AbsoluteFill>;
}
