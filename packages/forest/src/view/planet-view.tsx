/** Capability 3 · Story node render. The forest's globe book: lane B's plates at lane A's places, with lane C's failure turns. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Quaternion, Vector3 } from "three";
import { claimTints, openingTurn, replayWisps, selectionLanes, sheetPlaces, type ClaimTint, type EdgeMarker, type FacingIsland, type ForestScene, type GlobeTurn, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, PlanetWorldCanvas, plateTransform, SHEET, SHEET_ACROSS, SHEET_RADIUS, sheetSpot, usePlanetGrowth, type PlanetGrowth, type SheetExtent } from "@storytree/forest-world/planet";
import { islandCoast, islandCoastReach } from "@storytree/forest-world/geometry";
import { codePathKey, type CodePlaces } from "@storytree/knowledge-core";
import { KnowledgeGlobePoints, SheetUnderside, useCodeLighting, type CodeLighting, type KnowledgeCore } from "@storytree/knowledge-core/view";
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
};

export function PlanetView({ core, scene, places, wisps: live, selected, highlighted, onPick, onNote, mode = "forest", framing, sideOffset, aside = 0, surfaces, onControls, library = true, frame, easeMoves = false, growth, liveRoads = false, recordedSessions }: PlanetViewProps) {
  // Zoomed in past the islands, or in the Library, only the glass and the core show (ADR-0919 D3, D4). The hidden
  // marks stay mounted, so guides can still locate them.
  const [past, setPast] = useState(false);
  const shownSurfaces = useMemo(() => surfacesFor(surfaces, !SHEET && (mode === "library" || past)), [surfaces, mode, past]);
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
  const layout = useMemo(() => SHEET ? sheetLayout(scene, places) : planetLayout(scene, places, shown.current, frame), [scene, places, frame]);
  shown.current = layout;
  // 3.28: while a change of layout plays, only the plates travel, with no roads; the rest is drawn once, at the new layout.
  const moving = useMovingSpots(layout.spots, easeMoves), travelling = moving !== layout.spots;
  const roadless = useMemo(() => ({ ...layout.scene, links: [] }), [layout.scene]);
  const [rotation, setRotation] = useState(() => new Quaternion());
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
  // Contract 3.26: the selected story's links to other stories light as lanes; the Library shows none.
  const lanes = useKept(useMemo(() => SHEET || mode === "forest" ? selectionLanes(scene, selected) : [], [scene, selected, mode]), JSON.stringify);
  // ADR-0991 D4: a lit lane runs on from its dock along the territories' borders to its capability.
  const ways = useMemo(() => laneWays(layout.scene.islands), [layout.scene]);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => {
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    const emphasis = shownSurfaces.sessionTints && highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed") : undefined;
    return <>
      {island.land !== undefined && layout.spots.has(island.story) && <Territories story={island.story} land={island.land} coast={coast} claimed={claimed} radius={layout.radius}
        spot={layout.spots.get(island.story)!} lighting={lighting} surfaces={shownSurfaces} onStops={reportStops} />}
      {(SHEET || mode === "forest") && <SessionIslandEmphasis emphasis={emphasis} />}
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      {shownSurfaces.nameplates && <Nameplates island={island} spot={layout.spots.get(island.story)!} coast={coast} radius={layout.radius} selected={selected} dimmed={emphasis === "dimmed"} claimed={claimed} />}
      {(SHEET || mode === "forest") && <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />}
    </>;
  }, [wisps, claimed, selected, highlighted, layout.spots, layout.radius, lighting, reportStops, shownSurfaces, mode]);
  return <PlanetWorldCanvas scene={travelling ? roadless : layout.scene} spots={moving} radius={layout.radius}
    surface surfaces={shownSurfaces} framing={cameraFraming} sideOffset={cameraOffset} orbit={false} sheet={"sheet" in layout ? layout.sheet.extent : undefined}
    inside={"sheet" in layout ? <SheetUnderside core={core} selected={selected} {...layout.sheet.underside} />
      : <group name="globe-core" visible={library && shownSurfaces.knowledgeCore}><GrowingCore core={core} spots={layout.spots} radius={layout.radius} places={codePlaces} growing={growth !== undefined} /></group>}
    rotation={rotation.toArray()} plateChildren={overlays} lanes={lanes} laneWays={ways} growth={growth} liveRoads={liveRoads}>
    <Navigation islands={layout.islands} radius={layout.radius} titles={new Map(scene.islands.map(i => [i.story, i.title]))}
      rotation={rotation} onRotate={setRotation} onPose={setPose} onControls={onControls} onPick={onPick} onNote={onNote} mode={mode} onPast={setPast}
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

/** SPIKE (spike/glass-sheet): how far below the glass one depth of the knowledge graph hangs under the next, in ground units. */
const SHEET_DEPTH_STEP = 7;

/**
 * SPIKE (spike/glass-sheet): the islands on a flat sheet at their permanent places (`sheetPlaces`), with the pool for notes no
 * shelf reaches as a band of glass south of the bottom row, and where each shelf of the knowledge graph hangs: a story's
 * under its island's middle, a capability's under its territory.
 */
function sheetLayout(scene: ForestScene, places: ReadonlyMap<string, number>) {
  const placed = sheetPlaces(scene.islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }), SHEET_ACROSS);
  const margin = 24, poolHeight = placed.rowPitch * 0.7;
  const { west, east, south, north } = placed.bounds;
  const pool = { x: west, y: south - margin - poolHeight, width: east - west, height: poolHeight };
  const glass = { west: west - margin, east: east + margin, south: pool.y - margin, north: north + margin };
  const centre = { x: (glass.west + glass.east) / 2, y: (glass.south + glass.north) / 2 };
  const extent: SheetExtent = { width: glass.east - glass.west, height: glass.north - glass.south };
  const at = new Map([...placed.at].map(([story, p]) => [story, { x: p.x - centre.x, y: p.y - centre.y }]));
  const shelves = new Map<string, { x: number; y: number }>(), stories = new Map<string, string>();
  for (const island of scene.islands) {
    const middle = at.get(island.story)!;
    shelves.set(island.story, middle);
    stories.set(island.story, island.story);
    for (const tree of island.trees) if (tree.capability !== undefined) { stories.set(tree.capability, island.story); shelves.set(tree.capability, middle); }
    if (island.land === undefined) continue;
    // A capability's shelf hangs under the middle of its territory: plate x is east, plate z south.
    const map = islandTerritories(island.land.territories, islandCoast(island));
    map.territories.forEach((territory, index) => {
      if (territory.capability === undefined) return;
      const cells = map.cells.filter(cell => cell.territory === index);
      if (cells.length === 0) return;
      const x = cells.reduce((sum, cell) => sum + cell.site.x, 0) / cells.length, z = cells.reduce((sum, cell) => sum + cell.site.z, 0) / cells.length;
      shelves.set(territory.capability, { x: middle.x + x, y: middle.y - z });
    });
  }
  const islands: FacingIsland[] = scene.islands.map(island => ({ story: island.story, trees: island.trees, spot: sheetSpot(at.get(island.story)!) }));
  return {
    scene, islands, spots: new Map(islands.map(island => [island.story, island.spot])), radius: SHEET_RADIUS,
    sheet: {
      extent, at,
      underside: {
        shelfAt: (node: string) => shelves.get(node),
        storyOf: (node: string) => stories.get(node),
        pool: { x: pool.x - centre.x, y: pool.y - centre.y, width: pool.width, height: pool.height },
        depthStep: SHEET_DEPTH_STEP,
      },
    },
  };
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
  const { invalidate, clock, camera } = useThree();
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
    if (marks.frame(clock.getElapsedTime(), { zoom: camera.zoom, eye: camera.quaternion, reduced: reducedMotion() })) invalidate();
  });
  useEffect(() => {
    if (land.package === undefined) return;
    const { position, quaternion } = plateTransform(spot, radius);
    onStops(story, circleStops(drawn.circles, land.package, { position: new Vector3(...position), quaternion }));
    return () => onStops(story, undefined);
  }, [drawn, land.package, story, spot.x, spot.y, spot.z, radius, onStops]);
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

type ScreenMarker = EdgeMarker & { left: number; top: number };

function Navigation({ islands, radius, titles, rotation, onRotate, onPose, onControls, onPick, onNote, mode, onPast, showFailures, opening, aside }: {
  onPose: (pose: GlobePose) => void;
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
  onRotate: (rotation: Quaternion) => void;
  onPick: (story: string | undefined, capability?: string) => void;
  onNote: (note: string) => void;
}) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const [hover, setHover] = useState<{ title: string; detail?: string; x: number; y: number }>();
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
  const host = useRef({ camera, scene, size, radius, onPose, turnTo, invalidate, opening });
  host.current = { camera, scene, size, radius, onPose, turnTo, invalidate, opening };
  const read = (): GlobePose => {
    const { camera: eye, size: viewport, radius: extent } = host.current;
    return { turn: { ...turn.current }, framing: Math.min(viewport.width, viewport.height) / (2 * eye.zoom * extent),
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
    stop: stop => { const started = guide.current!.stop(stop); if (started) { opened.current = true; guideFrameAt.current = performance.now(); } return started; },
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
    // SPIKE: the sheet opens face up (or face down, opened on the Library), level, whatever is failing.
    const opening = SHEET ? { yaw: mode === "library" ? Math.PI : 0, pitch: 0 } : openingTurn(islands);
    if (home === undefined && islands.length > 0) setHome(opening);
    if (opened.current || islands.length === 0) return;
    opened.current = true;
    turnTo(opening);
  }, [islands, turnTo, home]);
  // SPIKE: the Forest / Library control turns the sheet over left to right, about its north-south line, passing edge-on.
  const flipping = useRef(0);
  useEffect(() => {
    if (!SHEET || !opened.current) return;
    const from = turn.current.yaw, face = mode === "library" ? Math.PI : 0;
    // The nearer way round to the face asked for.
    const to = from + Math.atan2(Math.sin(face - from), Math.cos(face - from));
    if (Math.abs(to - from) < 1e-6) return;
    cancelAnimationFrame(flipping.current);
    if (reducedMotion()) { turnTo({ yaw: to, pitch: 0 }); return; }
    const start = performance.now(), seconds = 0.9;
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000)), eased = t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      turnTo({ yaw: from + (to - from) * eased, pitch: 0 });
      invalidate();
      if (t < 1) flipping.current = requestAnimationFrame(step);
    };
    flipping.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(flipping.current);
  }, [mode, turnTo, invalidate]);
  // 3.40: the globe follows the right-hand panel into the free width, and back.
  const besideAside = useRef<ReturnType<typeof createGlobeAside>>(undefined);
  besideAside.current ??= createGlobeAside(() => host.current.opening);
  useEffect(() => {
    const moved = besideAside.current!.place(size, aside, read());
    placedAside.current = aside;
    if (moved === undefined || !guide.current!.slide(moved.to, moved.glide && !reducedMotion() ? 600 : 0)) return;
    guideFrameAt.current = performance.now();
  }, [aside, size.width, size.height]);
  const goHome = useRef<() => void>(undefined);
  goHome.current = () => {
    if (home === undefined || !guide.current!.home({ turn: home, ...besideAside.current!.home(size) })) return;
    guideFrameAt.current = performance.now();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (asksForHome(event)) { event.preventDefault(); goHome.current!(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    const zoomedPast = !SHEET && pastIslands(Math.min(size.width, size.height) / (2 * camera.zoom * radius), past.current);
    if (zoomedPast !== past.current) onPast(past.current = zoomedPast);
    const centre = new Vector3().project(camera);
    const rim = radius * camera.zoom + 16;
    const hidden = showFailures && !SHEET ? hiddenMarkers(islands, rotation, camera.quaternion, mode) : [];
    // The Sessions strip is docked over the pane's bottom edge; a marker sits clear above it (3.11).
    const box = gl.domElement.getBoundingClientRect();
    const docked = hidden.length === 0 ? [] : [...gl.domElement.ownerDocument.querySelectorAll(".sessions-list")].map(strip => {
      const rect = strip.getBoundingClientRect();
      return { left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top };
    });
    const next = hidden.map(marker => {
      const spot = markerSpot({ left: (centre.x + 1) * size.width / 2 + marker.at.x * rim, top: (1 - centre.y) * size.height / 2 - marker.at.y * rim }, size, docked);
      return { ...marker, left: Math.round(spot.left), top: Math.round(spot.top) };
    });
    const key = JSON.stringify(next);
    if (key !== lastMarkers.current) {
      lastMarkers.current = key;
      setMarkers(next);
    }
  });

  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number; id: number; dragged: boolean; last: { x: number; y: number } } | undefined;
    // SPIKE: the sheet's land can be picked from either face.
    const pick = (event: PointerEvent) => pickGlobe(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, SHEET ? "forest" : mode);
    // Picking is costly: a pointer that moves many times a frame is picked once, where it last was.
    let cleared = 0, stopped = false;
    const clearHover = (): void => { cleared++; setHover(undefined); element.style.cursor = ""; };
    const hoverAt = oncePerFrame(({ event, at }: { event: PointerEvent; at: number }): void => {
      if (stopped || at !== cleared || down !== undefined) return;
      const box = element.getBoundingClientRect();
      const { cursor, title, detail } = globeHover(scene, camera, box, { x: event.clientX, y: event.clientY }, SHEET ? "forest" : mode);
      element.style.cursor = cursor;
      setHover(title === undefined ? undefined : { title, ...(detail === undefined ? {} : { detail }), x: Math.max(8, Math.min(box.width - (detail === undefined ? 220 : 280), event.clientX - box.left + 12)), y: event.clientY - box.top + 14 });
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
        // SPIKE: the sheet only turns over, about its north-south line; it never tilts.
        if (SHEET) turn.current = { yaw: turn.current.yaw, pitch: 0 };
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
      onClick={() => { guide.current!.cancel(); turnTo(marker.turn); }}>!</button>)}
    {home !== undefined && !SHEET && <MiniGlobeButton islands={islands} home={home} turn={turn.current} aside={aside} onHome={() => goHome.current!()} />}
  </Overlay>;
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
