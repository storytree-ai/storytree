/** The forest's globe book: lane B's plates at lane A's places, with lane C's failure turns. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import { claimTints, coastArcs, openingTurn, PLANET_RADIUS, type ClaimTint, type CoastArc, type EdgeMarker, type FacingIsland, type ForestScene, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, PlanetWorldCanvas } from "@storytree/forest-world/planet";
import { KnowledgeGlobePoints, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { SessionIslandEmphasis } from "./session-emphasis.js";
import { coastTintMarks } from "./session-tints.js";
import { fileCircleMarks } from "./file-circles.js";
import { territoryLand } from "./territory-land.js";
import { fileCircles, territories } from "../territories/territories.js";
import { Names, Overlay, SelectionRing } from "./island-overlays.js";
import { focusRotation, hiddenMarkers, pickGlobe, planetLayout, pointedFile, type ForestMode } from "./planet-navigation.js";

export function PlanetView({ core, scene, places, wisps, selected, highlighted, highlightedSession, onPick, onNote, onWispHover, mode = "forest", framing, library = true }: {
  mode?: ForestMode;
  /** False when the Library is switched off (ADR-0750): no notes inside, so the globe reads solid. */
  library?: boolean;
  /** How many radii half the short side spans as it opens (`globeFraming`). */
  framing?: number | undefined;
  core: KnowledgeCore;
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  highlighted?: readonly string[] | undefined;
  /** The session whose row or wisp is hovered: its wisps swell. */
  highlightedSession?: string | undefined;
  /** Hears a click on an island, or undefined for empty space. */
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
  onWispHover: (session: string | undefined) => void;
}) {
  const layout = useMemo(() => planetLayout(scene, places), [scene, places]);
  const [rotation, setRotation] = useState(() => new Quaternion());
  // ADR-0804 D9: a running session tints its islands' coasts and its claimed territories; no wisps.
  const claimed = useMemo(() => claimTints(wisps), [wisps]);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => {
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    const emphasis = highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed") : undefined;
    return <>
      {island.land !== undefined && <Territories land={island.land} coast={coast} claimed={claimed} />}
      <SessionIslandEmphasis emphasis={emphasis} />
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      <Names islands={[local]} selected={selected} dimmed={emphasis === "dimmed"} onGlobe />
      <CoastTints arcs={coastArcs(wisps, island.story)} coast={coast} />
      <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />
    </>;
  }, [wisps, claimed, selected, highlighted]);
  return <PlanetWorldCanvas scene={layout.scene} spots={layout.spots} radius={PLANET_RADIUS}
    surface={mode === "forest"} framing={framing}
    inside={library ? <KnowledgeGlobePoints core={core} spots={layout.spots} radius={PLANET_RADIUS} /> : undefined}
    rotation={rotation.toArray()} plateChildren={overlays}>
    <Navigation islands={layout.islands} titles={new Map(scene.islands.map(i => [i.story, i.title]))}
      rotation={rotation} onRotate={setRotation} onPick={onPick} onNote={onNote} mode={mode} />
  </PlanetWorldCanvas>;
}

/** Lifted just off the surface, so a territory's tint never fights the ground it lies on. */
const TERRITORY_LIFT = 0.05;

/**
 * An island's territories (3.14) and its files' circles (3.16), cut to its coast and laid on its surface,
 * all in the plate's own units.
 */
function Territories({ land, coast, claimed }: { land: NonNullable<Island["land"]>; coast: readonly (readonly { x: number; z: number }[])[]; claimed: ReadonlyMap<string, ClaimTint> }) {
  const group = useMemo(() => {
    const map = territories(land.territories, coast);
    const group = territoryLand(map, onIslandSurface(PLANET_RADIUS, TERRITORY_LIFT), coast, claimed);
    group.add(fileCircleMarks(fileCircles(map, land.files), onIslandSurface(PLANET_RADIUS), islandNormal(PLANET_RADIUS)));
    return group;
  }, [land, coast, claimed]);
  useEffect(() => () => group.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  }), [group]);
  return <primitive object={group} />;
}

/** Each running session's arc of an island's coast (5.6, 5.7), laid just above the ground. */
function CoastTints({ arcs, coast }: { arcs: readonly CoastArc[]; coast: readonly (readonly { x: number; z: number }[])[] }) {
  const group = useMemo(() => coastTintMarks(coast, arcs, onIslandSurface(PLANET_RADIUS, TERRITORY_LIFT * 2)), [JSON.stringify(arcs), coast]);
  useEffect(() => () => group.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  }), [group]);
  return <primitive object={group} />;
}

type ScreenMarker = EdgeMarker & { left: number; top: number };

function Navigation({ islands, titles, rotation, onRotate, onPick, onNote, mode }: {
  mode: ForestMode;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  rotation: Quaternion;
  onRotate: (rotation: Quaternion) => void;
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
}) {
  const { camera, gl, scene, size } = useThree();
  const [hover, setHover] = useState<{ title: string; x: number; y: number }>();
  const opened = useRef(false);
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  useEffect(() => {
    if (opened.current || islands.length === 0) return;
    opened.current = true;
    onRotate(focusRotation(openingTurn(islands), camera.quaternion));
  }, [islands, camera, onRotate]);

  // OrbitControls runs before this frame. Project the rim with the current eye AND zoom.
  useFrame(() => {
    const centre = new Vector3().project(camera);
    const rim = PLANET_RADIUS * camera.zoom + 16;
    const next = hiddenMarkers(islands, rotation, camera.quaternion, mode).map(marker => ({
      ...marker,
      left: Math.round(Math.max(20, Math.min(size.width - 20, (centre.x + 1) * size.width / 2 + marker.at.x * rim))),
      top: Math.round(Math.max(20, Math.min(size.height - 20, (1 - centre.y) * size.height / 2 - marker.at.y * rim))),
    }));
    const key = JSON.stringify(next);
    if (key !== lastMarkers.current) {
      lastMarkers.current = key;
      setMarkers(next);
    }
  });

  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number; id: number; dragged: boolean } | undefined;
    const pick = (event: PointerEvent) => pickGlobe(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, mode);
    const clearHover = (): void => { setHover(undefined); element.style.cursor = ""; };
    const onDown = (event: PointerEvent): void => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false } : undefined;
      clearHover();
    };
    const onCancel = (): void => { down = undefined; clearHover(); };
    const onMove = (event: PointerEvent): void => {
      if (down !== undefined) {
        down.dragged ||= Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 5;
        clearHover();
        return;
      }
      const hit = pick(event);
      element.style.cursor = hit === undefined ? "" : "pointer";
      const file = hit?.kind === "note" ? undefined : pointedFile(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY });
      const title = hit?.kind === "note" ? scene.getObjectByName(`knowledge-point:${hit.id}`)?.userData.title as string | undefined
        : file === undefined ? undefined : `${file.file} · ${file.lines} lines · ${file.capability === undefined ? "Unclaimed" : scene.getObjectByName(`territory:${file.capability}`)?.userData.title ?? file.capability}`;
      const box = element.getBoundingClientRect();
      setHover(title === undefined ? undefined : { title, x: Math.max(8, Math.min(box.width - 220, event.clientX - box.left + 12)), y: event.clientY - box.top + 14 });
    };
    const onUp = (event: PointerEvent): void => {
      const from = down;
      down = undefined;
      if (from === undefined || from.id !== event.pointerId || from.dragged || Math.hypot(event.clientX - from.x, event.clientY - from.y) >= 5) return;
      clearHover();
      const hit = pick(event);
      if (hit?.kind === "note") onNote(hit.id);
      else onPick(hit?.id, hit?.capability);
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onCancel);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("wheel", clearHover, { passive: true });
    clearHover();
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onCancel);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("wheel", clearHover);
      element.style.cursor = "";
    };
  }, [camera, gl, scene, onPick, onNote, mode]);

  return <Overlay fullscreen zIndexRange={[40, 40]} style={{ pointerEvents: "none" }}>
    {hover !== undefined && <span role="tooltip" className="knowledge-tooltip" style={{ position: "absolute", left: hover.x, top: hover.y }}>{hover.title}</span>}
    {mode === "forest" && markers.map(marker => <button key={marker.story} type="button" className="planet-edge-marker"
      data-failing-story={marker.story}
      style={{ left: marker.left, top: marker.top }}
      title={`${titles.get(marker.story)} · failing (agent's report)`}
      aria-label={`Show failing story: ${titles.get(marker.story)}`}
      onClick={() => onRotate(focusRotation(marker.turn, camera.quaternion))}>!</button>)}
  </Overlay>;
}
