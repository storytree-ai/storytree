/** Capability 6 · Pixel-art shorts. The pipeline spike (increment_a71ac162509a): five seconds of the split screen, the real
 * globe on the right. The globe draws off screen at the low resolution; each frame turns it to that frame's angle, renders
 * it once by hand and copies it into the one 320×180 canvas, which the page shows ×6 with no smoothing. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useThree, type RootState } from "@react-three/fiber";
import { PlanetWorldCanvas, SHIPPED_ELEVATION_DEG } from "@storytree/forest-world/planet";
import { planetPathwayDrawing } from "@storytree/forest-world/geometry";
import type { TourSnapshot } from "../forest-data.js";
import saved from "../forest-snapshot.json" with { type: "json" };
import { drawSplitScreen, FONT, GLOBE_BOX, LOW, SCALE } from "./split-screen.js";

const snapshot = saved as unknown as TourSnapshot;
const spots = new Map(snapshot.spots);
/** The globe turns slowly about its axis, in radians from its saved resting angle. */
const START = -0.6, SPEED = 0.16;
/** The island lights up from this second, and is fully lit half a second later. */
const LIGHT_FROM = 2, LIGHT_RISE = 0.5;
const LIT = "#ffd34d";
const turnAt = (seconds: number): [number, number, number, number] => {
  const angle = START + SPEED * seconds;
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
};
const glowAt = (seconds: number) => Math.max(0, Math.min(1, (seconds - LIGHT_FROM) / LIGHT_RISE));

/** The island facing the eye most squarely when it lights up, so it is seen. */
export function facingStory(seconds: number): string {
  const angle = START + SPEED * seconds, elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const facing = ([, spot]: [string, { x: number; y: number; z: number }]) =>
    Math.sin(elevation) * spot.y + Math.cos(elevation) * (-spot.x * Math.sin(angle) + spot.z * Math.cos(angle));
  return snapshot.spots.reduce((best, next) => facing(next) > facing(best) ? next : best)[0];
}
const litStory = facingStory(LIGHT_FROM + LIGHT_RISE);

type Coloured = { isMesh?: boolean; material?: { clone(): Coloured["material"]; color: { clone(): unknown; copy(c: unknown): { lerp(c: unknown, t: number): unknown } }; opacity: number }; userData: Record<string, unknown> };
type Lit = { material: NonNullable<Coloured["material"]>; base: unknown; lit: unknown; opacity: number };

/** Tints one island's own surfaces toward the light, on copies of their materials so no other island changes. */
function lightIsland(scene: RootState["scene"], story: string, glow: number): void {
  scene.getObjectByName(`planet:${story}`)?.traverse(node => {
    const mesh = node as unknown as Coloured;
    if (!mesh.isMesh || mesh.material === undefined || !("color" in mesh.material)) return;
    const own = (mesh.userData.lit ??= (() => {
      const material = mesh.material!.clone()!;
      const lit = (material.color.clone() as { set(c: string): unknown }).set(LIT);
      return { material, base: material.color.clone(), lit, opacity: material.opacity };
    })()) as Lit;
    mesh.material = own.material;
    own.material.color.copy(own.base).lerp(own.lit, glow);
    own.material.opacity = own.opacity + (1 - own.opacity) * glow;
  });
}

/** Hands the globe's live state out of its canvas. */
function Grab({ onState }: { onState(get: () => RootState): void }) {
  const get = useThree(state => state.get);
  useEffect(() => onState(get), [get, onState]);
  return null;
}

export function PipelineSpike() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const shown = useRef<HTMLCanvasElement>(null);
  const [get, setGet] = useState<() => RootState>();
  const grabbed = useCallback((state: () => RootState) => setGet(() => state), []);
  const [font, setFont] = useState(false);
  const [loading] = useState(() => delayRender("The globe and the pixel font load"));
  // The roads are routed before the globe mounts, so it draws them at once rather than a few frames in.
  useState(() => planetPathwayDrawing(snapshot.scene, spots, snapshot.radius));
  useEffect(() => {
    void new FontFace(FONT, `url(${staticFile("fonts/PressStart2P-Regular.ttf")})`).load().then(face => { document.fonts.add(face); setFont(true); });
  }, []);
  useEffect(() => { if (get && font) continueRender(loading); }, [get, font, loading]);
  const rotation = useMemo(() => turnAt(frame / fps), [frame, fps]);
  useLayoutEffect(() => {
    if (!get || !font) return;
    const state = get();
    state.scene.getObjectByName("globe")?.quaternion.set(...rotation);
    lightIsland(state.scene, litStory, glowAt(frame / fps));
    state.advance(frame * 1000 / fps);
    drawSplitScreen(shown.current!.getContext("2d")!, frame, durationInFrames, state.gl.domElement);
  }, [get, font, frame, fps, durationInFrames, rotation]);
  return <AbsoluteFill style={{ background: "#000" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: GLOBE_BOX.width, height: GLOBE_BOX.height }}>
      <PlanetWorldCanvas scene={snapshot.scene} spots={spots} radius={snapshot.radius} rotation={rotation} orbit={false}>
        <Grab onState={grabbed} />
      </PlanetWorldCanvas>
    </div>
    <canvas ref={shown} width={LOW.width} height={LOW.height}
      style={{ position: "absolute", left: 0, top: 0, width: LOW.width * SCALE, height: LOW.height * SCALE, imageRendering: "pixelated" }} />
  </AbsoluteFill>;
}
