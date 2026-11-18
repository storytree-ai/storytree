// Capability 3 · Story node render
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Group, Quaternion, Vector3, type Camera, type Object3D } from "three";
import { claimTints, replayWisps, selectionLanes, shownPointers, type ClaimTint, type PointerTint, type FacingIsland, type ForestScene, type GlobeTurn, type Island, type SessionWisp } from "@storytree/forest";
import type { Descriptor3D } from "@storytree/forest-world";
import { islandNormal, onIslandSurface, Overlay, PlanetWorldCanvas, PLATE_CLEARANCE, SHEET_RADIUS, sheetEyeZoom, UnderTheGlass, usePlanetGrowth, type IslandDock, type LanesNotice, type PlanetGrowth, type SheetExtent } from "@storytree/forest-world/planet";
import type { CodePlaces } from "@storytree/knowledge-core";
import { KnowledgeGlobePoints, useCodeLighting, type CodeLighting, type CoreUnderSheet, type KnowledgeCore } from "@storytree/knowledge-core/view";
import { SessionIslandEmphasis } from "./session-emphasis.js";
import { IslandOpenWork, openWorkMarks, ringedCapabilities, rungLinks, sizeOpenWork } from "./open-work.js";
import { lightTerritories, territoryLand } from "./territory-land.js";
import { islandRoadMarks, landFill, ringGate, type GatePick } from "./island-roads.js";
import { capabilityPlates, drawnNames, nameplateAt } from "./nameplates.js";
import { islandRoadsWhenRouted, knownIslandRoads, pageIslandRouter, roadsVersion, subscribeRoads, type IslandRoads, type RoadsAsk } from "../territories/island-roads.js";
import { islandRelief, type IslandRelief } from "../territories/island-relief.js";
import { islandReliefMarks } from "./island-relief.js";
import { ClaimMarks } from "./claim-flag.js";
import { islandLayoutSteps, type Link } from "../territories/link-layout.js";
import { useLayingOut } from "./layout-progress.js";
import { awaitingLayout, keptVersion, pageTerritorySearcher, searchIsland, subscribeKept } from "../territories/kept-layout.js";
import { IslandPins, NameplateCrowd, Nameplates, reducedMotion, SelectionRing, StorePins } from "./island-overlays.js";
import { focusRotation, globeHover, isGlobeDrag, markersApart, markerSpot, movingSpots, MOVE_SECONDS, oncePerFrame, gateAfterSelection, pickClick, ignoresClick, feedbackPick, answerFeedbackPicks, pickGlobe, type ForestMode, type PickedGate } from "./planet-navigation.js";
import { claimsInside, claimsOn, gatePosts, pointersOn } from "./planet-update.js";
import { besideOpen, memberTops, OpenedTopMarks, pickedOnTops, rolledToTops } from "./top-marks.js";
import { createGlobeGuide, type GlobePose, type PlacedGlobeControls } from "./globe-guide.js";
import { createGlobeAside, framedOnResize, islandCanvasX, type AsidePose } from "./globe-aside.js";
import { compassNorth, libraryTilt, opensBare, seesUnderside, sheetDrag, sheetHome, sheetKey, sheetKeyPan, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetPointerMarkers, sheetPanUnder, sheetSpin, sheetSpinTilt, sheetTilted, sheetTiltBy, sheetTwist, sheetUnder, SHEET_OPENING_TILT, TILT_PER_PIXEL, TILT_STEP, withDocks } from "./sheet-navigation.js";
import { growLand, IslandOpening, presentDetail, shownSurfaces as surfacesFor, TerritoryDrawOn, type GlobeSurfaces } from "./globe-surfaces.js";
import { DetailStore } from "./zoom-detail.js";
import { useBuiltInSteps } from "./build-turns.js";
import type { TerritoryMap } from "../territories/territories.js";
import { keepPartSeeds, keptPartSeeds, nestedLayoutSteps, partCrossings, regionOf } from "../territories/nested-territories.js";
import type { SceneParts } from "../render/scene-parts.js";
import type { PinReading } from "@storytree/map/pins";
import { disposeOpened, dockedClashes, hiddenByOpening, hideForOpening, openedAt, openedMarks, openedOn, OpenedStore, opensAt, reachPlates, readsUnder, rollUp } from "./opened-capability.js";

export type PlanetViewProps = {
  onControls?: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  onPainted?: ((scene: ForestScene) => void) | undefined;
  surfaces?: Partial<GlobeSurfaces> | undefined;
  sideOffset?: number | undefined;
  aside?: number | undefined;
  mode?: ForestMode;
  library?: boolean;
  onLibraryHung?: (() => void) | undefined;
  framing?: number | undefined;
  frame?: ForestScene | undefined;
  easeMoves?: boolean | undefined;
  growth?: PlanetGrowth | undefined;
  recordedSessions?: readonly { at: string; wisps: readonly SessionWisp[] }[] | undefined;
  core: KnowledgeCore;
  scene: ForestScene;
  places: ReadonlyMap<string, number>;
  wisps: readonly SessionWisp[];
  selected: string | undefined;
  selectedCapability?: string | undefined;
  highlighted?: readonly string[] | undefined;
  circled?: readonly string[] | undefined;
  circledContracts?: readonly string[] | undefined;
  onPick: (story: string | undefined, capability?: string, gate?: readonly [string, string]) => void;
  onNote: (note: string) => void;
  onStore: (address: string) => void;
  onLanesNotice?: ((notice: LanesNotice | undefined) => void) | undefined;
};

export function PlanetView({ core, scene, places, wisps: live, selected, selectedCapability, highlighted, circled: circledList, circledContracts, onPick, onNote, onStore, mode = "forest", framing, sideOffset, aside = 0, surfaces, onControls, onPainted, library = true, onLibraryHung, frame, easeMoves = false, growth, recordedSessions, onLanesNotice }: PlanetViewProps) {
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
  const moving = useMovingSpots(layout.spots, easeMoves), travelling = moving !== layout.spots;
  const roadless = useMemo(() => ({ ...layout.scene, links: [] }), [layout.scene]);
  const globe = useRef<Group>(null);
  const turned = useRef<{ rotation: Quaternion; centre?: [number, number, number] | undefined }>({ rotation: new Quaternion() });
  const onRotate = useCallback((next: Quaternion, at?: [number, number, number]) => {
    turned.current.rotation.copy(next);
    turned.current.centre = at;
    globe.current?.quaternion.copy(next);
    globe.current?.position.set(...(at ?? [0, 0, 0]));
  }, []);
  const [replayed, setReplayed] = useState<readonly SessionWisp[]>();
  const wisps = growth !== undefined && recordedSessions !== undefined ? replayed ?? [] : live;
  const tops = useMemo(() => memberTops(scene.parts ?? []), [scene.parts]);
  const claimed = useMemo(() => rolledToTops(claimTints(wisps), tops), [wisps, tops]);
  const capabilities = useKept(useMemo(() => scene.islands.flatMap(({ land }) => land === undefined ? [] : land.territories.flatMap(({ capability }) => capability === undefined ? [] : [capability])), [scene]), JSON.stringify);
  const codePlaces = useMemo((): CodePlaces => ({ capabilities: new Set(capabilities) }), [capabilities]);
  const lighting = useCodeLighting(core, codePlaces);
  const lanes = useKept(useMemo(() => selectionLanes(scene, selected), [scene, selected]), JSON.stringify);
  const [gate, setGate] = useState<PickedGate>();
  useEffect(() => { setGate(picked => gateAfterSelection(picked, selected)); }, [selected]);
  const [seenDocks, setSeenDocks] = useState<ReadonlyMap<string, readonly IslandDock[]>>(NO_DOCKS_SEEN);
  const onDocks = useCallback((story: string, docks: readonly IslandDock[] | undefined) => setSeenDocks(seen => withDocks(seen, story, docks)), []);
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const under = useMemo(() => seenDocks.size === 0 ? layout.under : sheetLayout(scene, places, frame, seenDocks).under,
    [layout, seenDocks, scene, places, frame, kept]);
  const detail = useMemo(() => new DetailStore(), []);
  const opened = useMemo(() => new OpenedStore(), []);
  const partsOf = useMemo(() => {
    const by = new Map<string, SceneParts[]>();
    for (const parts of scene.parts ?? []) by.set(parts.story, [...by.get(parts.story) ?? [], parts]);
    return by;
  }, [scene.parts]);
  const underSheet = useMemo((): CoreUnderSheet => ({ ...under, selected }), [under, selected]);
  const links = useKept(layout.scene.links ?? NO_LINKS, JSON.stringify);
  const circled = useKept(useMemo(() => rolledToTops(ringedCapabilities(circledList, circledContracts, scene.contracts ?? []), tops), [circledList, circledContracts, scene.contracts, tops]),
    (ringed) => ringed === undefined ? "none" : JSON.stringify([...ringed].sort()));
  const rung = useKept(useMemo(() => rungLinks(scene.edges ?? [], circledContracts), [scene.edges, circledContracts]), (links) => links === undefined ? "none" : JSON.stringify([...links]));
  const pointed = useMemo(() => shownPointers(wisps, circled), [wisps, circled]);
  const pins = useKept(scene.pins ?? NO_PINS, JSON.stringify);
  const overlays = useCallback((island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[], docks: readonly IslandDock[] | undefined) => {
    const laidBy = docks;
    const local = { ...island, x: 0, z: 0 };
    const emphasis = shownSurfaces.sessionTints && highlighted?.length ? (highlighted.includes(island.story) ? "held" : "dimmed") : undefined;
    return <>
      {island.land !== undefined && layout.spots.has(island.story) && <Territories story={island.story} land={island.land} coast={coast} links={links} docks={laidBy} claimed={claimed} pointed={pointed} radius={layout.radius}
        lighting={lighting} surfaces={shownSurfaces} gate={gate?.story === island.story ? gate.pick : undefined}
        picked={island.story === selected ? pickedOnTops(selectedCapability, tops) : undefined} selection={island.story === selected ? selectedCapability : undefined} circled={circled} rung={rung} detail={detail} opened={opened} parts={partsOf.get(island.story)} />}
      <SessionIslandEmphasis emphasis={emphasis} />
      {emphasis === "held" && <SelectionRing island={local} descriptors={descriptors} onGlobe emphasis />}
      {shownSurfaces.nameplates && <Nameplates island={island} spot={layout.spots.get(island.story)!} coast={coast} links={links} docks={laidBy} radius={layout.radius} selected={selected} dimmed={emphasis === "dimmed"} claimed={claimed} detail={detail} opened={opened} />}
      {shownSurfaces.nameplates && pins.length > 0 && <IslandPins island={island} coast={coast} links={links} docks={laidBy} radius={layout.radius} pins={pins} detail={detail} opened={opened} />}
      <SelectionRing island={island.story === selected ? local : undefined} descriptors={descriptors} onGlobe />
      <DocksSeen story={island.story} docks={docks} onDocks={onDocks} />
    </>;
  }, [wisps, claimed, pointed, selected, highlighted, circled, rung, layout.spots, layout.radius, lighting, shownSurfaces, links, gate, selectedCapability, tops, detail, onDocks, opened, partsOf, pins]);
  const storeChildren = useCallback((address: string, at: readonly [number, number, number]) => shownSurfaces.nameplates && <StorePins address={address} at={at} pins={pins} detail={detail} />,
    [pins, detail, shownSurfaces.nameplates]);
  const titles = useMemo(() => new Map(scene.islands.map(i => [i.story, i.title])), [scene]);
  const floor = useCallback((size: { width: number; height: number }) => sheetOpening(layout.extent, size).framing, [layout.extent]);
  const inside = useMemo(() => library && <UnderTheGlass clear={outlines}><GrowingCore core={core} places={codePlaces} sheet={underSheet} growing={growth !== undefined} onHung={onLibraryHung} /></UnderTheGlass>,
    [library, outlines, core, codePlaces, underSheet, growth, onLibraryHung]);
  const storeSpots = useMemo(() => new Map(layout.stores.map(store => [store.address, store.spot])), [layout.stores]);
  return <PlanetWorldCanvas scene={travelling ? roadless : layout.scene} spots={moving} storeSpots={storeSpots} storeChildren={storeChildren} radius={layout.radius}
    surface surfaces={shownSurfaces} framing={cameraFraming} floor={floor} sideOffset={cameraOffset} sheet={layout.extent} hollow={outlines}
    globe={globe} offset={turned.current.centre} inside={inside}
    rotation={turned.current.rotation.toArray()} plateChildren={overlays} lanes={lanes} growth={growth} onLanesNotice={onLanesNotice}>
    <Navigation islands={layout.islands} radius={layout.radius} titles={titles}
      rotation={turned.current.rotation} onRotate={onRotate} onPose={setPose} onControls={onControls} onPick={onPick} onGate={setGate} onNote={onNote} onStore={onStore} mode={mode} sheet={layout.extent} arcSelected={circledList !== undefined}
      sideOffset={sideOffset ?? 0} aside={aside} selected={selected}
      showFailures={shownSurfaces.grounds || shownSurfaces.territories !== false || shownSurfaces.nameplates || shownSurfaces.roads} />
    <NameplateCrowd selected={selected} aside={aside} />
    <DetailFeed detail={detail} opened={opened} mode={mode} aside={aside} />
    <CompiledAtLoad under={underSheet} />
    {onPainted !== undefined && <PaintedReport scene={scene} onPainted={onPainted} />}
    {growth !== undefined && recordedSessions !== undefined && <ReplaySessions recorded={recordedSessions} onWisps={setReplayed} />}
  </PlanetWorldCanvas>;
}

function DocksSeen({ story, docks: given, onDocks }: { story: string; docks: readonly IslandDock[] | undefined; onDocks: (story: string, docks: readonly IslandDock[] | undefined) => void }) {
  const docks = useKept(given, (docks) => JSON.stringify(docks ?? null));
  useEffect(() => { onDocks(story, docks); }, [story, docks, onDocks]);
  return null;
}

function DetailFeed({ detail, opened, mode, aside }: { detail: DetailStore; opened: OpenedStore; mode: ForestMode; aside: number }) {
  const last = useRef({ eye: "", at: -Infinity });
  useFrame(({ camera, size, scene, clock }) => {
    detail.zoom(sheetEyeZoom(camera, size));
    if (!opensAt(detail.get(), mode)) { opened.open(undefined); return; }
    const eye = camera.matrixWorld.elements.join(), now = clock.getElapsedTime();
    if (!readsUnder(now, eye, last.current)) return;
    last.current = { eye, at: now };
    const box = { left: 0, top: 0, width: size.width, height: size.height };
    opened.open(openedAt(detail.get(), pickGlobe(scene, camera, box, { x: Math.max(0, size.width - aside) / 2, y: size.height / 2 }, mode), mode));
  });
  return null;
}

function CompiledAtLoad({ under }: { under: CoreUnderSheet }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const frame = requestAnimationFrame(() => gl.compile(scene, camera));
    return () => cancelAnimationFrame(frame);
  }, [gl, scene, camera, under]);
  return null;
}

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

function GrowingCore({ growing, ...props }: Omit<Parameters<typeof KnowledgeGlobePoints>[0], "growth"> & { growing: boolean }) {
  const growth = usePlanetGrowth();
  return <KnowledgeGlobePoints {...props} growth={growing ? growth : undefined} />;
}

function useKept<T>(value: T, keyOf: (value: T) => string): T {
  const kept = useRef<{ key: string; value: T }>(undefined);
  const key = keyOf(value);
  if (kept.current?.key !== key) kept.current = { key, value };
  return kept.current.value;
}

const NO_LINKS: readonly Link[] = [];
const NO_PINS: readonly PinReading[] = [];
const NO_DOCKS_SEEN: ReadonlyMap<string, readonly IslandDock[]> = new Map();

const TERRITORY_LIFT = 0.05;
const ROAD_LIFT = 0.08;
const OPEN_WORK_LIFT = 0.1;

type TerritoriesProps = {
  story: string;
  detail: DetailStore;
  opened: OpenedStore;
  parts?: readonly SceneParts[] | undefined;
  circled: ReadonlySet<string> | undefined;
  rung?: ReadonlySet<string> | undefined;
  gate?: GatePick | undefined;
  picked?: string | undefined;
  selection?: string | undefined;
  land: NonNullable<Island["land"]>;
  coast: readonly (readonly { x: number; z: number }[])[];
  links: readonly Link[];
  docks: readonly IslandDock[] | undefined;
  claimed: ReadonlyMap<string, ClaimTint>;
  pointed: ReadonlyMap<string, PointerTint>;
  radius: number;
  lighting: CodeLighting;
  surfaces: GlobeSurfaces;
};

function Territories(props: TerritoriesProps) {
  const { story, land: given, coast: givenCoast, links, docks: givenDocks, claimed, pointed: allPointed } = props;
  const { clock } = useThree();
  const land = useKept(given, JSON.stringify), coast = useKept(givenCoast, JSON.stringify), docks = useKept(givenDocks, (docks) => JSON.stringify(docks ?? null));
  const parts = useKept(props.parts, (parts) => JSON.stringify(parts ?? null));
  const tints = useKept(claimed, tints => claimsOn(tints, land));
  const inside = useKept(claimed, tints => claimsInside(tints, parts ?? []));
  const pointed = useKept(useMemo(() => pointersOn(allPointed, land), [allPointed, land]), (here) => JSON.stringify([...here]));
  const [joined] = useState(() => sinceFirstIsland(clock));
  const kept = useSyncExternalStore(subscribeKept, keptVersion);
  const searcher = useMemo(() => pageTerritorySearcher(), []);
  const awaiting = awaitingLayout(story, land.territories, searcher);
  const [waited, setWaited] = useState(awaiting);
  useEffect(() => { if (awaiting) setWaited(true); }, [awaiting]);
  const asked = useMemo(() => ({}), [story, land, coast, links, docks, kept, awaiting]);
  const built = useBuiltInSteps(function* () { return { asked, map: awaiting ? undefined : yield* islandLayoutSteps(story, land.territories, coast, links, docks) }; }, [asked]);
  const map = built?.map;
  useLayingOut(story, docks !== undefined && built?.asked === asked && map !== undefined);
  useEffect(() => { if (docks !== undefined) searchIsland(story, { shares: land.territories, coast, links, docks }, searcher); }, [story, land, coast, links, docks, searcher]);
  return map === undefined || awaiting ? null : <IslandLand {...props} land={land} coast={coast} docks={docks} parts={parts} tints={tints} inside={inside} pointed={pointed} map={map} joined={waited ? Infinity : joined} />;
}

const firstIsland = new WeakMap<object, number>();

function sinceFirstIsland(clock: { getElapsedTime(): number }): number {
  const now = clock.getElapsedTime();
  if (!firstIsland.has(clock)) firstIsland.set(clock, now);
  return now - firstIsland.get(clock)!;
}

type IslandLandProps = Omit<TerritoriesProps, "claimed"> & { tints: ReadonlyMap<string, ClaimTint>; inside: ReadonlyMap<string, ClaimTint>; map: TerritoryMap; joined: number };

function IslandLand(props: IslandLandProps) {
  const { story, map, coast, links, docks, tints, radius, parts } = props;
  const routedVersion = useSyncExternalStore(subscribeRoads, roadsVersion);
  const ask = useMemo((): RoadsAsk | undefined => docks === undefined ? undefined : { story, map, links, docks, names: capabilityPlates(map) }, [story, map, links, docks]);
  const roads = useMemo(() => ask === undefined ? undefined : knownIslandRoads(ask), [ask, routedVersion]);
  useEffect(() => {
    if (ask === undefined || roads !== undefined) return;
    const overtaken = new AbortController();
    islandRoadsWhenRouted(ask, pageIslandRouter(), overtaken.signal);
    return () => overtaken.abort();
  }, [ask, roads]);
  const asked = useMemo(() => ({}), [map, coast, tints, radius, roads, parts]);
  const built = useBuiltInSteps(function* (): Generator<void, { asked: object; drawn: DrawnLand }, void> {
    const relief = roads === undefined ? undefined : islandRelief(map, roads);
    if (relief !== undefined) yield;
    const onLand = onIslandSurface(radius, TERRITORY_LIFT + (relief?.height ?? 0));
    const group = territoryLand(map, onLand, coast, tints, roads);
    if (roads !== undefined && relief !== undefined) {
      let built = false;
      try {
        yield;
        const fill = landFill(map, group);
        group.add(islandReliefMarks(relief, onIslandSurface(radius, TERRITORY_LIFT), fill));
        yield;
        const marks = islandRoadMarks(roads, onIslandSurface(radius, ROAD_LIFT), fill, relief);
        for (const { capability, lanes } of parts ?? []) rollUp(marks, capability, partCrossings(map, roads, capability, lanes, docks ?? []));
        group.add(marks);
        built = true;
      } finally { if (!built) disposeMarks(group); }
    }
    group.traverse((mark) => { if (mark !== group) { mark.updateMatrix(); mark.matrixAutoUpdate = false; } });
    return { asked, drawn: { group, map, roads, relief, onLand } };
  }, [asked]);
  const drawn = built?.drawn;
  useLayingOut(story, built?.asked === asked);
  return drawn === undefined ? null : <DrawnIsland {...props} drawn={drawn} />;
}

type OpenedLand = DrawnLand & { roads: IslandRoads; relief: IslandRelief };

function OpenedCapability({ story, parts, drawn, docks, radius, opened, inside, circled, selection, surfaces }: { story: string; parts: SceneParts; drawn: OpenedLand; docks: readonly IslandDock[] | undefined; radius: number; opened: OpenedStore }
  & Pick<IslandLandProps, "inside" | "circled" | "selection" | "surfaces">) {
  const { invalidate, gl, camera, scene, clock, size } = useThree();
  const { capability } = parts;
  const at = drawn.map.territories.findIndex((t) => t.capability === capability);
  const region = useMemo(() => at < 0 ? [] : regionOf(drawn.map, at), [drawn.map, at]);
  const crossings = useMemo(() => partCrossings(drawn.map, drawn.roads, capability, parts.lanes, docks ?? []), [drawn, capability, parts, docks]);
  const asked = useMemo(() => ({}), [region, parts, crossings]);
  const built = useBuiltInSteps(function* () {
    return { asked, layout: yield* nestedLayoutSteps(region, parts.shares, parts.links, crossings, keptPartSeeds(story, capability)) };
  }, [asked]);
  const layout = built?.asked === asked ? built.layout : undefined;
  const clashes = useMemo(() => layout === undefined ? {} : dockedClashes(parts.clashes ?? {}, crossings, layout), [layout, parts, crossings]);
  useEffect(() => {
    if (layout !== undefined && layout.seeds !== undefined) keepPartSeeds(story, capability, layout.seeds);
  }, [layout, story, capability]);
  const ask = useMemo((): RoadsAsk | undefined => layout === undefined ? undefined : {
    map: layout.map,
    links: [...parts.links, ...crossings.flatMap((crossing) => crossing.links.map((key) => { const [from, to] = key.split("->") as [string, string]; return { from, to }; }))],
    docks: crossings.map((crossing) => ({ local: { x: crossing.local.x - layout.centre.x, z: crossing.local.z - layout.centre.z }, links: crossing.links })),
    names: capabilityPlates(layout.map),
  }, [layout, parts, crossings]);
  const routedVersion = useSyncExternalStore(subscribeRoads, roadsVersion);
  const inner = useMemo(() => ask === undefined ? undefined : knownIslandRoads(ask), [ask, routedVersion]);
  useEffect(() => {
    if (ask === undefined || inner !== undefined) return;
    const overtaken = new AbortController();
    islandRoadsWhenRouted(ask, pageIslandRouter(), overtaken.signal);
    return () => overtaken.abort();
  }, [ask, inner]);
  useEffect(() => {
    if (layout === undefined) return;
    const names = new Map(parts.shares.map((share) => [share.capability, share.title]));
    opened.name(story, capability, [
      ...capabilityPlates(layout.map).map((plate) => ({ part: plate.capability, title: names.get(plate.capability) ?? plate.title, x: plate.x + layout.centre.x, z: plate.z + layout.centre.z })),
      ...(inner === undefined ? [] : reachPlates(layout, inner, clashes)),
    ]);
  }, [layout, inner, clashes, story, capability, parts, opened]);
  const marks = useMemo(() => {
    if (layout === undefined) return undefined;
    const kept = inner === undefined ? [] : hiddenByOpening(drawn.map, drawn.roads, capability).kept;
    const relief = drawn.relief, onGround = onIslandSurface(radius, ROAD_LIFT);
    const cells = drawn.map.cells.filter((cell) => cell.territory === at).map((cell) => cell.polygon);
    const words = new Map(parts.shares.flatMap(({ capability: part, status, parked, title, description }) => status === undefined ? [] : [[part, { status, ...(parked === undefined ? {} : { parked }), title, ...(description === undefined ? {} : { description }) }] as const]));
    return openedMarks(capability, layout, inner, kept, cells, drawn.map.coast, (p) => { const v = onGround(p); v.y += relief.raise(p); return v; }, landFill(drawn.map, drawn.group), words, clashes);
  }, [layout, inner, drawn, capability, at, radius, parts, clashes]);
  useLayoutEffect(() => {
    if (marks === undefined) return;
    drawn.group.add(marks);
    const roads = drawn.group.getObjectByName("island-roads");
    const shown = inner === undefined || roads === undefined ? () => {} : hideForOpening(roads, drawn.map, drawn.roads, capability);
    const frame = requestAnimationFrame(() => gl.compile(marks, camera, scene));
    invalidate();
    return () => { cancelAnimationFrame(frame); shown(); marks.removeFromParent(); disposeOpened(marks); invalidate(); };
  }, [marks, inner, drawn, capability, gl, camera, scene, invalidate]);
  const top = useMemo(() => new OpenedTopMarks(), []);
  useEffect(() => () => top.dispose(), [top]);
  const first = useRef(true);
  useEffect(() => {
    if (layout === undefined) return;
    top.setLand(capability, layout, drawn.onLand, onIslandSurface(radius, OPEN_WORK_LIFT + drawn.relief.height), islandNormal(radius));
    invalidate();
  }, [top, capability, layout, drawn, radius, invalidate]);
  useEffect(() => {
    if (layout === undefined) return;
    top.claims(inside, clock.getElapsedTime(), { standing: first.current, reduced: reducedMotion() });
    first.current = false;
    invalidate();
  }, [top, layout, inside, clock, invalidate]);
  useLayoutEffect(() => {
    if (layout === undefined) return;
    const fresh = top.rings(circled, inner, selection, sheetEyeZoom(camera, size));
    invalidate();
    if (fresh.length === 0) return;
    const frame = requestAnimationFrame(() => { for (const layer of fresh) gl.compile(layer, camera, scene); });
    return () => cancelAnimationFrame(frame);
  }, [top, layout, circled, inner, selection, gl, camera, scene, invalidate]);
  useFrame(() => {
    if (top.frame(clock.getElapsedTime(), { zoom: sheetEyeZoom(camera, size), eye: camera.quaternion, reduced: reducedMotion() })) invalidate();
  });
  top.visible(surfaces.sessionTints, surfaces.territories !== false);
  return <primitive object={top.root} />;
}

function disposeMarks(group: Group): void {
  group.traverse((object) => {
    const mark = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mark.geometry?.dispose();
    mark.material?.dispose();
  });
}

type DrawnLand = { group: Group; map: TerritoryMap; roads: IslandRoads | undefined; relief: IslandRelief | undefined; onLand: ReturnType<typeof onIslandSurface> };

function DrawnIsland({ story, drawn, land, coast, docks, tints: allTints, inside, pointed, radius, lighting, surfaces, gate, picked: allPicked, selection, circled: allCircled, rung, detail, joined, opened, parts }: IslandLandProps & { drawn: DrawnLand }) {
  const { invalidate, clock, camera, size, gl, scene } = useThree();
  const relief = drawn.relief, onLand = drawn.onLand;
  const level = useSyncExternalStore(detail.subscribe, detail.get);
  const open = useSyncExternalStore(opened.subscribe, opened.get);
  const openParts = openedOn(open, story, level, surfaces.territories !== false, drawn.roads !== undefined && drawn.relief !== undefined, parts);
  const shown = openParts?.capability;
  const tints = useMemo(() => besideOpen(allTints, shown), [allTints, shown]);
  const circled = useMemo(() => besideOpen(allCircled, shown), [allCircled, shown]);
  const picked = besideOpen(allPicked, shown);
  const openWork = useMemo(() => new IslandOpenWork(), []);
  useEffect(() => () => openWork.dispose(), [openWork]);
  const onOpenWork = useMemo(() => onIslandSurface(radius, OPEN_WORK_LIFT + (relief?.height ?? 0)), [radius, relief]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => gl.compile(drawn.group, camera, scene));
    return () => cancelAnimationFrame(frame);
  }, [gl, camera, scene, drawn]);
  useLayoutEffect(() => {
    const fresh = openWork.show(openWorkMarks(drawn.map, circled, drawn.roads, picked, rung), onOpenWork, sheetEyeZoom(camera, size));
    invalidate();
    if (fresh.length === 0) return;
    const frame = requestAnimationFrame(() => { for (const layer of fresh) gl.compile(layer, camera, scene); });
    return () => cancelAnimationFrame(frame);
  }, [openWork, drawn, circled, picked, rung, onOpenWork, gl, camera, scene, invalidate]);
  const gateRing = useMemo(() => drawn.group.getObjectByName("gate-ring") as Group | undefined, [drawn]);
  useLayoutEffect(() => {
    if (drawn.roads === undefined) return;
    ringGate(drawn.group, drawn.roads, gate, sheetEyeZoom(camera, size) * (drawn.group.matrixWorld.getMaxScaleOnAxis() || 1));
    invalidate();
  }, [drawn, gate, invalidate]);
  const marks = useMemo(() => new ClaimMarks(), []);
  useEffect(() => () => marks.dispose(), [marks]);
  const first = useRef(true);
  useEffect(() => {
    marks.setLand(drawn.map, onLand, islandNormal(radius), land.files.length === 0, coast, drawn.roads === undefined ? undefined : gatePosts(drawn.roads.gates));
    invalidate();
  }, [marks, drawn, land.files.length, coast, radius, onLand, invalidate]);
  useEffect(() => {
    marks.claims(tints, clock.getElapsedTime(), { standing: first.current && joined < 1, reduced: reducedMotion() });
    first.current = false;
    invalidate();
  }, [marks, tints, clock, invalidate]);
  useEffect(() => {
    marks.pointers(pointed);
    invalidate();
  }, [marks, pointed, invalidate]);
  useFrame(() => {
    const zoom = sheetEyeZoom(camera, size);
    if (marks.frame(clock.getElapsedTime(), { zoom, eye: camera.quaternion, reduced: reducedMotion() })) invalidate();
    if (openWork.size(zoom * (openWork.root.matrixWorld.getMaxScaleOnAxis() || 1))) invalidate();
    if (gateRing !== undefined && gateRing.children.length > 0 && sizeOpenWork(gateRing, zoom * (gateRing.matrixWorld.getMaxScaleOnAxis() || 1))) invalidate();
  });
  const growth = usePlanetGrowth();
  const whole = useRef(false);
  const grow = useCallback(() => growLand(drawn.group, { capability: id => growth.capability(id) }), [drawn, growth]);
  const drawOn = useMemo(() => new TerritoryDrawOn(), []);
  const opening = useMemo(() => new IslandOpening(), []);
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
  useLayoutEffect(() => {
    presentDetail(drawn.group, level);
    invalidate();
  }, [drawn, level, surfaces, invalidate]);
  useEffect(() => () => disposeMarks(drawn.group), [drawn]);
  return <><primitive object={drawn.group} />{openParts !== undefined
    && <OpenedCapability story={story} parts={openParts} drawn={drawn as OpenedLand} docks={docks} radius={radius} opened={opened} inside={inside} circled={allCircled} selection={selection} surfaces={surfaces} />}<primitive object={marks.root} />{surfaces.territories !== false && <primitive object={openWork.root} />}</>;
}


type ScreenMarker = { story: string; turn: GlobeTurn; left: number; top: number; pointer?: string; colour?: string };

export const NAVIGATION_SEAM = "__storytreeCaptureNavigation";
export type CapturedNavigation = { rotation: Quaternion; onRotate: (rotation: Quaternion, offset?: [number, number, number]) => void };

function Navigation({ islands, radius, titles, rotation, onRotate, onPose, onControls, onPick, onGate, onNote, onStore, mode, showFailures, sideOffset, aside, selected, sheet, arcSelected = false }: {
  arcSelected?: boolean;
  onGate: (gate: PickedGate | undefined) => void;
  onPose: (pose: GlobePose) => void;
  sheet: SheetExtent;
  aside: number;
  selected: string | undefined;
  sideOffset: number;
  onControls: ((controls: PlacedGlobeControls | undefined) => void) | undefined;
  showFailures: boolean;
  mode: ForestMode;
  radius: number;
  islands: readonly FacingIsland[];
  titles: ReadonlyMap<string, string>;
  rotation: Quaternion;
  onRotate: (rotation: Quaternion, offset?: [number, number, number]) => void;
  onPick: (story: string | undefined, capability?: string, gate?: readonly [string, string]) => void;
  onNote: (note: string) => void;
  onStore: (address: string) => void;
}) {
  const { camera, gl, scene, size, invalidate } = useThree();
  const rotate = useCallback((next: Quaternion, at?: [number, number, number]) => { onRotate(next, at); invalidate(); }, [onRotate, invalidate]);
  (globalThis as { [NAVIGATION_SEAM]?: (navigation: CapturedNavigation) => void })[NAVIGATION_SEAM]?.({ rotation, onRotate: rotate });
  const opening = { framing: sheetOpening(sheet, size).framing, sideOffset };
  const [hover, setHover] = useState<{ title: string; detail?: string; x: number; y: number }>();
  const opened = useRef(false);
  const touched = useRef(false);
  const [away, setAway] = useState(false);
  const touch = (moved: boolean): void => { touched.current = moved; setAway(moved); };
  const lastMarkers = useRef("");
  const [markers, setMarkers] = useState<ScreenMarker[]>([]);
  const turn = useRef<GlobeTurn>({ yaw: 0, pitch: 0 });
  const tilt = useRef(SHEET_OPENING_TILT);
  const modeNow = useRef(mode);
  modeNow.current = mode;
  const arcNow = useRef(arcSelected);
  arcNow.current = arcSelected;
  const heading = useRef(0);
  const compass = useRef<{ reading: number; follow?: ((reading: number) => void) | undefined }>({ reading: 0 });
  const turnTo = useCallback((next: GlobeTurn) => {
    turn.current = next;
    const turned = sheetTilted(focusRotation(next, camera.quaternion), camera.quaternion, tilt.current, heading.current);
    rotate(turned.quaternion, turned.position.toArray());
  }, [camera, rotate]);
  const posed = (): Object3D => {
    const group = new Group(), turned = sheetTilted(focusRotation(turn.current, camera.quaternion), camera.quaternion, tilt.current, heading.current);
    group.quaternion.copy(turned.quaternion);
    group.position.copy(turned.position);
    return group;
  };
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
  const lastMode = useRef(mode);
  useEffect(() => {
    if (mode === "library" && lastMode.current !== "library") {
      const to = libraryTilt(tilting.current.to);
      if (to !== tilting.current.to) { if (opened.current) touch(true); tiltTo(to, 0.6); }
    }
    lastMode.current = mode;
  }, [mode]);
  const spinning = useRef({ frame: 0, to: 0 });
  const spinTo = useCallback((to: number, seconds: number) => {
    cancelAnimationFrame(spinning.current.frame);
    spinning.current.to = to;
    touch(true);
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
  const spinTiltBy = useCallback((drag: { x: number; y: number }) => {
    cancelAnimationFrame(spinning.current.frame);
    holdTilt();
    const next = sheetSpinTilt(heading.current, tilt.current, drag);
    spinning.current.to = heading.current = next.heading;
    tilting.current.to = tilt.current = next.tilt;
    touch(true);
  }, []);
  const spinBy = useCallback((clockwise: number) => {
    cancelAnimationFrame(spinning.current.frame);
    spinning.current.to = heading.current = sheetSpin(heading.current, clockwise, seesUnderside(tilt.current));
    touch(true);
  }, []);
  useEffect(() => () => cancelAnimationFrame(spinning.current.frame), []);
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
    opening: framing => sheetOpening(host.current.sheet, host.current.size, framing),
  });
  const controls = useRef<PlacedGlobeControls>(undefined);
  const guideFrameAt = useRef(0);
  const placedAside = useRef(aside);
  if (controls.current === undefined) controls.current = {
    stop: stop => { const started = guide.current!.stop(stop); if (started) { opened.current = true; touch(true); guideFrameAt.current = performance.now(); } return started; },
    position: target => guide.current!.position(target),
    positions: targets => guide.current!.positions(targets),
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
  }, [islands, turnTo, mode]);
  const openSheet = (): void => {
    turnTo(sheetOpening(sheet, size).turn);
    onPose({ turn: turn.current, ...besideAside.current!.home(size) });
  };
  useEffect(() => { if (opened.current && !touched.current) openSheet(); }, [sheet.width, sheet.height]);
  const drawn = useRef<{ pose: AsidePose; size: { width: number; height: number; left: number } }>(undefined);
  useFrame(() => { const { framing, sideOffset } = read(), { width, height, left } = host.current.size; drawn.current = { pose: { framing, sideOffset }, size: { width, height, left } }; });
  useLayoutEffect(() => {
    const kept = drawn.current && framedOnResize(drawn.current.pose, drawn.current.size, size);
    if (kept !== undefined) onPose({ turn: turn.current, ...kept });
  }, [size.width, size.height, size.left]);
  useEffect(() => { if (touched.current && guide.current!.reframe()) guideFrameAt.current = performance.now(); }, [sheet.width, sheet.height]);
  const besideAside = useRef<ReturnType<typeof createGlobeAside>>(undefined);
  besideAside.current ??= createGlobeAside(() => host.current.opening, { fit: false });
  useEffect(() => {
    const moved = besideAside.current!.place(size, aside, guide.current!.heading(), islandCanvasX(scene, camera, selected, size.width));
    placedAside.current = aside;
    if (moved === undefined || !guide.current!.slide(moved.to, moved.glide && !reducedMotion() ? 600 : 0)) return;
    guideFrameAt.current = performance.now();
  }, [aside, size.width, size.height]);
  const middleOfView = (): { x: number; y: number } => {
    const { camera: eye, size: viewport } = host.current, at = eye.position.clone().setLength(SHEET_RADIUS + PLATE_CLEARANCE).project(eye);
    return { x: (at.x + 1) * viewport.width / 2, y: (1 - at.y) * viewport.height / 2 };
  };
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
    const back = sheetHome(spinning.current.to);
    spinTo(back.heading, 0.6);
    tiltTo(back.tilt, 0.6);
    touch(false);
    if (!guide.current!.home({ turn, ...besideAside.current!.home(size) })) return;
    guideFrameAt.current = performance.now();
  };
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
      else if (key.kind === "tilt") { touch(true); host.current.tiltTo(sheetTiltBy(tilting.current.to, key.by * TILT_STEP), 0.25); }
      else {
        touch(true);
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

  useFrame(() => {
    const now = performance.now();
    guide.current!.frame(now - guideFrameAt.current);
    guideFrameAt.current = now;
    const drawn = (at: Vector3) => { at.project(camera); return { left: (at.x + 1) * size.width / 2, top: (1 - at.y) * size.height / 2 }; };
    const hidden: ScreenMarker[] = !showFailures ? [] : sheetMarkers(islands, island => drawn(scene.getObjectByName(`planet:${island.story}`)?.getWorldPosition(new Vector3()) ?? new Vector3()), size, mode);
    hidden.push(...sheetPointerMarkers(scene, islands, drawn, size, mode));
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
    const fingers = new Map<number, { x: number; y: number }>();
    const pair = (): [{ x: number; y: number }, { x: number; y: number }] => { const [a, b] = [...fingers.values()]; return [a!, b!]; };
    const picking = (): ForestMode => modeNow.current;
    let cleared = 0, stopped = false;
    const clearHover = (): void => { cleared++; setHover(undefined); element.style.cursor = ""; };
    const hoverAt = oncePerFrame(({ event, at }: { event: PointerEvent; at: number }): void => {
      if (stopped || at !== cleared || down !== undefined) return;
      const box = element.getBoundingClientRect();
      const { cursor, title, detail } = globeHover(scene, camera, box, { x: event.clientX, y: event.clientY }, picking());
      element.style.cursor = cursor;
      setHover(title === undefined ? undefined : { title, ...(detail === undefined ? {} : { detail }), x: Math.max(8, Math.min(box.width - (detail === undefined ? 220 : 280), event.clientX - box.left + 12)), y: event.clientY - box.top + 14 });
    });
    const dragTo = oncePerFrame((next: GlobeTurn): void => { if (!stopped) turnTo(next); });
    const onDown = (event: PointerEvent): void => {
      holdTilt();
      if (event.pointerType === "touch") {
        fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (fingers.size > 1) { down = undefined; clearHover(); return; }
      }
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
        const after = pair();
        spinTiltBy({ x: 0, y: (after[0].y + after[1].y - before[0].y - before[1].y) / 2 });
        dragTo(turn.current);
        return;
      }
      if (fingers.has(event.pointerId)) fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (down !== undefined) {
        if (event.pointerId !== down.id) return;
        down.dragged ||= isGlobeDrag(down, { x: event.clientX, y: event.clientY });
        touch(true);
        guide.current!.cancel();
        const drag = { x: event.clientX - down.last.x, y: event.clientY - down.last.y };
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
      const named = picking() === "forest" && element.parentElement !== null ? nameplateAt(drawnNames(element.parentElement), { x: event.clientX, y: event.clientY }) : undefined;
      if (named !== undefined) { onGate(undefined); onPick(named.story, named.capability); return; }
      const clicked = pickClick(scene, camera, element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, picking());
      if (ignoresClick(clicked, arcNow.current)) return;
      onGate(clicked.gate);
      const hit = clicked.hit;
      if (hit?.kind === "note") onNote(hit.id);
      else if (hit?.kind === "store") onStore(hit.id);
      else onPick(hit?.id, hit?.capability, hit?.gate);
    };
    const onWheel = (event: WheelEvent): void => {
      guide.current!.cancel(); clearHover();
      touch(true);
      if (event.deltaX !== 0) dragTo(turn.current = panBy({ x: -event.deltaX, y: 0 }, middleOfView()));
    };
    const onMenu = (event: MouseEvent): void => { event.preventDefault(); };
    const stopFeedbackPicks = answerFeedbackPicks(element, (cursor) => feedbackPick(scene, camera, element.getBoundingClientRect(), cursor, picking(), titles));
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
      stopFeedbackPicks();
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onCancel);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onMenu);
      element.style.cursor = "";
    };
  }, [camera, gl, scene, titles, onPick, onGate, onNote, onStore, turnTo, sheet, spinBy, spinTiltBy]);

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
        if (!controls.current!.stop({ target: { kind: "story", story: marker.story } })) turnTo(marker.turn);
      }}>!</button>)}
    {away && <button type="button" className="whole-map" style={aside > 0 ? { marginRight: aside } : undefined}
      title="Back to the whole map, as it opened (Home)" onClick={() => goHome.current!()}>Whole map</button>}
    <SheetCompass compass={compass.current} aside={aside} onHome={() => goHome.current!()} />
  </Overlay>;
}

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

const pinnedToCanvas = (_object: unknown, _camera: unknown, size: { width: number; height: number }) => [size.width / 2, size.height / 2];
