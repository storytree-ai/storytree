/** Capability 3 · Story node render. The forest's globe book: lane B's plates at lane A's places, with lane C's failure turns. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Quaternion, Vector3, type Camera, type Object3D } from "three";
import { claimTints, openingTurn, replayWisps, selectionLanes, type ClaimTint, type EdgeMarker, type FacingIsland, type ForestScene, type GlobeTurn, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, PlanetWorldCanvas, plateTransform, PLATE_CLEARANCE, SHEET_LAND_LIFT, SHEET_RADIUS, sheetEyeZoom, UnderTheGlass, usePlanetGrowth, type PlanetGrowth, type SheetExtent } from "@storytree/forest-world/planet";
import { codePathKey, type CodePlaces } from "@storytree/knowledge-core";
import { KnowledgeGlobePoints, useCodeLighting, type CodeLighting, type CoreUnderSheet, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { SessionIslandEmphasis } from "./session-emphasis.js";
import { circleStops, fileCircleMarks, lightFileCircles } from "./file-circles.js";
import { lightTerritories, territoryLand } from "./territory-land.js";
import { laneWays } from "./border-route.js";
import { ClaimMarks } from "./claim-flag.js";
import { fileCircles, islandTerritories } from "../territories/territories.js";
import { NameplateCrowd, Nameplates, Overlay, reducedMotion, SelectionRing } from "./island-overlays.js";
import { dragTurn, focusRotation, globeHover, hiddenMarkers, isGlobeDrag, markerSpot, movingSpots, MOVE_SECONDS, oncePerFrame, pickGlobe, planetLayout, type ForestMode } from "./planet-navigation.js";
import { claimsOn } from "./planet-update.js";
import { createGlobeGuide, type GlobePose, type PlacedGlobeControls } from "./globe-guide.js";
import { createGlobeAside } from "./globe-aside.js";
import { asksForHome, miniGlobe } from "./mini-globe.js";
import { compassNorth, opensBare, restingTilt, seesUnderside, sheetDrag, sheetHome, sheetKey, sheetKeyPan, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetPanUnder, sheetSpin, sheetSpinTilt, sheetTilted, sheetTiltBy, sheetTwist, sheetUnder, TILT_PER_PIXEL, TILT_STEP } from "./sheet-navigation.js";
import { growLand, pastIslands, shownSurfaces as surfacesFor, TerritoryDrawOn, type GlobeSurfaces } from "./globe-surfaces.js";

export type PlanetViewProps = {
  /** Receives the app-owned controls while the globe is mounted. */
  onControls?: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  /** Every surface is shown by default, with territories coloured by health. */
  surfaces?: Partial<GlobeSurfaces> | undefined;
  /** Move the globe right by this many CSS pixels, leaving its turn unchanged. */
  sideOffset?: number | undefined;
  /** CSS pixels of the canvas's right a panel covers: the globe glides into the width left of it (3.40). */
  aside?: number | undefined;
  mode?: ForestMode;
  /** False when the Library is switched off (ADR-0750): no notes inside, so the globe reads solid. */
  library?: boolean;
  /** How many radii half the short side spans as it opens (`globeFraming`). */
  framing?: number | undefined;
  /** The full plan a plan still growing is drawn within: each island keeps the spot it has there (3.28). */
  frame?: ForestScene | undefined;
  /** A host that changes `places` or `frame` (one layout for the plan as it was, one for the plan as it is) has its islands
   * ease across from one to the other, once (3.28); without it, or with reduced motion, they jump. */
  easeMoves?: boolean | undefined;
  /** A recorded growth to replay (world 7): islands rise, their territories and file circles fill in behind them (3.30), and the core's notes appear. */
  growth?: PlanetGrowth | undefined;
  /** The live desktop grows arriving ordinary roads, separately from recorded replay. */
  liveRoads?: boolean | undefined;
  /** With a growth, the sessions recorded with each dated stage: they pass over the islands they held as the replay reaches them (5.7), in place of `wisps`. */
  recordedSessions?: readonly { at: string; wisps: readonly SessionWisp[] }[] | undefined;
  core: KnowledgeCore;
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  highlighted?: readonly string[] | undefined;
  /** Hears a click on an island, or undefined for empty space. */
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
  /** Draw the forest on the glass sheet, depth running west to east, not on the globe (ADR-1043): the user tilts it from
   * above to below (ADR-1062 D2), and a change of `mode` swings it to that side's resting view (D3). */
  sheet?: boolean | undefined;
  /** On the sheet, told the tilt each time the eye comes to the other side of the glass, as the user tilts it past level,
   * so the host's buttons follow (ADR-1062 D3). */
  onSide?: ((tilt: number) => void) | undefined;
};

export function PlanetView({ core, scene, places, wisps: live, selected, highlighted, onPick, onNote, mode = "forest", framing, sideOffset, aside = 0, surfaces, onControls, library = true, frame, easeMoves = false, growth, liveRoads = false, recordedSessions, sheet = false, onSide }: PlanetViewProps) {
  // Zoomed in past the islands, or in the Library, only the glass and the core show (ADR-0919 D3, D4). The hidden
  // marks stay mounted, so guides can still locate them.
  const [past, setPast] = useState(false);
  // Seen from below the glass sheet, the islands are hollow outlines with their names over the knowledge (ADR-1061 D2,
  // ADR-1062 D4): the side the eye is on decides, not the button pressed.
  const [below, setBelow] = useState(sheet && mode === "library");
  const sideSeen = useCallback((tilt: number) => { setBelow(seesUnderside(tilt)); onSide?.(tilt); }, [onSide]);
  const outlines = sheet && below;
  const shownSurfaces = useMemo(() => surfacesFor(surfaces, !sheet && (mode === "library" || past), outlines), [surfaces, mode, past, sheet, outlines]);
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
  const layout: ReturnType<typeof planetLayout> & Partial<Pick<ReturnType<typeof sheetLayout>, "extent" | "under">> = useMemo(() => sheet ? sheetLayout(scene, places) : planetLayout(scene, places, shown.current, frame), [scene, places, frame, sheet]);
  shown.current = layout;
  // 3.28: while a change of layout plays, only the plates travel, with no roads; the rest is drawn once, at the new layout.
  const moving = useMovingSpots(layout.spots, easeMoves), travelling = moving !== layout.spots;
  const roadless = useMemo(() => ({ ...layout.scene, links: [] }), [layout.scene]);
  const [rotation, setRotation] = useState(() => new Quaternion());
  // The globe's centre stands off the origin on the glass sheet, tilted and turned about the middle of the view (ADR-1043 D3, ADR-1059 D1).
  const [centre, setCentre] = useState<[number, number, number]>();
  const onRotate = useCallback((next: Quaternion, at?: [number, number, number]) => { setRotation(next); setCentre(at); }, []);
  // 5.7: replaying a growth with its recorded sessions, the wisps are the replay's, swapped as it passes each stage.
  const [replayed, setReplayed] = useState<readonly SessionWisp[]>();
  const wisps = growth !== undefined && recordedSessions !== undefined ? replayed ?? [] : live;
  // ADR-0968, ADR-0923: a running session plants a flag on each territory it claimed, and nothing else; no wisps, no coast tint.
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
  // Contract 3.26: the selected story's links to other stories light as lanes; the globe's Library shows none, while the
  // glass sheet keeps a selection lit on both its faces (ADR-1043 D3).
  const onShow = sheet || mode === "forest";
  const lanes = useKept(useMemo(() => onShow ? selectionLanes(scene, selected) : [], [scene, selected, onShow]), JSON.stringify);
  // The knowledge graph under the glass sheet: each shelf's notes under its place, the selected story's lit (ADR-1043 D5).
  const under = layout.under;
  const underSheet = useMemo((): CoreUnderSheet | undefined => under && { ...under, selected }, [under, selected]);
  // ADR-0991 D4: a lit lane runs on from its dock along the territories' borders to its capability.
  const ways = useMemo(() => laneWays(layout.scene.islands), [layout.scene]);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => {
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    const emphasis = shownSurfaces.sessionTints && highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed") : undefined;
    return <>
      {island.land !== undefined && layout.spots.has(island.story) && <Territories story={island.story} land={island.land} coast={coast} claimed={claimed} radius={layout.radius}
        spot={layout.spots.get(island.story)!} lighting={lighting} surfaces={shownSurfaces} onStops={reportStops} raised={sheet} />}
      {onShow && <SessionIslandEmphasis emphasis={emphasis} />}
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      {shownSurfaces.nameplates && <Nameplates island={island} spot={layout.spots.get(island.story)!} coast={coast} radius={layout.radius} selected={selected} dimmed={emphasis === "dimmed"} claimed={claimed} sheet={sheet} />}
      {onShow && <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />}
    </>;
  }, [wisps, claimed, selected, highlighted, layout.spots, layout.radius, lighting, reportStops, shownSurfaces, onShow, sheet]);
  return <PlanetWorldCanvas scene={travelling ? roadless : layout.scene} spots={moving} radius={layout.radius}
    surface surfaces={shownSurfaces} framing={cameraFraming} sideOffset={cameraOffset} orbit={false} sheet={layout.extent} hollow={outlines}
    offset={centre}
    inside={underSheet !== undefined ? library && <UnderTheGlass><KnowledgeGlobePoints core={core} spots={layout.spots} radius={layout.radius} places={codePlaces} sheet={underSheet} /></UnderTheGlass> : <group name="globe-core" visible={library && shownSurfaces.knowledgeCore}><GrowingCore core={core} spots={layout.spots} radius={layout.radius} places={codePlaces} growing={growth !== undefined} /></group>}
    rotation={rotation.toArray()} plateChildren={overlays} lanes={lanes} laneWays={ways} growth={growth} liveRoads={liveRoads}>
    <Navigation islands={layout.islands} radius={layout.radius} titles={new Map(scene.islands.map(i => [i.story, i.title]))}
      rotation={rotation} onRotate={onRotate} onPose={setPose} onControls={onControls} onPick={onPick} onNote={onNote} mode={mode} onPast={setPast} sheet={layout.extent} onSide={sideSeen}
      opening={{ framing: framing ?? 1.18, sideOffset: sideOffset ?? 0 }} aside={aside}
      showFailures={shownSurfaces.grounds || shownSurfaces.territories !== false || shownSurfaces.fileCircles || shownSurfaces.nameplates || shownSurfaces.roads} />
    <NameplateCrowd selected={selected} />
    {growth !== undefined && recordedSessions !== undefined && <ReplaySessions recorded={recordedSessions} onWisps={setReplayed} />}
  </PlanetWorldCanvas>;
}

/** Hands the host the sessions the replay shows now (5.7), only when the replay passes a stage. */
function ReplaySessions({ recorded, onWisps }: { recorded: readonly { at: string; wisps: readonly SessionWisp[] }[]; onWisps: (wisps: readonly SessionWisp[]) => void }) {
  const growth = usePlanetGrowth();
  const stages = useMemo(() => recorded.map(({ at, wisps }) => ({ at: growth.moment(at), wisps })), [recorded, growth]);
  const shown = useRef<readonly SessionWisp[]>(undefined);
  useFrame(() => {
    const now = replayWisps(stages, growth.now());
    if (now !== shown.current) { shown.current = now; onWisps(now); }
  });
  return null;
}

/** The spots on show: `spots`, or, while a change of layout plays, the islands on their way to them (3.28). */
function useMovingSpots(spots: ReadonlyMap<string, FacingIsland["spot"]>, ease: boolean): ReadonlyMap<string, FacingIsland["spot"]> {
  const target = useRef(spots), drawn = useRef(spots), move = useRef<{ from: ReadonlyMap<string, FacingIsland["spot"]>; start: number }>(undefined);
  const [, setTick] = useState(0);
  if (target.current !== spots) {
    const from = drawn.current;
    const moved = [...spots].some(([story, spot]) => { const old = from.get(story); return old !== undefined && (old.x !== spot.x || old.y !== spot.y || old.z !== spot.z); });
    move.current = ease && moved && !reducedMotion() ? { from, start: performance.now() } : undefined;
    target.current = spots;
  }
  const playing = move.current;
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function next() {
      setTick(tick => tick + 1);
      if (performance.now() - playing.start < MOVE_SECONDS * 1000) frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const progress = playing ? (performance.now() - playing.start) / (MOVE_SECONDS * 1000) : 1;
  if (playing && progress >= 1) move.current = undefined;
  drawn.current = progress >= 1 ? spots : movingSpots(playing!.from, spots, progress);
  return drawn.current;
}

/** The core inside the globe, its notes appearing with a growth when there is one (knowledge core 1.9). */
function GrowingCore({ growing, ...props }: Omit<Parameters<typeof KnowledgeGlobePoints>[0], "growth"> & { growing: boolean }) {
  const growth = usePlanetGrowth();
  return <KnowledgeGlobePoints {...props} growth={growing ? growth : undefined} />;
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
function Territories({ story, land, coast, claimed, radius, spot, lighting, surfaces, onStops, raised }: {
  /** On the glass sheet, where each island's plate is raised by its thickness (ADR-1059 D2). */
  raised: boolean;
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
  const { invalidate, clock, camera, size } = useThree();
  // A claim on another island leaves this one's territories as they were.
  const tints = useKept(claimed, tints => claimsOn(tints, land));
  const drawn = useMemo(() => {
    const map = islandTerritories(land.territories, coast);
    const group = territoryLand(map, onIslandSurface(radius, TERRITORY_LIFT), coast, tints);
    const circles = fileCircleMarks(fileCircles(map, land.files), onIslandSurface(radius), islandNormal(radius));
    const root = new Group();
    root.add(group, circles);
    return { root, group, circles, map };
  }, [land, coast, tints, radius]);
  // ADR-0968: each claim's flag, and on an island with no code its lot, kept across claim changes so each plays its life.
  const marks = useMemo(() => new ClaimMarks(), []);
  useEffect(() => () => marks.dispose(), [marks]);
  const first = useRef(true);
  useEffect(() => {
    marks.setLand(drawn.map, onIslandSurface(radius, TERRITORY_LIFT), islandNormal(radius), land.files.length === 0, coast);
    invalidate();
  }, [marks, drawn, land.files.length, coast, radius, invalidate]);
  useEffect(() => {
    // Claims already held when the globe first draws stand; any later one, a replay's included, arrives.
    marks.claims(tints, clock.getElapsedTime(), { standing: first.current && clock.getElapsedTime() < 1, reduced: reducedMotion() });
    first.current = false;
    invalidate();
  }, [marks, tints, clock, invalidate]);
  useFrame(() => {
    // The canvas draws on demand: a transition asks for frames only while it plays; a standing flag asks for none.
    // On the sheet a flag keeps its size at the zoom the perspective eye shows (ADR-1062 D1).
    const zoom = raised ? sheetEyeZoom(camera, size) : camera.zoom;
    if (marks.frame(clock.getElapsedTime(), { zoom, eye: camera.quaternion, reduced: reducedMotion() })) invalidate();
  });
  useEffect(() => {
    if (land.package === undefined) return;
    const { position, quaternion } = plateTransform(spot, radius, raised ? SHEET_LAND_LIFT : 0);
    onStops(story, circleStops(drawn.circles, land.package, { position: new Vector3(...position), quaternion }));
    return () => onStops(story, undefined);
  }, [drawn, land.package, story, spot.x, spot.y, spot.z, radius, raised, onStops]);
  // 3.30: on a growing globe the land fills in behind its island; once whole it is left alone until the growth or the land changes.
  const growth = usePlanetGrowth();
  const whole = useRef(false);
  const grow = useCallback(() => growLand(drawn.group, drawn.circles, { capability: id => growth.capability(id), file: path => growth.file(story, path) }), [drawn, growth, story]);
  // 3.46: what this island already drew stays drawn across a rebuild; new borders trace on and new fills ease in.
  const drawOn = useMemo(() => new TerritoryDrawOn(), []);
  const opened = useRef(true);
  // Before the land is first drawn, so a rebuilt island never shows a frame in the wrong colours.
  useLayoutEffect(() => {
    lightFileCircles(drawn.circles, surfaces.sessionTints ? lighting.files : new Map(), lighting.colour, land.package ?? "");
    lightTerritories(drawn.group, surfaces.sessionTints ? lighting.capabilities : new Map(), lighting.colour);
    drawOn.take(drawn.group, surfaces.territories, clock.getElapsedTime(), { standing: opened.current && clock.getElapsedTime() < 1, reduced: reducedMotion() });
    opened.current = false;
    drawn.circles.visible = surfaces.fileCircles;
    marks.root.visible = surfaces.sessionTints;
    whole.current = grow();
    invalidate();
  }, [drawn, marks, drawOn, lighting, land.package, surfaces, clock, grow, invalidate]);
  useFrame(() => {
    if (drawOn.frame(clock.getElapsedTime(), reducedMotion())) invalidate();
    if (!whole.current) whole.current = grow();
  });
  useEffect(() => () => drawn.root.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  }), [drawn]);
  return <><primitive object={drawn.root} /><primitive object={marks.root} /></>;
}

type ScreenMarker = Pick<EdgeMarker, "story" | "turn"> & { left: number; top: number };

/** The zoom on show, CSS pixels per ground unit at the middle of the view: the orthographic globe's lens, or how near the
 * sheet's perspective eye stands (ADR-1062 D1). */
function zoomOf(camera: Camera & { zoom?: number }, size: { width: number; height: number }, sheet: SheetExtent | undefined): number {
  return sheet === undefined ? camera.zoom ?? 1 : sheetEyeZoom(camera, size);
}

function Navigation({ islands, radius, titles, rotation, onRotate, onPose, onControls, onPick, onNote, mode, onPast, showFailures, opening: globeOpening, aside, sheet, onSide }: {
  onPose: (pose: GlobePose) => void;
  /** Told the tilt as the eye comes to the other side of the glass sheet, tilting past level (ADR-1062 D3). */
  onSide: (tilt: number) => void;
  /** The glass sheet drawn, when it is one (ADR-1043): a drag pans it, and it opens and goes Home to `sheetOpening`. */
  sheet: SheetExtent | undefined;
  /** CSS pixels of the canvas's right a panel covers (3.40). */
  aside: number;
  /** The zoom and offset the globe opened on, which Home returns to with the opening turn (3.37). */
  opening: { framing: number; sideOffset: number };
  /** Told when the eye zooms in past the islands, and back out (ADR-0919 D3). */
  onPast: (past: boolean) => void;
  onControls: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  showFailures: boolean;
  mode: ForestMode;
  /** The globe's radius as laid out, which grows with its islands. */
  radius: number;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  rotation: Quaternion;
  /** The globe's turn, and where its centre stands when the glass sheet is turned over. */
  onRotate: (rotation: Quaternion, offset?: [number, number, number]) => void;
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
}) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const opening = sheet === undefined ? globeOpening : { framing: sheetOpening(sheet, size).framing, sideOffset: globeOpening.sideOffset };
  const [hover, setHover] = useState<{ title: string; detail?: string; x: number; y: number }>();
  const opened = useRef(false);
  // Until the user or a guide moves the sheet, it keeps to its opening as the canvas or the sheet changes size.
  const touched = useRef(false);
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  // The globe turns only by spin and tilt, and the eye never moves, so north stays up (arc north-up).
  const turn = useRef<GlobeTurn>({ yaw: 0, pitch: 0 });
  // How far the glass sheet is tilted (ADR-1062 D2): 0 straight down on its top face, π straight up at its underside; it
  // opens at the resting view of the face it opens on.
  const tilt = useRef(restingTilt(mode));
  // The side of the glass the eye is on, as the host last heard it.
  const side = useRef<ForestMode>(seesUnderside(tilt.current) ? "library" : "forest");
  // The mode read by the pointer's handlers, so a button following a hand's tilt past level never re-makes them mid-drag.
  const modeNow = useRef(mode);
  modeNow.current = mode;
  // Held in a ref, so a host's new callback never re-makes the handlers mid-drag.
  const sideHeard = useRef(onSide);
  sideHeard.current = onSide;
  // How far the glass sheet is spun about its upright axis from its starting heading (ADR-1060 D2), and the compass's reading of it.
  const heading = useRef(0);
  const [compass, setCompass] = useState(0);
  const turnTo = useCallback((next: GlobeTurn) => {
    turn.current = next;
    const rotation = focusRotation(next, camera.quaternion);
    if (sheet === undefined) { onRotate(rotation); return; }
    const turned = sheetTilted(rotation, camera.quaternion, tilt.current, heading.current);
    onRotate(turned.quaternion, turned.position.toArray());
    const now = seesUnderside(tilt.current) ? "library" : "forest";
    if (now !== side.current) { side.current = now; sideHeard.current(tilt.current); }
  }, [camera, onRotate, sheet !== undefined]);
  // The globe group as `turnTo` poses it now, for finding the place under the pointer before the host has drawn the pose.
  const posed = (): Object3D => {
    const group = new Group(), turned = sheetTilted(focusRotation(turn.current, camera.quaternion), camera.quaternion, tilt.current, heading.current);
    group.quaternion.copy(turned.quaternion);
    group.position.copy(turned.position);
    return group;
  };
  // A tilt eases to `to` over `seconds`, or jumps there with reduced motion; a grab, or a new tilt, stops it where it is.
  const tilting = useRef({ frame: 0, to: tilt.current });
  const tiltTo = useCallback((to: number, seconds: number) => {
    cancelAnimationFrame(tilting.current.frame);
    tilting.current.to = to;
    if (reducedMotion() || seconds === 0) { tilt.current = to; turnTo(turn.current); invalidate(); return; }
    const from = tilt.current, start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000)), eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      tilt.current = from + (to - from) * eased;
      turnTo(turn.current);
      invalidate();
      if (t < 1) tilting.current.frame = requestAnimationFrame(step);
    };
    tilting.current.frame = requestAnimationFrame(step);
  }, [turnTo]);
  const holdTilt = (): void => { cancelAnimationFrame(tilting.current.frame); tilting.current.to = tilt.current; };
  // Stories and Library are two resting views (ADR-1062 D3): pressing one swings the tilt to its rest, from above or from
  // below, the same tilt a hand gives, unless the eye is already on that side (the host's button following a hand's tilt).
  const shownMode = useRef(mode);
  useEffect(() => {
    if (sheet === undefined || shownMode.current === mode) return;
    shownMode.current = mode;
    if (side.current === mode) return;
    tiltTo(restingTilt(mode), 0.9);
  }, [mode, tiltTo]);
  useEffect(() => () => cancelAnimationFrame(tilting.current.frame), []);
  // A spin eases to `to` over `seconds`, or jumps there with reduced motion; a new spin takes over from where the sheet is.
  const spinning = useRef({ frame: 0, to: 0 });
  const spinTo = useCallback((to: number, seconds: number) => {
    cancelAnimationFrame(spinning.current.frame);
    spinning.current.to = to;
    touched.current = true;
    if (reducedMotion() || seconds === 0) { heading.current = to; turnTo(turn.current); invalidate(); return; }
    const from = heading.current, start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000)), eased = 1 - (1 - t) ** 3;
      heading.current = from + (to - from) * eased;
      turnTo(turn.current);
      invalidate();
      if (t < 1) spinning.current.frame = requestAnimationFrame(step);
    };
    spinning.current.frame = requestAnimationFrame(step);
  }, [turnTo]);
  // A hand's spin and tilt (a rotating drag, or two fingers) stop any swing and take the sheet from where it is.
  const spinTiltBy = useCallback((drag: { x: number; y: number }) => {
    cancelAnimationFrame(spinning.current.frame);
    holdTilt();
    const next = sheetSpinTilt(heading.current, tilt.current, drag);
    spinning.current.to = heading.current = next.heading;
    tilting.current.to = tilt.current = next.tilt;
    touched.current = true;
  }, []);
  const spinBy = useCallback((clockwise: number) => {
    cancelAnimationFrame(spinning.current.frame);
    spinning.current.to = heading.current = sheetSpin(heading.current, clockwise, seesUnderside(tilt.current));
    touched.current = true;
  }, []);
  useEffect(() => () => cancelAnimationFrame(spinning.current.frame), []);
  // The handle remains stable while its host reads the latest scene, camera and callbacks.
  const host = useRef({ camera, scene, size, radius, onPose, turnTo, invalidate, opening, sheet, spinTo, tiltTo });
  host.current = { camera, scene, size, radius, onPose, turnTo, invalidate, opening, sheet, spinTo, tiltTo };
  const read = (): GlobePose => {
    const { camera: eye, size: viewport, radius: extent } = host.current;
    return { turn: { ...turn.current }, framing: Math.min(viewport.width, viewport.height) / (2 * zoomOf(eye, viewport, host.current.sheet) * extent),
      sideOffset: eye.view?.enabled ? -eye.view.offsetX : 0 };
  };
  const guide = useRef<ReturnType<typeof createGlobeGuide>>(undefined);
  if (guide.current === undefined) guide.current = createGlobeGuide({
    world: () => host.current.scene,
    camera: () => host.current.camera,
    size: () => host.current.size,
    read,
    write: pose => { opened.current = true; host.current.turnTo(pose.turn); host.current.onPose(pose); },
    invalidate: () => host.current.invalidate(),
  });
  const controls = useRef<PlacedGlobeControls>(undefined);
  const guideFrameAt = useRef(0);
  const placedAside = useRef(aside);
  if (controls.current === undefined) controls.current = {
    stop: stop => { const started = guide.current!.stop(stop); if (started) { opened.current = touched.current = true; guideFrameAt.current = performance.now(); } return started; },
    position: target => guide.current!.position(target),
    cancel: () => guide.current!.cancel(),
    moving: () => guide.current!.moving(),
    notes: () => guide.current!.notes(),
    islands: () => guide.current!.islands(),
    aside: () => placedAside.current,
  };
  // The turn the globe opened on, kept as home even when a guide took the first turn (3.37).
  const [home, setHome] = useState<GlobeTurn>();
  useEffect(() => {
    if (home === undefined && islands.length > 0) setHome(openingTurn(islands));
    if (opened.current || (islands.length === 0 && (sheet === undefined || !opensBare(mode)))) return;
    opened.current = true;
    if (sheet === undefined) { turnTo(openingTurn(islands)); return; }
    openSheet();
  }, [islands, turnTo, home]);
  // The sheet opens framing its height from its west edge (ADR-1043 D4).
  const openSheet = (): void => {
    if (sheet === undefined) return;
    turnTo(sheetOpening(sheet, size).turn);
    // Beside the panel, while one is open (3.40).
    onPose({ turn: turn.current, ...besideAside.current!.home(size) });
  };
  useEffect(() => { if (opened.current && !touched.current) openSheet(); }, [size.width, size.height, sheet?.width, sheet?.height]);
  // 3.40: the globe follows the right-hand panel into the free width, and back.
  const besideAside = useRef<ReturnType<typeof createGlobeAside>>(undefined);
  besideAside.current ??= createGlobeAside(() => host.current.opening, { fit: sheet === undefined });
  useEffect(() => {
    const moved = besideAside.current!.place(size, aside, read());
    placedAside.current = aside;
    if (moved === undefined || !guide.current!.slide(moved.to, moved.glide && !reducedMotion() ? 600 : 0)) return;
    guideFrameAt.current = performance.now();
  }, [aside, size.width, size.height]);
  // Where the middle of the view is drawn on the canvas, in CSS pixels from its top left, side offset and all.
  const middleOfView = (): { x: number; y: number } => {
    const { camera: eye, size: viewport } = host.current, at = eye.position.clone().setLength(SHEET_RADIUS + PLATE_CLEARANCE).project(eye);
    return { x: (at.x + 1) * viewport.width / 2, y: (1 - at.y) * viewport.height / 2 };
  };
  // The turn after dragging the place on the sheet at `from` (on the canvas) by `drag`: the place stays under the pointer,
  // or, where the pointer is over no place on the glass, the sheet moves as far as the middle of the view would.
  const panBy = (drag: { x: number; y: number }, from: { x: number; y: number }): GlobeTurn => {
    const { camera: eye, size: viewport, sheet: extent } = host.current;
    if (extent === undefined) return turn.current;
    const globe = posed(), grabbed = sheetUnder(eye, globe, turn.current, from, viewport, extent);
    const now = grabbed && sheetUnder(eye, globe, turn.current, { x: from.x + drag.x, y: from.y + drag.y }, viewport, extent);
    return grabbed !== undefined && now !== undefined ? sheetPanUnder(turn.current, grabbed, now, extent)
      : sheetPan(turn.current, drag, zoomOf(eye, viewport, extent), extent, tilt.current, heading.current);
  };
  const goHome = useRef<() => void>(undefined);
  goHome.current = () => {
    touched.current = false;
    const turn = sheet === undefined ? home : sheetOpening(sheet, size).turn;
    // The compass and Home spin the sheet back to its starting heading, the short way round, and tilt it to the top resting
    // view, as the view eases home (ADR-1060 D3, ADR-1062 D2).
    if (sheet !== undefined) { const back = sheetHome(spinning.current.to); spinTo(back.heading, 0.6); tiltTo(back.tilt, 0.6); }
    touched.current = false;
    if (turn === undefined || !guide.current!.home({ turn, ...besideAside.current!.home(size) })) return;
    guideFrameAt.current = performance.now();
  };
  // On the sheet WASD and the arrows pan while held, Q and E spin it a quarter turn, R and F tilt it a step (ADR-1060 D1, D2,
  // ADR-1062 D2); T is the page's.
  const keyPan = useRef({ held: new Set<string>(), frame: 0, at: 0 });
  useEffect(() => {
    const keys = keyPan.current;
    const panning = (): void => {
      const now = performance.now(), seconds = Math.min(0.1, (now - keys.at) / 1000);
      keys.at = now;
      const extent = host.current.sheet;
      if (keys.held.size === 0 || extent === undefined) { keys.frame = 0; return; }
      guide.current!.cancel();
      host.current.turnTo(panBy(sheetKeyPan(keys.held, seconds), middleOfView()));
      host.current.invalidate();
      keys.frame = requestAnimationFrame(panning);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (host.current.sheet === undefined) { if (asksForHome(event)) { event.preventDefault(); goHome.current!(); } return; }
      const key = sheetKey(event);
      if (key === undefined || key.kind === "turn") return;
      event.preventDefault();
      if (key.kind === "home") goHome.current!();
      else if (key.kind === "spin") { if (!event.repeat) host.current.spinTo(sheetSpin(spinning.current.to, key.by * Math.PI / 2, seesUnderside(tilt.current)), 0.35); }
      else if (key.kind === "tilt") { touched.current = true; host.current.tiltTo(sheetTiltBy(tilting.current.to, key.by * TILT_STEP), 0.25); }
      else {
        touched.current = true;
        keys.held.add(key.key);
        if (keys.frame === 0) { keys.at = performance.now(); keys.frame = requestAnimationFrame(panning); }
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => { keys.held.delete(event.key.toLowerCase()); };
    const onBlur = (): void => keys.held.clear();
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      cancelAnimationFrame(keys.frame);
      keys.frame = 0;
    };
  }, []);
  useEffect(() => {
    onControls?.(controls.current);
    return () => { onControls?.(undefined); };
  }, [onControls]);
  useEffect(() => () => guide.current!.cancel(), []);
  const past = useRef(false);

  // OrbitControls runs before this frame. Project the rim with the current eye AND zoom.
  useFrame(() => {
    const now = performance.now();
    guide.current!.frame(now - guideFrameAt.current);
    guideFrameAt.current = now;
    const zoomedPast = sheet === undefined && pastIslands(Math.min(size.width, size.height) / (2 * camera.zoom * radius), past.current);
    if (zoomedPast !== past.current) onPast(past.current = zoomedPast);
    const centre = new Vector3().project(camera);
    const rim = radius * camera.zoom + 16;
    const middle = { left: (centre.x + 1) * size.width / 2, top: (1 - centre.y) * size.height / 2 };
    // On the sheet nothing is round the back; a failing island past the window's edge is marked at that edge (3.11).
    const hidden = !showFailures ? [] : sheet === undefined
      ? hiddenMarkers(islands, rotation, camera.quaternion, mode).map(marker => ({ ...marker, left: middle.left + marker.at.x * rim, top: middle.top - marker.at.y * rim }))
      : sheetMarkers(islands, island => {
        const at = (scene.getObjectByName(`planet:${island.story}`)?.getWorldPosition(new Vector3()) ?? new Vector3()).project(camera);
        return { left: (at.x + 1) * size.width / 2, top: (1 - at.y) * size.height / 2 };
      }, size, tilt.current);
    // The compass turns with the sheet, read to a tenth of a degree.
    const reading = sheet === undefined ? 0 : Math.round(compassNorth(heading.current, seesUnderside(tilt.current)) * 1800 / Math.PI);
    if (reading !== compass) setCompass(reading);
    // The Sessions strip is docked over the pane's bottom edge; a marker sits clear above it (3.11).
    const box = gl.domElement.getBoundingClientRect();
    const docked = hidden.length === 0 ? [] : [...gl.domElement.ownerDocument.querySelectorAll(".sessions-list")].map(strip => {
      const rect = strip.getBoundingClientRect();
      return { left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top };
    });
    const next = hidden.map(marker => {
      const spot = markerSpot(marker, size, docked);
      return { story: marker.story, turn: marker.turn, left: Math.round(spot.left), top: Math.round(spot.top) };
    });
    const key = JSON.stringify(next);
    if (key !== lastMarkers.current) {
      lastMarkers.current = key;
      setMarkers(next);
    }
  });

  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number; id: number; dragged: boolean; last: { x: number; y: number }; spin: boolean } | undefined;
    // Fingers on the sheet: two of them twist it about its upright axis (ADR-1060 D2), and the wheel's pinch zooms it.
    const fingers = new Map<number, { x: number; y: number }>();
    const pair = (): [{ x: number; y: number }, { x: number; y: number }] => { const [a, b] = [...fingers.values()]; return [a!, b!]; };
    // On the sheet the side the eye is on decides what a click picks: from below, only the notes over the islands' outlines.
    const picking = (): ForestMode => sheet === undefined ? modeNow.current : side.current;
    const pick = (event: PointerEvent) => pickGlobe(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, picking());
    // Picking is costly: a pointer that moves many times a frame is picked once, where it last was.
    let cleared = 0, stopped = false;
    const clearHover = (): void => { cleared++; setHover(undefined); element.style.cursor = ""; };
    const hoverAt = oncePerFrame(({ event, at }: { event: PointerEvent; at: number }): void => {
      if (stopped || at !== cleared || down !== undefined) return;
      const box = element.getBoundingClientRect();
      const { cursor, title, detail } = globeHover(scene, camera, box, { x: event.clientX, y: event.clientY }, picking());
      element.style.cursor = cursor;
      setHover(title === undefined ? undefined : { title, ...(detail === undefined ? {} : { detail }), x: Math.max(8, Math.min(box.width - (detail === undefined ? 220 : 280), event.clientX - box.left + 12)), y: event.clientY - box.top + 14 });
    });
    // A drag redraws the globe once a frame, at the latest turn.
    const dragTo = oncePerFrame((next: GlobeTurn): void => { if (!stopped) turnTo(next); });
    const onDown = (event: PointerEvent): void => {
      // A grab stops a swing between the resting views where it is (ADR-1062 D3).
      if (sheet !== undefined) holdTilt();
      if (sheet !== undefined && event.pointerType === "touch") {
        fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // A second finger ends the first's pan: two fingers twist, slide up and down to tilt, and pinch.
        if (fingers.size > 1) { down = undefined; clearHover(); return; }
      }
      // A plain drag pans; on the sheet a right-drag or a Ctrl+drag spins and tilts it, so no switch changes what a drag does (ADR-1060 D2, D5, ADR-1062 D2).
      const kind = sheet === undefined ? (event.button === 0 && event.isPrimary ? "pan" : undefined) : sheetDrag(event);
      down = kind !== undefined ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false, last: { x: event.clientX, y: event.clientY }, spin: kind === "spin" } : undefined;
      if (down !== undefined) element.setPointerCapture?.(event.pointerId);
      clearHover();
    };
    const onCancel = (event: PointerEvent): void => { fingers.delete(event.pointerId); down = undefined; clearHover(); };
    const onMove = (event: PointerEvent): void => {
      if (fingers.size > 1 && fingers.has(event.pointerId)) {
        const before = pair();
        fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        guide.current!.cancel();
        spinBy(sheetTwist(before, pair()));
        // The pair's middle moving up or down the window tilts the sheet, as a rotating drag does.
        const after = pair();
        spinTiltBy({ x: 0, y: (after[0].y + after[1].y - before[0].y - before[1].y) / 2 });
        dragTo(turn.current);
        return;
      }
      if (fingers.has(event.pointerId)) fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (down !== undefined) {
        if (event.pointerId !== down.id) return;
        down.dragged ||= isGlobeDrag(down, { x: event.clientX, y: event.clientY });
        touched.current = true;
        guide.current!.cancel();
        const drag = { x: event.clientX - down.last.x, y: event.clientY - down.last.y };
        // On the sheet a drag pans, keeping the place grabbed under the pointer, or spins the sheet about its upright axis
        // with its sideways part and tilts it with its up-and-down part (ADR-1060 D2, ADR-1062 D2).
        if (down.spin) spinTiltBy(drag);
        else if (sheet === undefined) turn.current = dragTurn(turn.current, drag, element.clientHeight || 1);
        else { const box = element.getBoundingClientRect(); turn.current = panBy(drag, { x: down.last.x - box.left, y: down.last.y - box.top }); }
        dragTo(turn.current);
        down.last = { x: event.clientX, y: event.clientY };
        clearHover();
        return;
      }
      hoverAt({ event, at: cleared });
    };
    const onUp = (event: PointerEvent): void => {
      const from = down, twisted = fingers.size > 1;
      fingers.delete(event.pointerId);
      down = undefined;
      if (twisted || from === undefined || from.id !== event.pointerId || from.dragged || from.spin || isGlobeDrag(from, { x: event.clientX, y: event.clientY })) return;
      clearHover();
      const hit = pick(event);
      if (hit?.kind === "note") onNote(hit.id);
      else onPick(hit?.id, hit?.capability);
    };
    const onWheel = (event: WheelEvent): void => {
      guide.current!.cancel(); clearHover();
      touched.current = true;
      // On the sheet a sideways scroll pans east and west; the wheel's zoom is the canvas's own.
      if (sheet !== undefined && event.deltaX !== 0) dragTo(turn.current = panBy({ x: -event.deltaX, y: 0 }, middleOfView()));
    };
    // The right button spins and tilts the sheet, so it opens no menu there.
    const onMenu = (event: MouseEvent): void => { if (sheet !== undefined) event.preventDefault(); };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onCancel);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("contextmenu", onMenu);
    clearHover();
    return () => {
      stopped = true;
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onCancel);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onMenu);
      element.style.cursor = "";
    };
  }, [camera, gl, scene, onPick, onNote, turnTo, sheet, spinBy, spinTiltBy]);

  // Pinned to the canvas, not to the globe's centre: under a side offset (3.40) the pointer's tooltip, the rim markers
  // (already placed from the projected centre) and the mini globe would otherwise move twice.
  return <Overlay fullscreen calculatePosition={pinnedToCanvas} zIndexRange={[40, 40]} style={{ pointerEvents: "none" }}>
    {hover !== undefined && <span role="tooltip" className={`knowledge-tooltip${hover.detail === undefined ? "" : " with-detail"}`} style={{ position: "absolute", left: hover.x, top: hover.y }}>
      {hover.detail === undefined ? hover.title : <><strong>{hover.title}</strong><span className="knowledge-tooltip-detail">{hover.detail}</span></>}
    </span>}
    {mode === "forest" && markers.map(marker => <button key={marker.story} type="button" className="planet-edge-marker"
      data-failing-story={marker.story}
      style={{ left: marker.left, top: marker.top }}
      title={`${titles.get(marker.story)} · unhealthy (storytree verified)`}
      aria-label={`Show unhealthy story: ${titles.get(marker.story)}`}
      onClick={() => {
        guide.current!.cancel();
        // On the sheet the guide's stop pans the island into view at the zoom the user chose.
        if (sheet === undefined || !controls.current!.stop({ target: { kind: "story", story: marker.story } })) turnTo(marker.turn);
      }}>!</button>)}
    {home !== undefined && sheet === undefined && <MiniGlobeButton islands={islands} home={home} turn={turn.current} aside={aside} onHome={() => goHome.current!()} />}
    {sheet !== undefined && <SheetCompass north={compass * Math.PI / 1800} aside={aside} onHome={() => goHome.current!()} />}
  </Overlay>;
}

/** ADR-1060 D3: the sheet's compass, its needle pointing to the starting north on the window; a click spins and pans it home. */
function SheetCompass({ north, aside, onHome }: { north: number; aside: number; onHome: () => void }) {
  const c = 32, r = 26, needle = 20, x = Math.cos(north), y = -Math.sin(north);
  const tip = { x: c + x * needle, y: c + y * needle }, tail = { x: c - x * needle * 0.7, y: c - y * needle * 0.7 };
  const side = { x: -y * 5, y: x * 5 };
  return <button type="button" className="planet-mini-globe sheet-compass" style={aside > 0 ? { marginRight: aside } : undefined}
    title="Face the starting way, back to the opening view (Home)" aria-label="Face the starting way, back to the opening view (Home)" onClick={onHome}>
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden="true">
      <circle cx={c} cy={c} r={r} className="mini-globe-sea" />
      <polygon points={`${tip.x},${tip.y} ${c + side.x},${c + side.y} ${c - side.x},${c - side.y}`} className="sheet-compass-north" />
      <polygon points={`${tail.x},${tail.y} ${c + side.x},${c + side.y} ${c - side.x},${c - side.y}`} className="sheet-compass-south" />
      <text x={c + x * (r - 1)} y={c + y * (r - 1)} className="mini-globe-label" textAnchor="middle" dominantBaseline="central">N</text>
    </svg>
  </button>;
}

/** The canvas's middle, where a fullscreen overlay's middle stays whatever the camera's side offset. */
const pinnedToCanvas = (_object: unknown, _camera: unknown, size: { width: number; height: number }) => [size.width / 2, size.height / 2];

/** 3.36: the globe as it opened, small in the corner, with its poles and a mark on the face on show; a click goes home (3.37). */
function MiniGlobeButton({ islands, home, turn, aside, onHome }: { islands: readonly FacingIsland[]; home: GlobeTurn; turn: GlobeTurn; aside: number; onHome: () => void }) {
  const mini = miniGlobe(islands, home, turn);
  const c = 60, r = 44, at = (p: { x: number; y: number }) => ({ cx: c + p.x * r, cy: c - p.y * r });
  const equator = mini.equator.filter(p => p.front).map(p => `${(c + p.x * r).toFixed(1)},${(c - p.y * r).toFixed(1)}`).join(" ");
  const pole = (p: typeof mini.north, label: string) => <g opacity={p.front ? 1 : 0.45}>
    <circle {...at(p)} r={3.5} className="mini-globe-pole" />
    <text x={c + p.x * (r + 10)} y={c - p.y * (r + 10)} className="mini-globe-label" textAnchor="middle" dominantBaseline="central">{label}</text>
  </g>;
  // Land on the far side is drawn as hollow rings under the near side's solid dots.
  const land = [...mini.islands].sort((a, b) => Number(a.front) - Number(b.front));
  // 3.40: it stays in the corner of the free width, left of an open panel.
  return <button type="button" className="planet-mini-globe" style={aside > 0 ? { marginRight: aside } : undefined} title="Back to the opening view (Home)" aria-label="Back to the opening view (Home)" onClick={onHome}>
    <svg viewBox="0 0 120 120" width={120} height={120} aria-hidden="true">
      <circle cx={c} cy={c} r={r} className="mini-globe-sea" />
      <polyline points={equator} className="mini-globe-equator" />
      <line x1={at(mini.south).cx} y1={at(mini.south).cy} x2={at(mini.north).cx} y2={at(mini.north).cy} className="mini-globe-axis" />
      {land.map(island => <circle key={island.story} {...at(island)} r={island.front ? 3.6 : 2.8}
        className={island.front ? "mini-globe-land" : "mini-globe-land behind"} />)}
      {pole(mini.north, "N")}
      {pole(mini.south, "S")}
      <g className={mini.facing.front ? "mini-globe-facing" : "mini-globe-facing behind"}>
        <circle {...at(mini.facing)} r={8} />
        <circle {...at(mini.facing)} r={2} className="mini-globe-facing-dot" />
      </g>
    </svg>
  </button>;
}
