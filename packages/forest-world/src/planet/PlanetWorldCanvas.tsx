/** Capability 4 · The planet. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { Canvas, flushSync as flushRoot, useFrame, useStore, useThree, type RootState } from '@react-three/fiber';
import { flushSync } from 'react-dom';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3, type Group, type PerspectiveCamera } from 'three';
import type { ForestScene, Island } from '../scene.js';
import type { PathwayDrawing, PlanetPathwayPlate } from './pathways.js';
import { drawnAtOnce, islandDocks, pageRoadRouter, roadsWhenRouted, type IslandDock } from './road-routing.js';
import { SelectionLanes } from './PlanetTrailRibbons.js';
import type { LitLink } from './lanes.js';
import { litIsland, portMarks, seaLanes, type SeaPort } from './ports.js';
import type { Descriptor3D } from '../descriptors.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../exact-colour.js';
import { SHIPPED_ELEVATION_DEG } from './camera.js';
import { plateTransform, type PlanetSpot } from './planet.js';
import { disposeIslandSurface, hollowIsland, islandSurface } from './island-surface.js';
import { applyPlanetSideOffset, orthographicZoomFor, wheelFloor } from './camera.js';
import { GrowthProvider, usePlanetGrowth, type PlanetGrowth } from './PlanetGrowth.js';
import { plateGrowth } from './growth.js';
import { paintWhileSeen, startingFrameloop, viewportWatch, type ViewportWatch } from './paint-while-seen.js';
import { redrawOnRestore } from './redraw-on-restore.js';
import { globeExterior, type PlanetSurfaceVisibility } from './exterior.js';
import { applySheetEye, SHEET_FOV, sheetKeptOnResize, SHEET_LAND_LIFT, SHEET_LAND_THICKNESS, SHEET_RADIUS, sheetDepthRange, SheetGlass, SheetLights, type SheetExtent } from './sheet.js';
import { PLATE_CLEARANCE } from './planet.js';

export type { PlanetSpot } from './planet.js';
export { plateTransform, PLATE_CLEARANCE } from './planet.js';
export { islandNormal, onIslandSurface } from './island-surface.js';
export { applyPlanetSideOffset } from './camera.js';
/** The eye's height above the sheet's level, in degrees, as the canvas makes it. */
export { SHIPPED_ELEVATION_DEG } from './camera.js';
export type { IslandDock } from './road-routing.js';
export { usePlanetGrowth, type GrowthReader, type PlanetGrowth } from './PlanetGrowth.js';
export { crossingLength, growthMoment, growthPlan, type GrowthOptions, type GrowthPlan, type GrowthStage } from './growth.js';

export type { PlanetSurfaceVisibility } from './exterior.js';
export { applySheetEye, clearGlass, seenFromBelow, SHEET_FOV, SHEET_LAND_LIFT, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, sheetPoint, sheetSpot, tiltFromEye, UnderTheGlass, type SheetExtent, type SheetPoint } from './sheet.js';

/**
 * DOM laid over the canvas: drei's Html with its host pinned to the canvas's parent (4.35). Unpinned, Html follows wherever
 * the canvas connects its events, which changes as the canvas first mounts, inside React's own commit: Html then unmounts
 * its React root there (React logs "synchronously unmount a root while React was already rendering") and its content is
 * lost. The pinned host also holds while the canvas disconnects its events on a project switch.
 */
export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}

export interface PlanetWorldCanvasProps {
  scene: ForestScene;
  /** One unit direction per story; placement and capacity belong to lane A. */
  spots: ReadonlyMap<string, PlanetSpot>;
  /** Fixed radius from the placement rule, in the ported engine's ground units. */
  radius: number;
  /** A host turns the big sphere, sliding the sheet under the eye, without rebuilding the plates. */
  rotation?: [number, number, number, number];
  /** The big sphere's group: a host that turns it often sets its quaternion and position here and asks for a frame,
   * rendering nothing, and passes the same pose as `rotation` and `offset` whenever it does render. */
  globe?: Ref<Group> | undefined;
  /** Where the big sphere's centre stands, at the origin by default: tilting the glass sheet moves it (ADR-1043 D3). */
  offset?: [number, number, number] | undefined;
  /** Names, selection and claim markers mount in each plate's local ground coordinates. They are handed the docks the
   * island's lanes come ashore at, once its lanes are routed (undefined before). */
  plateChildren?: (island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[], docks: readonly IslandDock[] | undefined) => ReactNode;
  /** R3F children, drawn in the canvas with the host's own controls. */
  children?: ReactNode;
  /** False hides every plate, for looking at the knowledge under the glass alone (E1). */
  surface?: boolean;
  /** Independent exterior switches, all true by default; `roads` shows or hides the lanes at sea and their labels.
   * surface=false still hides the whole exterior. */
  surfaces?: Partial<PlanetSurfaceVisibility>;
  /** Drawn with the turning sheet, in its own coordinates: the knowledge under the glass. */
  inside?: ReactNode;
  /** How many radii half the short side spans: 1.18 by default. */
  framing?: number | undefined;
  /** Positive moves the rendered sheet right in CSS pixels, leaving room for an adjacent card. */
  sideOffset?: number | undefined;
  /** The selection's lit links, drawn as pale-blue lanes at sea, with a port at each dock they come ashore at on the
   * selected island; none by default. At rest the sea carries no line (ADR-1261 D1). */
  lanes?: readonly LitLink[];
  /** A recorded growth to replay (capability 12): islands rise, lanes show once both their islands have, and plate
   * children read `usePlanetGrowth`. */
  growth?: PlanetGrowth | undefined;
  /** The glass sheet's size: the world is drawn on it, the near pole of a sphere of `radius` (ADR-1043 D1), lit, and seen
   * by a perspective eye whose depth range spans the sheet (ADR-1062 D1). */
  sheet: SheetExtent;
  /** Every island drawn as its coast line alone over clear glass, hiding nothing beneath it: the glass sheet's Library look
   * (ADR-1061 D2, ADR-1062 D3). */
  hollow?: boolean | undefined;
}

const NO_LANES: readonly LitLink[] = [];
const NO_DOCKS: readonly IslandDock[] = [];
const NO_PORTS: readonly SeaPort[] = [];
const ORIGIN: [number, number, number] = [0, 0, 0];

/** How far below its resting place an island starts, in ground units: it rises out of the glass. */
const RISE_DEPTH = 6;

/** Each island a raised plate of the shared thickness with sides, on the glass sheet (ADR-1059 D2). */
const Plate = memo(function Plate({ island, spot, radius, plate, docks, ports, visible, grounds, hollow, children }: {
  island: Island; spot: PlanetSpot; radius: number; plate: PlanetPathwayPlate; docks: readonly IslandDock[] | undefined;
  /** Its ports, when it is the selected island (4.40). */
  ports: readonly SeaPort[];
  visible: boolean; grounds: boolean; hollow: boolean;
  children: PlanetWorldCanvasProps['plateChildren'];
}) {
  const transform = useMemo(() => plateTransform(spot, radius, SHEET_LAND_LIFT), [spot.x, spot.y, spot.z, radius]);
  const { descriptors, coast } = plate;
  // ADR-0804 D1: the island is one flat, pale, see-through surface with a coast line, and nothing else, with sides.
  const ground = useMemo(() => islandSurface(coast, radius, island.story, SHEET_LAND_THICKNESS), [coast, radius, island.story]);
  useEffect(() => () => disposeIslandSurface(ground), [ground]);
  // Hollowed and filled in again in place, so turning the sheet over rebuilds no island.
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => { hollowIsland(ground, hollow); invalidate(); }, [ground, hollow, invalidate]);
  const portGroup = useMemo(() => ports.length === 0 ? undefined : portMarks(ports, radius), [ports, radius]);
  useEffect(() => () => portGroup?.traverse(o => { if ('geometry' in o) (o as { geometry: { dispose(): void } }).geometry.dispose(); }), [portGroup]);
  // The drawing engine 5.4: an island not yet risen is hidden with its marks; a rising one swells from its middle out of the glass.
  const growth = usePlanetGrowth();
  const group = useRef<Group>(null);
  const [risen, setRisen] = useState(() => growth.island(island.story) > 0);
  const rest = useMemo(() => new Vector3(...transform.position), [transform]);
  const out = useMemo(() => rest.clone().normalize(), [rest]);
  useFrame(() => {
    const shown = plateGrowth(growth.island(island.story));
    const node = group.current;
    if (node !== null) {
      node.scale.setScalar(Math.max(shown.scale, 1e-4));
      node.position.copy(rest).addScaledVector(out, -RISE_DEPTH * shown.sink);
    }
    if (shown.visible !== risen) setRisen(shown.visible);
  });
  return <group ref={group} position={transform.position} quaternion={transform.quaternion} name={`planet:${island.story}`} visible={visible && risen}>
    <primitive object={ground} visible={grounds} />
    {portGroup && <primitive object={portGroup} visible={grounds} />}
    {/* Html markers do not inherit Three's visibility: the legacy inside-only gate removes them. */}
    {visible && risen && children?.(island, descriptors, coast, docks)}
  </group>;
});

function Framing({ radius, framing, sideOffset, sheet }: { radius: number; framing: number; sideOffset: number; sheet: SheetExtent }) {
  const { camera, invalidate } = useThree();
  const store = useStore();
  const reach = Math.hypot(sheet.width, sheet.height);
  // The host's framing and side offset are applied as it changes them, at the size the canvas has then. A change of size alone
  // keeps the eye (4.43, below), so a host still to answer the new size never has its last pose drawn at it.
  useLayoutEffect(() => {
    const { size } = store.getState();
    // The framing's zoom stands the perspective eye off the middle of the view, by as far as it asks (ADR-1062 D1).
    applySheetEye(camera as PerspectiveCamera, reach, orthographicZoomFor(radius * framing, Math.min(size.width, size.height)), size);
    invalidate();
  }, [camera, radius, framing, invalidate, reach, store]);
  // Keeping these effects separate lets a card move without resetting wheel/pinch zoom.
  useLayoutEffect(() => {
    applyPlanetSideOffset(camera as PerspectiveCamera, store.getState().size, sideOffset);
    invalidate();
  }, [camera, sideOffset, invalidate, store]);
  // 4.43: in the store update that resizes the canvas, before anything is drawn at the new size.
  useLayoutEffect(() => {
    let last = store.getState().size;
    return store.subscribe(() => {
      const { size } = store.getState();
      if (size.width === last.width && size.height === last.height && size.left === last.left) return;
      sheetKeptOnResize(camera as PerspectiveCamera, reach, last, size);
      last = size;
    });
  }, [camera, reach, store]);
  // The wheel moves the sheet's eye, so its near and far planes follow it round the sheet.
  useFrame(() => sheetDepthRange(camera as PerspectiveCamera, reach));
  return null;
}

/** The wheel and pinch move the perspective eye toward or away from the middle of the view, zooming out no further than half
 * the framed size (ADR-1062 D1). */
function Wheel({ radius, framing }: { radius: number; framing: number }) {
  const size = useThree(state => state.size), camera = useThree(state => state.camera);
  // The eye stands this far off for a zoom of one CSS pixel per unit; the middle of the view lies on its line of sight.
  const unit = Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
  const middle = camera.position.clone().setLength(SHEET_RADIUS + PLATE_CLEARANCE);
  return <OrbitControls makeDefault enablePan={false} enableRotate={false} target={middle} minDistance={unit / 30} maxDistance={unit / wheelFloor(radius, framing, size)} />;
}

/** The drawing engine 4.10: the map draws only while some of its canvas is on screen, however busy its animations are. */
function PaintWhileSeen({ watch }: { watch: ViewportWatch | undefined }) {
  const get = useThree(state => state.get);
  const canvas = useThree(state => state.gl.domElement);
  useEffect(() => paintWhileSeen(get, canvas, watch), [get, canvas, watch]);
  // The drawing engine 4.15: a context the browser hands back is drawn again, not left blank until something moves.
  useEffect(() => redrawOnRestore(get, canvas), [get, canvas]);
  return null;
}

/** The drawing engine 4.21: the islands are drawn at once and the lanes when routed, off the page's main thread where the page
 * offers a road worker; a routing its layout has overtaken draws nothing, and one a new layout with the same routing
 * key arrives during runs on (4.39). */
function useRoadsWhenRouted(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number): PathwayDrawing & { routing: boolean } {
  const shown = useRef<{ spots: ReadonlyMap<string, PlanetSpot>; radius: number; drawing: PathwayDrawing }>(undefined);
  const now = useMemo(() => ({ scene, spots, radius, ...drawnAtOnce(scene, spots, radius, shown.current) }), [scene, spots, radius]);
  const [routed, setRouted] = useState<{ now: typeof now; drawing: PathwayDrawing }>();
  const roads = useMemo(() => roadsWhenRouted<typeof now>(pageRoadRouter(), (layout, drawing) => setRouted({ now: layout, drawing })), []);
  useEffect(() => roads.stop, [roads]);
  useEffect(() => roads.show(now), [roads, now]);
  const drawing = routed?.now === now ? routed.drawing : now.drawing;
  shown.current = { spots, radius, drawing };
  return { ...drawing, routing: routed?.now !== now && now.routing !== undefined };
}

/** The one dev-only seam an evidence capture observes the map through: a capture build sets this global
 * before the page runs and is handed the canvas's live state getter. Nothing in the product sets it. */
const CAPTURE_SEAM = '__storytreeCaptureGlobe';

/**
 * 4.43: the root's watch on its frame's size, which takes a new size in the browser's own resize step, between laying the page
 * out and painting it, and draws the map at it there: the frame the sidebar hides, shows or is dragged on is painted with the
 * canvas at its new size, not a frame later (the root's own watch waits 50 ms and sets the size after the paint).
 */
function drawnOnResize(state: () => RootState | undefined): typeof ResizeObserver {
  return class extends ResizeObserver {
    constructor(seen: ResizeObserverCallback) {
      super((entries, observer) => {
        const before = state()?.size;
        // The Canvas takes the size and its root resizes the canvas, then the root's own components see it, and the DOM over
        // the canvas, which drei's Html renders through roots of its own, follows in the same pass.
        flushSync(() => seen(entries, observer));
        flushSync(() => flushRoot(() => {}));
        const now = state();
        if (now !== undefined && now.size !== before && now.frameloop !== 'never') now.advance(performance.now());
      });
    }
  };
}

/** The map: one Canvas, the glass sheet, and each story's island as a raised plate with a coast (ADR-0804 D1, ADR-1059 D2).
 * A lamp shades the islands' sides and the glass's edge, and the land's top keeps its exact colour (ADR-1062 D1). */
export function PlanetWorldCanvas({ scene, spots, radius, rotation = [0, 0, 0, 1], offset, globe, plateChildren, children, surface = true, surfaces, inside, framing = 1.18, sideOffset = 0, lanes = NO_LANES, growth, sheet, hollow = false }: PlanetWorldCanvasProps) {
  const drawing = useRoadsWhenRouted(scene, spots, radius);
  const pathways = drawing.plan;
  const docks = useMemo(() => islandDocks(pathways, drawing.routing), [pathways, drawing.routing]);
  const docksOn = useCallback((story: string) => docks === undefined ? undefined : docks.get(story) ?? NO_DOCKS, [docks]);
  // 4.8, 4.40: the lanes end just off the selected island's ports.
  const selected = useMemo(() => litIsland(scene, lanes), [scene, lanes]);
  const sea = useMemo(() => {
    const spot = selected === undefined ? undefined : spots.get(selected);
    return seaLanes(pathways, lanes, selected === undefined || spot === undefined ? undefined : { story: selected, spot, radius });
  }, [pathways, lanes, selected, spots, radius]);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const position: [number, number, number] = [0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4];
  const root = useRef<() => RootState>(undefined);
  const resize = useMemo(() => ({ debounce: 0, polyfill: drawnOnResize(() => root.current?.()) }), []);
  const onCreated = useCallback(({ camera, get }: RootState) => {
    camera.lookAt(0, 0, 0);
    root.current = get;
    (globalThis as { [CAPTURE_SEAM]?: (state: () => RootState) => void })[CAPTURE_SEAM]?.(get);
  }, []);
  const watch = useMemo(viewportWatch, []);
  const exterior = globeExterior(surface, surfaces);
  return <Canvas {...EXACT_COLOUR_CANVAS_PROPS} frameloop={startingFrameloop(watch)} resize={resize}
    camera={{ position, near: 0.1, far: radius * 10, fov: SHEET_FOV }} onCreated={onCreated}>
    <PaintWhileSeen watch={watch} />
    <color attach="background" args={['#101418']} />
    <Framing radius={radius} framing={framing} sideOffset={sideOffset} sheet={sheet} />
    <GrowthProvider growth={growth}>
    <group ref={globe ?? null} name="globe" quaternion={rotation} position={offset ?? ORIGIN}>
      <SheetGlass extent={sheet} clear={hollow} />
      {scene.islands.map(island => {
        const spot = spots.get(island.story);
        if (spot === undefined) throw new Error(`No planet spot for story ${island.story}`);
        return <Plate key={island.story} island={island} spot={spot} radius={radius} plate={pathways.plates.get(island.story)!} docks={docksOn(island.story)}
          ports={island.story === selected ? sea.ports : NO_PORTS} visible={exterior.plates} grounds={exterior.grounds} hollow={hollow} children={plateChildren} />;
      })}
      <group name="globe-lanes" visible={exterior.roads}><SelectionLanes routes={sea.lanes} /></group>
      {inside}
    </group>
    <SheetLights />
    <Wheel radius={radius} framing={framing} />
    {/* The host's children read the growth too (usePlanetGrowth), as the plates and the inside do. */}
    {children}
    </GrowthProvider>
    {exterior.roads && drawing.issue && <Overlay fullscreen zIndexRange={[45, 45]} style={{ pointerEvents: 'none' }}>
      <div role="alert" title={drawing.issue} style={{ position: 'absolute', right: 16, bottom: 16,
        maxWidth: 320, padding: '10px 14px', borderRadius: 6, background: '#352b20', color: '#ffe1ac' }}>
        {pathways.lanes.edges.length > 0 ? 'Some lanes could not be drawn.' : 'Lanes could not be drawn.'} Island health and selection are still available.
      </div>
    </Overlay>}
  </Canvas>;
}
