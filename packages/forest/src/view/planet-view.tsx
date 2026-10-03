/** The forest's globe book: lane B's plates at lane A's places, with lane C's failure turns. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Quaternion, Vector3 } from "three";
import { claimTints, coastArcs, openingTurn, selectionLanes, type ClaimTint, type CoastArc, type EdgeMarker, type FacingIsland, type ForestScene, type GlobeTurn, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, PlanetWorldCanvas, plateTransform } from "@storytree/forest-world/planet";
import { codePathKey, type CodePlaces } from "@storytree/knowledge-core";
import { KnowledgeGlobePoints, useCodeLighting, type CodeLighting, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { SessionIslandEmphasis } from "./session-emphasis.js";
import { coastTintMarks } from "./session-tints.js";
import { circleStops, fileCircleMarks, lightFileCircles } from "./file-circles.js";
import { lightTerritories, territoryLand } from "./territory-land.js";
import { fileCircles, territories } from "../territories/territories.js";
import { NameplateCrowd, Nameplates, Overlay, SelectionRing } from "./island-overlays.js";
import { dragTurn, focusRotation, globeHover, hiddenMarkers, isGlobeDrag, oncePerFrame, pickGlobe, planetLayout, type ForestMode } from "./planet-navigation.js";
import { claimsOn } from "./planet-update.js";
import { createGlobeGuide, type GlobeControls, type GlobePose } from "./globe-guide.js";
import { presentTerritories, type GlobeSurfaces } from "./globe-surfaces.js";

export type PlanetViewProps = {
  /** Receives the app-owned controls while the globe is mounted. */
  onControls?: ((controls: GlobeControls | undefined) => void) | undefined;
  /** Every surface is shown by default, with territories coloured by health. */
  surfaces?: Partial<GlobeSurfaces> | undefined;
  /** Move the globe right by this many CSS pixels, leaving its turn unchanged. */
  sideOffset?: number | undefined;
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
};

export function PlanetView({ core, scene, places, wisps, selected, highlighted, highlightedSession, onPick, onNote, onWispHover, mode = "forest", framing, sideOffset, surfaces, onControls, library = true }: PlanetViewProps) {
  const shownSurfaces = useMemo((): GlobeSurfaces => ({
    sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true,
    ...surfaces,
    // Keep exterior marks mounted inside the Library so guides can still locate hidden targets.
    ...(mode === "library" ? { sea: false, grounds: false, roads: false, nameplates: false, territories: false, fileCircles: false, sessionTints: false } as const : {}),
  }), [surfaces, mode]);
  const [cameraFraming, setFraming] = useState(framing);
  const [cameraOffset, setOffset] = useState(sideOffset);
  const previousFraming = useRef(framing);
  const previousOffset = useRef(sideOffset);
  useEffect(() => {
    if (previousFraming.current === framing) return;
    previousFraming.current = framing;
    setFraming(framing);
  }, [framing]);
  useEffect(() => {
    if (previousOffset.current === sideOffset) return;
    previousOffset.current = sideOffset;
    setOffset(sideOffset);
  }, [sideOffset]);
  const setPose = useCallback((pose: GlobePose) => { setFraming(pose.framing); setOffset(pose.sideOffset); }, []);
  // A live update that moved no island keeps the spots on show, so only a changed island's plate draws again (ADR-0836 D1).
  const shown = useRef<ReturnType<typeof planetLayout>>(undefined);
  const layout = useMemo(() => planetLayout(scene, places, shown.current), [scene, places]);
  shown.current = layout;
  const [rotation, setRotation] = useState(() => new Quaternion());
  // ADR-0804 D9, narrowed by ADR-0825 D3: a running session tints its islands' coasts and outlines its claimed territories; no wisps.
  const claimed = useMemo(() => claimTints(wisps), [wisps]);
  // Each island reports where its file circles lie on the globe once it has drawn them (only the drawing knows its coast); the core's traversal hops between them (ADR-0804 D5).
  const [stopsByStory, setStops] = useState<ReadonlyMap<string, ReadonlyMap<string, { x: number; y: number; z: number }>>>(new Map());
  const reportStops = useCallback((story: string, stops: ReadonlyMap<string, { x: number; y: number; z: number }> | undefined) => setStops(before => {
    const next = new Map(before);
    if (stops === undefined) next.delete(story);
    else next.set(story, stops);
    return next;
  }), []);
  const code = useKept(useMemo(() => ({
    imports: scene.islands.flatMap(({ land }) => land?.package === undefined ? [] : (land.imports ?? []).map(({ from, to }) => ({ from: codePathKey(land.package!, from), to: codePathKey(land.package!, to) }))),
    capabilities: scene.islands.flatMap(({ land }) => land === undefined ? [] : land.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability])),
  }), [scene]), JSON.stringify);
  const codePlaces = useMemo((): CodePlaces => ({
    files: new Map([...stopsByStory.values()].flatMap(stops => [...stops])),
    imports: code.imports,
    capabilities: new Set(code.capabilities),
  }), [stopsByStory, code]);
  const lighting = useCodeLighting(core, codePlaces);
  // Contract 3.26: the selected story's links to other stories light as lanes; the Library shows none.
  const lanes = useKept(useMemo(() => mode === "forest" ? selectionLanes(scene, selected) : [], [scene, selected, mode]), JSON.stringify);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => {
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    const emphasis = shownSurfaces.sessionTints && highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed") : undefined;
    return <>
      {island.land !== undefined && layout.spots.has(island.story) && <Territories story={island.story} land={island.land} coast={coast} claimed={claimed} radius={layout.radius}
        spot={layout.spots.get(island.story)!} lighting={lighting} surfaces={shownSurfaces} onStops={reportStops} />}
      {mode === "forest" && <SessionIslandEmphasis emphasis={emphasis} />}
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      {shownSurfaces.nameplates && <Nameplates island={island} coast={coast} radius={layout.radius} selected={selected} dimmed={emphasis === "dimmed"} />}
      {shownSurfaces.sessionTints && <CoastTints arcs={coastArcs(wisps, island.story)} coast={coast} radius={layout.radius} />}
      {mode === "forest" && <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />}
    </>;
  }, [wisps, claimed, selected, highlighted, layout.spots, layout.radius, lighting, reportStops, shownSurfaces, mode]);
  return <PlanetWorldCanvas scene={layout.scene} spots={layout.spots} radius={layout.radius}
    surface surfaces={shownSurfaces} framing={cameraFraming} sideOffset={cameraOffset} orbit={false}
    inside={<group name="globe-core" visible={library && shownSurfaces.knowledgeCore}><KnowledgeGlobePoints core={core} spots={layout.spots} radius={layout.radius} places={codePlaces} /></group>}
    rotation={rotation.toArray()} plateChildren={overlays} lanes={lanes}>
    <Navigation islands={layout.islands} radius={layout.radius} titles={new Map(scene.islands.map(i => [i.story, i.title]))}
      rotation={rotation} onRotate={setRotation} onPose={setPose} onControls={onControls} onPick={onPick} onNote={onNote} mode={mode}
      showFailures={shownSurfaces.grounds || shownSurfaces.territories !== false || shownSurfaces.fileCircles || shownSurfaces.nameplates || shownSurfaces.roads} />
    <NameplateCrowd selected={selected} />
  </PlanetWorldCanvas>;
}

/** `value`, or the one kept before while `keyOf` reads both the same: a reading equal to the last keeps its identity. */
function useKept<T>(value: T, keyOf: (value: T) => string): T {
  const kept = useRef<{ key: string; value: T }>(undefined);
  const key = keyOf(value);
  if (kept.current?.key !== key) kept.current = { key, value };
  return kept.current.value;
}

/** Lifted just off the surface, so a territory's tint never fights the ground it lies on. */
const TERRITORY_LIFT = 0.05;

/**
 * An island's territories (3.14) and its files' circles (3.16), cut to its coast and laid on its surface,
 * all in the plate's own units. It says where the circles lie on the globe (3.18), and lights the territories
 * and circles the selected session's window opened.
 */
function Territories({ story, land, coast, claimed, radius, spot, lighting, surfaces, onStops }: {
  story: string;
  land: NonNullable<Island["land"]>;
  coast: readonly (readonly { x: number; z: number }[])[];
  claimed: ReadonlyMap<string, ClaimTint>;
  radius: number;
  spot: { x: number; y: number; z: number };
  lighting: CodeLighting;
  surfaces: GlobeSurfaces;
  onStops: (story: string, stops: ReadonlyMap<string, { x: number; y: number; z: number }> | undefined) => void;
}) {
  const invalidate = useThree(state => state.invalidate);
  // A claim on another island leaves this one's territories as they were.
  const tints = useKept(claimed, tints => claimsOn(tints, land));
  const drawn = useMemo(() => {
    const map = territories(land.territories, coast);
    const group = territoryLand(map, onIslandSurface(radius, TERRITORY_LIFT), coast, tints);
    const circles = fileCircleMarks(fileCircles(map, land.files), onIslandSurface(radius), islandNormal(radius));
    const root = new Group();
    root.add(group, circles);
    return { root, group, circles };
  }, [land, coast, tints, radius]);
  useEffect(() => {
    if (land.package === undefined) return;
    const { position, quaternion } = plateTransform(spot, radius);
    onStops(story, circleStops(drawn.circles, land.package, { position: new Vector3(...position), quaternion }));
    return () => onStops(story, undefined);
  }, [drawn, land.package, story, spot.x, spot.y, spot.z, radius, onStops]);
  useEffect(() => {
    lightFileCircles(drawn.circles, surfaces.sessionTints ? lighting.files : new Map(), lighting.colour, land.package ?? "", lighting.colours);
    lightTerritories(drawn.group, surfaces.sessionTints ? lighting.capabilities : new Map(), lighting.colour);
    presentTerritories(drawn.group, surfaces.territories);
    drawn.circles.visible = surfaces.fileCircles;
    for (const object of drawn.group.children) if (object.userData.claim) object.visible = surfaces.sessionTints;
    invalidate();
  }, [drawn, lighting, land.package, surfaces, invalidate]);
  useEffect(() => () => drawn.root.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  }), [drawn]);
  return <primitive object={drawn.root} />;
}

/** Each running session's arc of an island's coast (5.6, 5.7), laid just above the ground. */
function CoastTints({ arcs, coast, radius }: { arcs: readonly CoastArc[]; coast: readonly (readonly { x: number; z: number }[])[]; radius: number }) {
  const group = useMemo(() => coastTintMarks(coast, arcs, onIslandSurface(radius, TERRITORY_LIFT * 2)), [JSON.stringify(arcs), coast, radius]);
  useEffect(() => () => group.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  }), [group]);
  return <primitive object={group} />;
}

type ScreenMarker = EdgeMarker & { left: number; top: number };

function Navigation({ islands, radius, titles, rotation, onRotate, onPose, onControls, onPick, onNote, mode, showFailures }: {
  onPose: (pose: GlobePose) => void;
  onControls: ((controls: GlobeControls | undefined) => void) | undefined;
  showFailures: boolean;
  mode: ForestMode;
  /** The globe's radius as laid out, which grows with its islands. */
  radius: number;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  rotation: Quaternion;
  onRotate: (rotation: Quaternion) => void;
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
}) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const [hover, setHover] = useState<{ title: string; x: number; y: number }>();
  const opened = useRef(false);
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  // The globe turns only by spin and tilt, and the eye never moves, so north stays up (arc north-up).
  const turn = useRef<GlobeTurn>({ yaw: 0, pitch: 0 });
  const turnTo = useCallback((next: GlobeTurn) => {
    turn.current = next;
    onRotate(focusRotation(next, camera.quaternion));
  }, [camera, onRotate]);
  // The handle remains stable while its host reads the latest scene, camera and callbacks.
  const host = useRef({ camera, scene, size, radius, onPose, turnTo, invalidate });
  host.current = { camera, scene, size, radius, onPose, turnTo, invalidate };
  const guide = useRef<ReturnType<typeof createGlobeGuide>>(undefined);
  if (guide.current === undefined) guide.current = createGlobeGuide({
    world: () => host.current.scene,
    camera: () => host.current.camera,
    size: () => host.current.size,
    read: () => {
      const { camera: eye, size: viewport, radius: extent } = host.current;
      return { turn: { ...turn.current }, framing: Math.min(viewport.width, viewport.height) / (2 * eye.zoom * extent),
        sideOffset: eye.view?.enabled ? -eye.view.offsetX : 0 };
    },
    write: pose => { opened.current = true; host.current.turnTo(pose.turn); host.current.onPose(pose); },
    invalidate: () => host.current.invalidate(),
  });
  const controls = useRef<GlobeControls>(undefined);
  const guideFrameAt = useRef(0);
  if (controls.current === undefined) controls.current = {
    stop: stop => { const started = guide.current!.stop(stop); if (started) { opened.current = true; guideFrameAt.current = performance.now(); } return started; },
    position: target => guide.current!.position(target),
    cancel: () => guide.current!.cancel(),
  };
  useEffect(() => {
    if (opened.current || islands.length === 0) return;
    opened.current = true;
    turnTo(openingTurn(islands));
  }, [islands, turnTo]);
  useEffect(() => {
    onControls?.(controls.current);
    return () => { onControls?.(undefined); };
  }, [onControls]);
  useEffect(() => () => guide.current!.cancel(), []);

  // OrbitControls runs before this frame. Project the rim with the current eye AND zoom.
  useFrame(() => {
    const now = performance.now();
    guide.current!.frame(now - guideFrameAt.current);
    guideFrameAt.current = now;
    const centre = new Vector3().project(camera);
    const rim = radius * camera.zoom + 16;
    const next = (showFailures ? hiddenMarkers(islands, rotation, camera.quaternion, mode) : []).map(marker => ({
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
    let down: { x: number; y: number; id: number; dragged: boolean; last: { x: number; y: number } } | undefined;
    const pick = (event: PointerEvent) => pickGlobe(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, mode);
    // Picking is costly: a pointer that moves many times a frame is picked once, where it last was.
    let cleared = 0, stopped = false;
    const clearHover = (): void => { cleared++; setHover(undefined); element.style.cursor = ""; };
    const hoverAt = oncePerFrame(({ event, at }: { event: PointerEvent; at: number }): void => {
      if (stopped || at !== cleared || down !== undefined) return;
      const box = element.getBoundingClientRect();
      const { cursor, title } = globeHover(scene, camera, box, { x: event.clientX, y: event.clientY }, mode);
      element.style.cursor = cursor;
      setHover(title === undefined ? undefined : { title, x: Math.max(8, Math.min(box.width - 220, event.clientX - box.left + 12)), y: event.clientY - box.top + 14 });
    });
    // A drag redraws the globe once a frame, at the latest turn.
    const dragTo = oncePerFrame((next: GlobeTurn): void => { if (!stopped) turnTo(next); });
    const onDown = (event: PointerEvent): void => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false, last: { x: event.clientX, y: event.clientY } } : undefined;
      if (down !== undefined) element.setPointerCapture?.(event.pointerId);
      clearHover();
    };
    const onCancel = (): void => { down = undefined; clearHover(); };
    const onMove = (event: PointerEvent): void => {
      if (down !== undefined) {
        if (event.pointerId !== down.id) return;
        down.dragged ||= isGlobeDrag(down, { x: event.clientX, y: event.clientY });
        guide.current!.cancel();
        turn.current = dragTurn(turn.current, { x: event.clientX - down.last.x, y: event.clientY - down.last.y }, element.clientHeight || 1);
        dragTo(turn.current);
        down.last = { x: event.clientX, y: event.clientY };
        clearHover();
        return;
      }
      hoverAt({ event, at: cleared });
    };
    const onUp = (event: PointerEvent): void => {
      const from = down;
      down = undefined;
      if (from === undefined || from.id !== event.pointerId || from.dragged || isGlobeDrag(from, { x: event.clientX, y: event.clientY })) return;
      clearHover();
      const hit = pick(event);
      if (hit?.kind === "note") onNote(hit.id);
      else onPick(hit?.id, hit?.capability);
    };
    const onWheel = (): void => { guide.current!.cancel(); clearHover(); };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onCancel);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("wheel", onWheel, { passive: true });
    clearHover();
    return () => {
      stopped = true;
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onCancel);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("wheel", onWheel);
      element.style.cursor = "";
    };
  }, [camera, gl, scene, onPick, onNote, mode, turnTo]);

  return <Overlay fullscreen zIndexRange={[40, 40]} style={{ pointerEvents: "none" }}>
    {hover !== undefined && <span role="tooltip" className="knowledge-tooltip" style={{ position: "absolute", left: hover.x, top: hover.y }}>{hover.title}</span>}
    {mode === "forest" && markers.map(marker => <button key={marker.story} type="button" className="planet-edge-marker"
      data-failing-story={marker.story}
      style={{ left: marker.left, top: marker.top }}
      title={`${titles.get(marker.story)} · unhealthy (storytree verified)`}
      aria-label={`Show unhealthy story: ${titles.get(marker.story)}`}
      onClick={() => { guide.current!.cancel(); turnTo(marker.turn); }}>!</button>)}
  </Overlay>;
}
