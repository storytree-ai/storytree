/** Capability 3 · Story node render. The forest on the glass sheet (ADR-1043): lane B's plates at their places on the sheet, with its failure markers. */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Group, Quaternion, Vector3, type Camera, type Object3D } from "three";
import { claimTints, replayWisps, selectionLanes, shownPointers, type ClaimTint, type PointerTint, type FacingIsland, type ForestScene, type GlobeTurn, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, Overlay, PlanetWorldCanvas, PLATE_CLEARANCE, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, UnderTheGlass, usePlanetGrowth, type IslandDock, type PlanetGrowth, type SheetExtent } from "@storytree/forest-world/planet";
import type { CodePlaces } from "@storytree/knowledge-core";
import { KnowledgeGlobePoints, useCodeLighting, type CodeLighting, type CoreUnderSheet, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { SessionIslandEmphasis } from "./session-emphasis.js";
import { arcEmphasis, openWorkLayer, openWorkMarks, sizeOpenWork } from "./open-work.js";
import { lightTerritories, territoryLand } from "./territory-land.js";
import { islandRoadMarks, landFill, ringGate, type GatePick } from "./island-roads.js";
import { capabilityPlates } from "./nameplates.js";
import { islandRoadsWhenRouted, knownIslandRoads, pageIslandRouter, roadsVersion, subscribeRoads, type IslandRoads, type RoadsAsk } from "../territories/island-roads.js";
import { islandRelief, type IslandRelief } from "../territories/island-relief.js";
import { islandReliefMarks } from "./island-relief.js";
import { ClaimMarks } from "./claim-flag.js";
import { islandLayoutSteps, type Link } from "../territories/link-layout.js";
import { keptVersion, pageTerritorySearcher, searchIsland, subscribeKept } from "../territories/kept-layout.js";
import { NameplateCrowd, Nameplates, reducedMotion, SelectionRing } from "./island-overlays.js";
import { focusRotation, globeHover, isGlobeDrag, markersApart, markerSpot, movingSpots, MOVE_SECONDS, oncePerFrame, gateAfterSelection, pickClick, type ForestMode, type PickedGate } from "./planet-navigation.js";
import { claimsOn, gatePosts, pointersOn } from "./planet-update.js";
import { createGlobeGuide, type GlobePose, type PlacedGlobeControls } from "./globe-guide.js";
import { createGlobeAside, framedOnResize, type AsidePose } from "./globe-aside.js";
import { compassNorth, opensBare, seesUnderside, sheetDrag, sheetHome, sheetKey, sheetKeyPan, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetPointerMarkers, sheetPanUnder, sheetSpin, sheetSpinTilt, sheetTilted, sheetTiltBy, sheetTwist, sheetUnder, TILT_PER_PIXEL, TILT_STEP, withDocks } from "./sheet-navigation.js";
import { growLand, IslandOpening, presentDetail, shownSurfaces as surfacesFor, TerritoryDrawOn, type GlobeSurfaces } from "./globe-surfaces.js";
import { DetailStore } from "./zoom-detail.js";
import { useBuiltInSteps } from "./build-turns.js";
import type { TerritoryMap } from "../territories/territories.js";

export type PlanetViewProps = {
  /** Receives the app-owned controls while the map is mounted. */
  onControls?: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  /** Hears each scene once a frame showing it has been painted (3.75). */
  onPainted?: ((scene: ForestScene) => void) | undefined;
  /** Every surface is shown by default, with territories coloured by health. */
  surfaces?: Partial<GlobeSurfaces> | undefined;
  /** Move the sheet right by this many CSS pixels, leaving its turn unchanged. */
  sideOffset?: number | undefined;
  /** CSS pixels of the canvas's right a panel covers: the sheet glides into the width left of it (3.40). */
  aside?: number | undefined;
  mode?: ForestMode;
  /** False when the Library is switched off (ADR-0750): no notes under the glass. */
  library?: boolean;
  /** How many of the sheet's radii half the short side spans when a guide frames the whole map (`globeFraming`, 3.66). */
  framing?: number | undefined;
  /** The full plan a plan still growing is drawn within: each island keeps the spot it has there (3.28). */
  frame?: ForestScene | undefined;
  /** A host that changes `places` or `frame` (one layout for the plan as it was, one for the plan as it is) has its islands
   * ease across from one to the other, once (3.28); without it, or with reduced motion, they jump. */
  easeMoves?: boolean | undefined;
  /** A recorded growth to replay (world 7): islands rise, their territories fill in behind them (3.30), and the core's notes appear. */
  growth?: PlanetGrowth | undefined;
  /** With a growth, the sessions recorded with each dated stage: they pass over the islands they held as the replay reaches them (5.7), in place of `wisps`. */
  recordedSessions?: readonly { at: string; wisps: readonly SessionWisp[] }[] | undefined;
  core: KnowledgeCore;
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  /** The selected story's capability, picked on its territory or in the panel, which is ringed in gold (3.91). */
  selectedCapability?: string | undefined;
  highlighted?: readonly string[] | undefined;
  /** The capabilities the selected arc's open increments name, which are ringed and the rest dimmed; undefined with no arc selected (3.83). */
  circled?: readonly string[] | undefined;
  /** Hears a click on an island, or undefined for empty space. */
  onPick: (story: string | undefined, capability?: string, gate?: readonly [string, string]) => void;
  onNote: (note: string) => void;
};

/** The forest drawn on the glass sheet, depth running west to east (ADR-1043): the user tilts it from above to below
 * (ADR-1062 D2); `mode` changes only its look, never the eye (D3). */
export function PlanetView({ core, scene, places, wisps: live, selected, selectedCapability, highlighted, circled: circledList, onPick, onNote, mode = "forest", framing, sideOffset, aside = 0, surfaces, onControls, onPainted, library = true, frame, easeMoves = false, growth, recordedSessions }: PlanetViewProps) {
  // In the glass sheet's Library the glass is clear and the islands hollow outlines with their names over the knowledge, from
  // every angle (ADR-1061 D2, ADR-1062 D3): the button pressed decides, never the side the eye is on.
  const outlines = mode === "library";
  const shownSurfaces = useMemo(() => surfacesFor(surfaces, outlines), [surfaces, outlines]);
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
  const layout = useMemo(() => sheetLayout(scene, places, frame), [scene, places, frame]);
  // 3.28: while a change of layout plays, only the plates travel, with no roads; the rest is drawn once, at the new layout.
  const moving = useMovingSpots(layout.spots, easeMoves), travelling = moving !== layout.spots;
  const roadless = useMemo(() => ({ ...layout.scene, links: [] }), [layout.scene]);
  // The big sphere's turn, and its centre standing off the origin as the sheet is tilted and turned about the middle of the
  // view (ADR-1043 D3, ADR-1059 D1): set on the globe's group, never in state, so a turning drag renders no view (3.71).
  const globe = useRef<Group>(null);
  const turned = useRef<{ rotation: Quaternion; centre?: [number, number, number] | undefined }>({ rotation: new Quaternion() });
  const onRotate = useCallback((next: Quaternion, at?: [number, number, number]) => {
    turned.current.rotation.copy(next);
    turned.current.centre = at;
    globe.current?.quaternion.copy(next);
    globe.current?.position.set(...(at ?? [0, 0, 0]));
  }, []);
  // 5.7: replaying a growth with its recorded sessions, the wisps are the replay's, swapped as it passes each stage.
  const [replayed, setReplayed] = useState<readonly SessionWisp[]>();
  const wisps = growth !== undefined && recordedSessions !== undefined ? replayed ?? [] : live;
  // ADR-0968, ADR-0923: a running session plants a flag on each territory it claimed, and nothing else; no wisps, no coast tint.
  const claimed = useMemo(() => claimTints(wisps), [wisps]);
  // ADR-1212 D3: no file is drawn on the land, so the core's traversal has no stops there; a capability a session opened still lights its territory.
  const capabilities = useKept(useMemo(() => scene.islands.flatMap(({ land }) => land === undefined ? [] : land.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability])), [scene]), JSON.stringify);
  const codePlaces = useMemo((): CodePlaces => ({ capabilities: new Set(capabilities) }), [capabilities]);
  const lighting = useCodeLighting(core, codePlaces);
  // Contract 3.26: the selected story's links to other stories light as lanes, on both the sheet's faces (ADR-1043 D3).
  const lanes = useKept(useMemo(() => selectionLanes(scene, selected), [scene, selected]), JSON.stringify);
  // 3.88: the gate picked on an island, ringed; another selection puts it out.
  const [gate, setGate] = useState<PickedGate>();
  useEffect(() => { setGate(picked => gateAfterSelection(picked, selected)); }, [selected]);
  // The knowledge graph under the glass sheet: each shelf's notes under its place, the selected story's lit (ADR-1043 D5).
  // 3.76: once an island's plate has seen its docks, its shelves hang under its territories as laid out by its links.
  const [seenDocks, setSeenDocks] = useState<ReadonlyMap<string, readonly IslandDock[]>>(NO_DOCKS_SEEN);
  const onDocks = useCallback((story: string, docks: readonly IslandDock[] | undefined) => setSeenDocks(seen => withDocks(seen, story, docks)), []);
  // 3.80: and once the search keeps an arrangement for it, under its territories as kept.
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const under = useMemo(() => seenDocks.size === 0 ? layout.under : sheetLayout(scene, places, frame, seenDocks).under,
    [layout, seenDocks, scene, places, frame, kept]);
  // 3.86: how much of every island's detail the eye's zoom shows, read once a frame.
  const detail = useMemo(() => new DetailStore(), []);
  const underSheet = useMemo((): CoreUnderSheet => ({ ...under, selected }), [under, selected]);
  const links = useKept(layout.scene.links ?? NO_LINKS, JSON.stringify);
  // ADR-1253 D1: the selected arc's open work ringed.
  const circledKey = circledList === undefined ? undefined : JSON.stringify(circledList);
  const circled = useMemo(() => circledList === undefined ? undefined : new Set(circledList), [circledKey]);
  // 5.8: a session's pointer pulses on the selected arc's open work, or anywhere when it is for a question; the camera stays his.
  const pointed = useMemo(() => shownPointers(wisps, circled), [wisps, circled]);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[], docks: readonly IslandDock[] | undefined) => {
    // ADR-1236 D1 as narrowed by ADR-1253 D2: every island's territories are laid out by its links, once its docks are known.
    const laidBy = docks;
    // Lane B has already centred the descriptors in the plate's own ground coordinates.
    const local = { ...island, x: 0, z: 0 };
    // A session's hover outranks an arc's selection; an arc selected dims the islands it rings nothing on (3.83).
    const emphasis = shownSurfaces.sessionTints && highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed")
      : arcEmphasis(island.land?.territories ?? [], circled);
    return <>
      {island.land !== undefined && layout.spots.has(island.story) && <Territories story={island.story} land={island.land} coast={coast} links={links} docks={laidBy} claimed={claimed} pointed={pointed} radius={layout.radius}
        lighting={lighting} surfaces={shownSurfaces} gate={gate?.story === island.story ? gate.pick : undefined}
        picked={island.story === selected ? selectedCapability : undefined} circled={circled} detail={detail} />}
      <SessionIslandEmphasis emphasis={emphasis} />
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      {shownSurfaces.nameplates && <Nameplates island={island} spot={layout.spots.get(island.story)!} coast={coast} links={links} docks={laidBy} radius={layout.radius} selected={selected} dimmed={emphasis === "dimmed"} claimed={claimed} detail={detail} />}
      <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />
      <DocksSeen story={island.story} docks={docks} onDocks={onDocks} />
    </>;
  }, [wisps, claimed, pointed, selected, highlighted, circled, layout.spots, layout.radius, lighting, shownSurfaces, links, gate, selectedCapability, detail, onDocks]);
  const titles = useMemo(() => new Map(scene.islands.map(i => [i.story, i.title])), [scene]);
  // 3.90: the wheel's floor is half the sheet's opening, whatever framing the last pose (a panel's resize or slide) sent.
  const floor = useCallback((size: { width: number; height: number }) => sheetOpening(layout.extent, size).framing, [layout.extent]);
  const inside = useMemo(() => library && <UnderTheGlass clear={outlines}><GrowingCore core={core} spots={layout.spots} radius={layout.radius} places={codePlaces} sheet={underSheet} growing={growth !== undefined} /></UnderTheGlass>,
    [library, outlines, core, layout.spots, layout.radius, codePlaces, underSheet, growth]);
  return <PlanetWorldCanvas scene={travelling ? roadless : layout.scene} spots={moving} radius={layout.radius}
    surface surfaces={shownSurfaces} framing={cameraFraming} floor={floor} sideOffset={cameraOffset} sheet={layout.extent} hollow={outlines}
    globe={globe} offset={turned.current.centre} inside={inside}
    rotation={turned.current.rotation.toArray()} plateChildren={overlays} lanes={lanes} growth={growth}>
    <Navigation islands={layout.islands} radius={layout.radius} titles={titles}
      rotation={turned.current.rotation} onRotate={onRotate} onPose={setPose} onControls={onControls} onPick={onPick} onGate={setGate} onNote={onNote} mode={mode} sheet={layout.extent}
      sideOffset={sideOffset ?? 0} aside={aside}
      showFailures={shownSurfaces.grounds || shownSurfaces.territories !== false || shownSurfaces.nameplates || shownSurfaces.roads} />
    <NameplateCrowd selected={selected} />
    <DetailFeed detail={detail} />
    <CompiledAtLoad under={underSheet} />
    {onPainted !== undefined && <PaintedReport scene={scene} onPainted={onPainted} />}
    {growth !== undefined && recordedSessions !== undefined && <ReplaySessions recorded={recordedSessions} onWisps={setReplayed} />}
  </PlanetWorldCanvas>;
}

/** 3.76: tells the view the docks an island's plate was handed, each time they change. */
function DocksSeen({ story, docks: given, onDocks }: { story: string; docks: readonly IslandDock[] | undefined; onDocks: (story: string, docks: readonly IslandDock[] | undefined) => void }) {
  const docks = useKept(given, (docks) => JSON.stringify(docks ?? null));
  useEffect(() => { onDocks(story, docks); }, [story, docks, onDocks]);
  return null;
}

/** 3.86: reads the eye's zoom on every frame drawn, so the islands show the detail it asks for. */
function DetailFeed({ detail }: { detail: DetailStore }) {
  useFrame(({ camera, size }) => { detail.zoom(sheetEyeZoom(camera, size)); });
  return null;
}

/** 3.73: once the map has drawn its first frame, every material on it is compiled, hidden ones too, so no turn that shows one
 * stalls on its shader; and again whenever the notes hung under the islands (`under`) are drawn anew. Each island's land
 * compiles its own marks as they are built (3.87), so a zoom that first shows them (3.86) stalls on none either. */
function CompiledAtLoad({ under }: { under: CoreUnderSheet }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const frame = requestAnimationFrame(() => gl.compile(scene, camera));
    return () => cancelAnimationFrame(frame);
  }, [gl, scene, camera, under]);
  return null;
}

/**
 * 3.75: tells the host once a frame showing `scene` has been painted. A new scene asks for a frame, so a scene that changes no
 * object still gets one; the report waits for the frame's render, which runs after every frame callback in the same task.
 */
function PaintedReport({ scene, onPainted }: { scene: ForestScene; onPainted: (scene: ForestScene) => void }) {
  const invalidate = useThree(state => state.invalidate);
  const reported = useRef<ForestScene>(undefined);
  useEffect(() => { invalidate(); }, [scene, invalidate]);
  useFrame(() => {
    if (reported.current === scene) return;
    reported.current = scene;
    queueMicrotask(() => onPainted(scene));
  });
  return null;
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

/** The core under the glass sheet, its notes appearing with a growth when there is one (knowledge core 1.9). */
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

const NO_LINKS: readonly Link[] = [];
const NO_DOCKS_SEEN: ReadonlyMap<string, readonly IslandDock[]> = new Map();

/** Lifted just off the surface, so a territory's tint never fights the ground it lies on. */
const TERRITORY_LIFT = 0.05;
/** An island's roads and gate posts lie just above its territories. */
const ROAD_LIFT = 0.08;
/** The open work's rings lie on the land, drawn over its roads, and the dims under them (3.83). */
const OPEN_WORK_LIFT = 0.1;

type TerritoriesProps = {
  story: string;
  /** How much of the island the eye's zoom shows (3.86). */
  detail: DetailStore;
  /** The selected arc's open work, ringed, the rest dimmed (3.83). */
  circled: ReadonlySet<string> | undefined;
  /** The gate picked on the island, which it rings (3.88). */
  gate?: GatePick | undefined;
  /** The selected capability, if the island is selected, which it rings in gold (3.91). */
  picked?: string | undefined;
  land: NonNullable<Island["land"]>;
  coast: readonly (readonly { x: number; z: number }[])[];
  links: readonly Link[];
  /** The docks the island's lanes come ashore at, when it is laid out by its links. */
  docks: readonly IslandDock[] | undefined;
  claimed: ReadonlyMap<string, ClaimTint>;
  /** The capabilities sessions point the owner's eye at, shown (5.8). */
  pointed: ReadonlyMap<string, PointerTint>;
  radius: number;
  lighting: CodeLighting;
  surfaces: GlobeSurfaces;
};

/**
 * An island's territories (3.14), cut to its coast and laid on its surface, all in the plate's own units; it lights
 * the territories the selected session's window opened (3.18). No file is drawn on them (ADR-1212).
 */
function Territories(props: TerritoriesProps) {
  const { story, land: given, coast: givenCoast, links, docks: givenDocks, claimed, pointed: allPointed } = props;
  const { clock } = useThree();
  // 3.72: an update that redraws the island for anything else (its name, its trees) hands it new land and coast that read
  // the same; the territories already cut for them stay.
  const land = useKept(given, JSON.stringify), coast = useKept(givenCoast, JSON.stringify), docks = useKept(givenDocks, (docks) => JSON.stringify(docks ?? null));
  // A claim on another island leaves this one's territories as they were.
  const tints = useKept(claimed, tints => claimsOn(tints, land));
  // A pointer on another island leaves this one's as they were (5.8).
  const pointed = useKept(useMemo(() => pointersOn(allPointed, land), [allPointed, land]), (here) => JSON.stringify([...here]));
  // When the island joined the map, after its first island did: one there as the map opens stands, its land included, however
  // late it is built, and however late the plan came after the sheet first drew.
  const [joined] = useState(() => sinceFirstIsland(clock));
  // 3.80: laid out from the arrangement the search kept for it, and searched off the page when there is none for its structure.
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  // 3.87: settled in its turns, a few of the fine cut's cells or one try at growing to each, so opening a map of many
  // islands never lays out one of them, let alone several, in one task.
  const map = useBuiltInSteps(() => islandLayoutSteps(story, land.territories, coast, links, docks), [story, land, coast, links, docks, kept]);
  useEffect(() => { if (docks !== undefined) searchIsland(story, { shares: land.territories, coast, links, docks }, pageTerritorySearcher()); }, [story, land, coast, links, docks]);
  return map === undefined ? null : <IslandLand {...props} land={land} coast={coast} docks={docks} tints={tints} pointed={pointed} map={map} joined={joined} />;
}

/** When each sheet's first island joined it, by the sheet's clock. */
const firstIsland = new WeakMap<object, number>();

/** The seconds since the sheet ticking on `clock` was joined by its first island, which is now when none has. */
function sinceFirstIsland(clock: { getElapsedTime(): number }): number {
  const now = clock.getElapsedTime();
  if (!firstIsland.has(clock)) firstIsland.set(clock, now);
  return now - firstIsland.get(clock)!;
}

type IslandLandProps = Omit<TerritoriesProps, "claimed"> & { tints: ReadonlyMap<string, ClaimTint>; map: TerritoryMap; joined: number };

/** The island's land as laid out (`map`), and its roads once routed. */
function IslandLand(props: IslandLandProps) {
  const { map, coast, links, docks, tints, radius } = props;
  // ADR-1236 D1: an island's links are one shared road network, with a gate wherever a road crosses a border.
  // 3.82: routed off the page, so the territories draw at once and the roads when they arrive.
  const routedVersion = useSyncExternalStore(subscribeRoads, roadsVersion);
  const ask = useMemo((): RoadsAsk | undefined => docks === undefined ? undefined : { map, links, docks, names: capabilityPlates(map) }, [map, links, docks]);
  const roads = useMemo(() => ask === undefined ? undefined : knownIslandRoads(ask), [ask, routedVersion]);
  useEffect(() => {
    if (ask === undefined || roads !== undefined) return;
    const overtaken = new AbortController();
    islandRoadsWhenRouted(ask, pageIslandRouter(), overtaken.signal);
    return () => overtaken.abort();
  }, [ask, roads]);
  // 3.87: its meshes built in their turns, the land's at once and again with its relief and roads when they arrive, the
  // relief, the land, the relief's marks and the roads' each a step of its own, so the biggest island's fits a task.
  const drawn = useBuiltInSteps(function* (): Generator<void, DrawnLand, void> {
    // 3.78: and every territory a plateau above its open land, a ramp where a road climbs onto one.
    const relief = roads === undefined ? undefined : islandRelief(map, roads);
    if (relief !== undefined) yield;
    const onLand = onIslandSurface(radius, TERRITORY_LIFT + (relief?.height ?? 0));
    const group = territoryLand(map, onLand, coast, tints, roads);
    // The roads and the relief lie on the land, so they show and hide with the territories (3.22).
    if (roads !== undefined && relief !== undefined) {
      let built = false;
      try {
        yield;
        const fill = landFill(map, group);
        group.add(islandReliefMarks(relief, onIslandSurface(radius, TERRITORY_LIFT), fill));
        yield;
        group.add(islandRoadMarks(roads, onIslandSurface(radius, ROAD_LIFT), fill, relief));
        built = true;
      } finally { if (!built) disposeMarks(group); }
    }
    // 3.86: every island's marks stand where they were built, so the frame never recomputes their matrices, shown or hidden.
    group.traverse((mark) => { if (mark !== group) { mark.updateMatrix(); mark.matrixAutoUpdate = false; } });
    return { group, map, roads, relief, onLand };
  }, [map, coast, tints, radius, roads]);
  return drawn === undefined ? null : <DrawnIsland {...props} drawn={drawn} />;
}

/** Lets go of every geometry and material under `group`. */
function disposeMarks(group: Group): void {
  group.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  });
}

/** An island's land as built: its territories' meshes, and its relief and roads once they are routed. */
type DrawnLand = { group: Group; map: TerritoryMap; roads: IslandRoads | undefined; relief: IslandRelief | undefined; onLand: ReturnType<typeof onIslandSurface> };

function DrawnIsland({ drawn, land, coast, docks, tints, pointed, radius, lighting, surfaces, gate, picked, circled, detail, joined }: IslandLandProps & { drawn: DrawnLand }) {
  const { invalidate, clock, camera, size, gl, scene } = useThree();
  const relief = drawn.relief, onLand = drawn.onLand;
  // 3.83: the open work's rings round its settlements, and its dims, over the land as drawn now, at every zoom (ADR-1272 D2);
  // and the selected capability's gold ring (3.91).
  const openWork = useMemo(() => openWorkLayer(openWorkMarks(drawn.map, circled, drawn.roads, picked), drawn.group,
    onIslandSurface(radius, OPEN_WORK_LIFT + (relief?.height ?? 0)), sheetEyeZoom(camera, size)), [drawn, circled, picked, radius, relief]);
  // 3.73: its marks' shaders compiled as they are built, hidden ones too, so the zoom that first shows them stalls on none.
  useEffect(() => {
    const frame = requestAnimationFrame(() => { gl.compile(drawn.group, camera, scene); gl.compile(openWork, camera, scene); });
    return () => cancelAnimationFrame(frame);
  }, [gl, camera, scene, drawn, openWork]);
  useEffect(() => { invalidate(); return () => openWork.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void }; name: string };
    // A dim lies on its territory's own geometry, which the land disposes.
    if (!mark.name.startsWith("open-work-dim:")) mark.geometry?.dispose();
    mark.material?.dispose();
  }); }, [openWork, invalidate]);
  // 3.88: a picked gate's ring, on the roads as drawn now.
  const gateRing = useMemo(() => drawn.group.getObjectByName("gate-ring") as Group | undefined, [drawn]);
  useLayoutEffect(() => {
    if (drawn.roads === undefined) return;
    ringGate(drawn.group, drawn.roads, gate, sheetEyeZoom(camera, size) * (drawn.group.matrixWorld.getMaxScaleOnAxis() || 1));
    invalidate();
  }, [drawn, gate, invalidate]);
  // ADR-0968: each claim's flag, and on an island with no code its lot, kept across claim changes so each plays its life.
  const marks = useMemo(() => new ClaimMarks(), []);
  useEffect(() => () => marks.dispose(), [marks]);
  const first = useRef(true);
  useEffect(() => {
    // 5.9: a pointer at a gate pulses at its posts, once the roads are routed.
    marks.setLand(drawn.map, onLand, islandNormal(radius), land.files.length === 0, coast, drawn.roads === undefined ? undefined : gatePosts(drawn.roads.gates));
    invalidate();
  }, [marks, drawn, land.files.length, coast, radius, onLand, invalidate]);
  useEffect(() => {
    // Claims already held when the sheet first draws stand; any later one, a replay's included, arrives.
    marks.claims(tints, clock.getElapsedTime(), { standing: first.current && joined < 1, reduced: reducedMotion() });
    first.current = false;
    invalidate();
  }, [marks, tints, clock, invalidate]);
  useEffect(() => {
    marks.pointers(pointed);
    invalidate();
  }, [marks, pointed, invalidate]);
  useFrame(() => {
    // The canvas draws on demand: a transition asks for frames only while it plays; a standing flag asks for none.
    // A flag keeps its size at the zoom the perspective eye shows (ADR-1062 D1).
    const zoom = sheetEyeZoom(camera, size);
    if (marks.frame(clock.getElapsedTime(), { zoom, eye: camera.quaternion, reduced: reducedMotion() })) invalidate();
    // 3.86: the open work's rings keep their line's width on screen at the zoom the eye shows, as a flag keeps its size.
    if (openWork.children.length > 0 && sizeOpenWork(openWork, zoom * (openWork.matrixWorld.getMaxScaleOnAxis() || 1))) invalidate();
    // 3.88: and a picked gate's ring.
    if (gateRing !== undefined && gateRing.children.length > 0 && sizeOpenWork(gateRing, zoom * (gateRing.matrixWorld.getMaxScaleOnAxis() || 1))) invalidate();
  });
  // 3.30: on a growing map the land fills in behind its island; once whole it is left alone until the growth or the land changes.
  const growth = usePlanetGrowth();
  const whole = useRef(false);
  const grow = useCallback(() => growLand(drawn.group, { capability: id => growth.capability(id) }), [drawn, growth]);
  // 3.46: what this island already drew stays drawn across a rebuild; new borders trace on and new fills ease in.
  const drawOn = useMemo(() => new TerritoryDrawOn(), []);
  // 3.87: an island there as the map opens stands until a frame has drawn its land whole: laid out by its docks, and with its roads.
  const opening = useMemo(() => new IslandOpening(), []);
  // Before the land is first drawn, so a rebuilt island never shows a frame in the wrong colours.
  useLayoutEffect(() => {
    lightTerritories(drawn.group, surfaces.sessionTints ? lighting.capabilities : new Map(), lighting.colour);
    const standing = opening.built(docks !== undefined && drawn.roads !== undefined) && joined < 1;
    drawOn.take(drawn.group, surfaces.territories, clock.getElapsedTime(), { standing, reduced: reducedMotion() });
    marks.root.visible = surfaces.sessionTints;
    whole.current = grow();
    invalidate();
  }, [drawn, marks, drawOn, opening, lighting, surfaces, clock, grow, invalidate]);
  useFrame(() => {
    opening.drew();
    if (drawOn.frame(clock.getElapsedTime(), reducedMotion())) invalidate();
    if (!whole.current) whole.current = grow();
  });
  // 3.86: what the zoom shows of the land as drawn, its shapes left as they are.
  const level = useSyncExternalStore(detail.subscribe, detail.get);
  useLayoutEffect(() => {
    presentDetail(drawn.group, level);
    invalidate();
  }, [drawn, level, surfaces, invalidate]);
  useEffect(() => () => disposeMarks(drawn.group), [drawn]);
  return <><primitive object={drawn.group} /><primitive object={marks.root} />{surfaces.territories !== false && <primitive object={openWork} />}</>;
}


/** A failing island's marker at the window's edge, in CSS pixels, with the turn that brings it into view (3.11). */
/** An edge marker: a failing island's (3.11), or a session's pointer's, in its colour, when it names the `pointer` (3.89). */
type ScreenMarker = { story: string; turn: GlobeTurn; left: number; top: number; pointer?: string; colour?: string };

/** The one dev-only seam an evidence capture reads the sheet's turn through: a capture build sets this global
 * before the page runs, and Navigation hands it the turn as drawn and the call that sets it, on every render.
 * Nothing in the product sets it (mirrors forest-world's `__storytreeCaptureGlobe`). */
export const NAVIGATION_SEAM = "__storytreeCaptureNavigation";
/** What Navigation hands a capture build's `NAVIGATION_SEAM`. */
export type CapturedNavigation = { rotation: Quaternion; onRotate: (rotation: Quaternion, offset?: [number, number, number]) => void };

function Navigation({ islands, radius, titles, rotation, onRotate, onPose, onControls, onPick, onGate, onNote, mode, showFailures, sideOffset, aside, sheet }: {
  /** Hears a click on a road or gate (3.81), and undefined for a click on anything else. */
  onGate: (gate: PickedGate | undefined) => void;
  onPose: (pose: GlobePose) => void;
  /** The glass sheet drawn (ADR-1043): a drag pans it, and it opens and goes Home to `sheetOpening`. */
  sheet: SheetExtent;
  /** CSS pixels of the canvas's right a panel covers (3.40). */
  aside: number;
  /** The side offset the sheet opened on, which Home returns to (3.37). */
  sideOffset: number;
  onControls: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  showFailures: boolean;
  mode: ForestMode;
  /** The big sphere's radius, the sheet its near pole. */
  radius: number;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  /** The big sphere's turn as drawn now: a capture build reads it beside `onRotate` through `NAVIGATION_SEAM`. */
  rotation: Quaternion;
  /** The big sphere's turn, and where its centre stands as the glass sheet is tilted and spun. */
  onRotate: (rotation: Quaternion, offset?: [number, number, number]) => void;
  onPick: (story: string | undefined, capability?: string, gate?: readonly [string, string]) => void;
  onNote: (note: string) => void;
}) {
  const { camera, gl, scene, size, invalidate } = useThree();
  // The host sets the turn on the globe's group, so it is drawn on the next frame asked for.
  const rotate = useCallback((next: Quaternion, at?: [number, number, number]) => { onRotate(next, at); invalidate(); }, [onRotate, invalidate]);
  (globalThis as { [NAVIGATION_SEAM]?: (navigation: CapturedNavigation) => void })[NAVIGATION_SEAM]?.({ rotation, onRotate: rotate });
  const opening = { framing: sheetOpening(sheet, size).framing, sideOffset };
  const [hover, setHover] = useState<{ title: string; detail?: string; x: number; y: number }>();
  const opened = useRef(false);
  // Until the user or a guide moves the sheet, it keeps to its opening as the sheet changes size.
  const touched = useRef(false);
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  // The big sphere turns by a hair to slide the sheet under the eye; the eye never rolls.
  const turn = useRef<GlobeTurn>({ yaw: 0, pitch: 0 });
  // How far the glass sheet is tilted (ADR-1062 D2): 0 straight down on its top face, π straight up at its underside; it
  // opens at the top resting tilt in Stories and Library alike, and only the user moves it from there (ADR-1062 D3).
  const tilt = useRef(SHEET_TILT);
  // The mode read by the pointer's handlers, so a press of Stories or Library never re-makes them mid-drag.
  const modeNow = useRef(mode);
  modeNow.current = mode;
  // How far the glass sheet is spun about its upright axis from its starting heading (ADR-1060 D2), and the compass's reading of it.
  const heading = useRef(0);
  // Read to a tenth of a degree; the compass alone renders as it turns, never the view around it (3.71).
  const compass = useRef<{ reading: number; follow?: ((reading: number) => void) | undefined }>({ reading: 0 });
  const turnTo = useCallback((next: GlobeTurn) => {
    turn.current = next;
    const turned = sheetTilted(focusRotation(next, camera.quaternion), camera.quaternion, tilt.current, heading.current);
    rotate(turned.quaternion, turned.position.toArray());
  }, [camera, rotate]);
  // The sheet's group as `turnTo` poses it now, for finding the place under the pointer before the host has drawn the pose.
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
  // A hand's spin and tilt (a rotating drag, or two fingers) stop any tilt a key began and take the sheet from where it is.
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
    return { turn: { ...turn.current }, framing: Math.min(viewport.width, viewport.height) / (2 * sheetEyeZoom(eye, viewport) * extent),
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
    // 3.66: a stop at the whole map goes to the sheet's opening.
    opening: framing => sheetOpening(host.current.sheet, host.current.size, framing),
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
  useEffect(() => {
    if (opened.current || (islands.length === 0 && !opensBare(mode))) return;
    opened.current = true;
    openSheet();
  }, [islands, turnTo]);
  // The sheet opens framing its height from its west edge (ADR-1043 D4).
  const openSheet = (): void => {
    turnTo(sheetOpening(sheet, size).turn);
    // Beside the panel, while one is open (3.40).
    onPose({ turn: turn.current, ...besideAside.current!.home(size) });
  };
  useEffect(() => { if (opened.current && !touched.current) openSheet(); }, [sheet.width, sheet.height]);
  // 3.85: the frame changing size (the rail hidden, shown or dragged, the window resized) keeps the zoom and the place under
  // its unchanged edge as last drawn, before the next paint.
  const drawn = useRef<{ pose: AsidePose; size: { width: number; height: number; left: number } }>(undefined);
  useFrame(() => { const { framing, sideOffset } = read(), { width, height, left } = host.current.size; drawn.current = { pose: { framing, sideOffset }, size: { width, height, left } }; });
  useLayoutEffect(() => {
    const kept = drawn.current && framedOnResize(drawn.current.pose, drawn.current.size, size);
    if (kept !== undefined) onPose({ turn: turn.current, ...kept });
  }, [size.width, size.height, size.left]);
  // 3.66: a stop at the whole map the guide aimed at the last map's sheet is aimed again at the sheet that replaced it.
  useEffect(() => { if (touched.current && guide.current!.reframe()) guideFrameAt.current = performance.now(); }, [sheet.width, sheet.height]);
  // 3.40: the sheet follows the right-hand panel into the free width, and back.
  const besideAside = useRef<ReturnType<typeof createGlobeAside>>(undefined);
  besideAside.current ??= createGlobeAside(() => host.current.opening, { fit: false });
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
    const globe = posed(), grabbed = sheetUnder(eye, globe, turn.current, from, viewport, extent);
    const now = grabbed && sheetUnder(eye, globe, turn.current, { x: from.x + drag.x, y: from.y + drag.y }, viewport, extent);
    return grabbed !== undefined && now !== undefined ? sheetPanUnder(turn.current, grabbed, now, extent)
      : sheetPan(turn.current, drag, sheetEyeZoom(eye, viewport), extent, tilt.current, heading.current);
  };
  const goHome = useRef<() => void>(undefined);
  goHome.current = () => {
    const turn = sheetOpening(sheet, size).turn;
    // The compass and Home spin the sheet back to its starting heading, the short way round, and tilt it to the top resting
    // view, as the view eases home (ADR-1060 D3, ADR-1062 D2).
    const back = sheetHome(spinning.current.to);
    spinTo(back.heading, 0.6);
    tiltTo(back.tilt, 0.6);
    touched.current = false;
    if (!guide.current!.home({ turn, ...besideAside.current!.home(size) })) return;
    guideFrameAt.current = performance.now();
  };
  // WASD and the arrows pan while held, Q and E spin it a quarter turn, R and F tilt it a step (ADR-1060 D1, D2,
  // ADR-1062 D2); T is the page's.
  const keyPan = useRef({ held: new Set<string>(), frame: 0, at: 0 });
  useEffect(() => {
    const keys = keyPan.current;
    const panning = (): void => {
      const now = performance.now(), seconds = Math.min(0.1, (now - keys.at) / 1000);
      keys.at = now;
      if (keys.held.size === 0) { keys.frame = 0; return; }
      guide.current!.cancel();
      host.current.turnTo(panBy(sheetKeyPan(keys.held, seconds), middleOfView()));
      host.current.invalidate();
      keys.frame = requestAnimationFrame(panning);
    };
    const onKey = (event: KeyboardEvent): void => {
      const key = sheetKey(event);
      if (key === undefined) return;
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

  // OrbitControls runs before this frame.
  useFrame(() => {
    const now = performance.now();
    guide.current!.frame(now - guideFrameAt.current);
    guideFrameAt.current = now;
    // Nothing on the sheet is round the back; a failing island past the window's edge is marked at that edge (3.11).
    const drawn = (at: Vector3) => { at.project(camera); return { left: (at.x + 1) * size.width / 2, top: (1 - at.y) * size.height / 2 }; };
    const hidden: ScreenMarker[] = !showFailures ? [] : sheetMarkers(islands, island => drawn(scene.getObjectByName(`planet:${island.story}`)?.getWorldPosition(new Vector3()) ?? new Vector3()), size, mode);
    // 3.89: and a session's pointer past it, in its colour; the camera moves only on the user's click.
    hidden.push(...sheetPointerMarkers(scene, islands, drawn, size, mode));
    // The compass turns with the sheet, read to a tenth of a degree.
    const reading = Math.round(compassNorth(heading.current, seesUnderside(tilt.current)) * 1800 / Math.PI);
    if (reading !== compass.current.reading) { compass.current.reading = reading; compass.current.follow?.(reading); }
    const next = markersApart(hidden.map(marker => {
      const spot = markerSpot(marker, size);
      return { story: marker.story, turn: marker.turn, left: Math.round(spot.left), top: Math.round(spot.top), ...(marker.pointer === undefined ? {} : { pointer: marker.pointer, colour: marker.colour }) };
    }), size);
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
    // The button pressed decides what a click picks: in Library, only the notes under the islands' outlines.
    const picking = (): ForestMode => modeNow.current;
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
    // A drag redraws the sheet once a frame, at the latest turn.
    const dragTo = oncePerFrame((next: GlobeTurn): void => { if (!stopped) turnTo(next); });
    const onDown = (event: PointerEvent): void => {
      // A grab stops a key's tilt where it is.
      holdTilt();
      if (event.pointerType === "touch") {
        fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // A second finger ends the first's pan: two fingers twist, slide up and down to tilt, and pinch.
        if (fingers.size > 1) { down = undefined; clearHover(); return; }
      }
      // A plain drag pans; a right-drag or a Ctrl+drag spins and tilts the sheet, so no switch changes what a drag does (ADR-1060 D2, D5, ADR-1062 D2).
      const kind = sheetDrag(event);
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
        // A drag pans, keeping the place grabbed under the pointer, or spins the sheet about its upright axis with its
        // sideways part and tilts it with its up-and-down part (ADR-1060 D2, ADR-1062 D2).
        if (down.spin) spinTiltBy(drag);
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
      // 3.88: a gate is ringed and selects its island with the pair it joins; any other click puts the ring out. A road
      // takes no click, so a click on one picks what lies under it (3.15).
      const clicked = pickClick(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, picking());
      onGate(clicked.gate);
      const hit = clicked.hit;
      if (hit?.kind === "note") onNote(hit.id);
      else onPick(hit?.id, hit?.capability, hit?.gate);
    };
    const onWheel = (event: WheelEvent): void => {
      guide.current!.cancel(); clearHover();
      touched.current = true;
      // A sideways scroll pans east and west; the wheel's zoom is the canvas's own.
      if (event.deltaX !== 0) dragTo(turn.current = panBy({ x: -event.deltaX, y: 0 }, middleOfView()));
    };
    // The right button spins and tilts the sheet, so it opens no menu there.
    const onMenu = (event: MouseEvent): void => { event.preventDefault(); };
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
  }, [camera, gl, scene, onPick, onGate, onNote, turnTo, sheet, spinBy, spinTiltBy]);

  // Pinned to the canvas, not to the sheet's middle: under a side offset (3.40) the pointer's tooltip, the edge markers
  // and the compass would otherwise move twice.
  return <Overlay fullscreen calculatePosition={pinnedToCanvas} zIndexRange={[40, 40]} style={{ pointerEvents: "none" }}>
    {hover !== undefined && <span role="tooltip" className={`knowledge-tooltip${hover.detail === undefined ? "" : " with-detail"}`} style={{ position: "absolute", left: hover.x, top: hover.y }}>
      {hover.detail === undefined ? hover.title : <><strong>{hover.title}</strong><span className="knowledge-tooltip-detail">{hover.detail}</span></>}
    </span>}
    {mode === "forest" && markers.map(marker => marker.pointer !== undefined ? <button key={`pointer:${marker.pointer}`} type="button" className="planet-edge-marker planet-edge-pointer"
      data-pointer={marker.pointer}
      style={{ left: marker.left, top: marker.top, borderColor: marker.colour, color: marker.colour }}
      title={`${titles.get(marker.story)} · a session points your eye here`}
      aria-label={`Show where a session points: ${titles.get(marker.story)}`}
      onClick={() => {
        guide.current!.cancel();
        if (!controls.current!.stop({ target: { kind: "story", story: marker.story } })) turnTo(marker.turn);
      }}>◎</button> : <button key={marker.story} type="button" className="planet-edge-marker"
      data-failing-story={marker.story}
      style={{ left: marker.left, top: marker.top }}
      title={`${titles.get(marker.story)} · unhealthy (storytree verified)`}
      aria-label={`Show unhealthy story: ${titles.get(marker.story)}`}
      onClick={() => {
        guide.current!.cancel();
        // The guide's stop pans the island into view at the zoom the user chose.
        if (!controls.current!.stop({ target: { kind: "story", story: marker.story } })) turnTo(marker.turn);
      }}>!</button>)}
    <SheetCompass compass={compass.current} aside={aside} onHome={() => goHome.current!()} />
  </Overlay>;
}

/** ADR-1060 D3: the sheet's compass, its needle pointing to the starting north on the window; a click spins and pans it home. */
function SheetCompass({ compass, aside, onHome }: { compass: { reading: number; follow?: ((reading: number) => void) | undefined }; aside: number; onHome: () => void }) {
  const [reading, setReading] = useState(compass.reading);
  useLayoutEffect(() => {
    compass.follow = setReading;
    setReading(compass.reading);
    return () => { compass.follow = undefined; };
  }, [compass]);
  const north = reading * Math.PI / 1800;
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
