/** Capability 6 · The planet. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3, type Group, type OrthographicCamera, type PerspectiveCamera } from 'three';
import type { ForestScene, Island } from '../scene.js';
import type { PathwayDrawing, PlanetPathwayPlate } from './pathways.js';
import { drawnAtOnce, pageRoadRouter, routedDrawing } from './road-routing.js';
import { Pathways, SelectionLanes } from './PlanetTrailRibbons.js';
import { onIsland, type InlandWay, type LitLink } from './lanes.js';
import type { CoastPoint } from '../coast-clip.js';
import type { Descriptor3D } from '../descriptors.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../exact-colour.js';
import { SHIPPED_ELEVATION_DEG } from './camera.js';
import { createPlanetSurface, plateTransform, type PlanetSpot } from './planet.js';
import { disposeIslandSurface, hollowIsland, islandSurface } from './island-surface.js';
import { applyPlanetFraming, applyPlanetSideOffset, orthographicZoomFor, wheelFloor } from './camera.js';
import { GrowthProvider, usePlanetGrowth, type PlanetGrowth } from './PlanetGrowth.js';
import { plateGrowth, roadSegmentWindows } from './growth.js';
import { paintWhileSeen, startingFrameloop, viewportWatch, type ViewportWatch } from './paint-while-seen.js';
import { redrawOnRestore } from './redraw-on-restore.js';
import { globeExterior, type PlanetSurfaceVisibility } from './exterior.js';
import { applySheetEye, SHEET_FOV, SHEET_LAND_LIFT, SHEET_LAND_THICKNESS, SHEET_RADIUS, sheetDepthRange, SheetGlass, SheetLights, type SheetExtent } from './sheet.js';
import { PLATE_CLEARANCE } from './planet.js';

export type { PlanetSpot } from './planet.js';
export { globeOccluder, plateTransform, PLATE_CLEARANCE } from './planet.js';
export { islandNormal, onIslandSurface } from './island-surface.js';
export { applyPlanetFraming, applyPlanetSideOffset } from './camera.js';
/** The eye's height above the globe's equator, in degrees: a host turns what it shows toward it. */
export { SHIPPED_ELEVATION_DEG } from './camera.js';
export { usePlanetGrowth, type GrowthReader, type PlanetGrowth } from './PlanetGrowth.js';
export { crossingLength, growthMoment, growthPlan, type GrowthOptions, type GrowthPlan, type GrowthStage } from './growth.js';

export type { PlanetSurfaceVisibility } from './exterior.js';
export { applySheetEye, seenFromBelow, SHEET_FOV, SHEET_LAND_LIFT, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, sheetPoint, sheetSpot, tiltFromEye, UnderTheGlass, type SheetExtent, type SheetPoint } from './sheet.js';

export interface PlanetWorldCanvasProps {
  scene: ForestScene;
  /** One unit direction per story; placement and capacity belong to lane A. */
  spots: ReadonlyMap<string, PlanetSpot>;
  /** Fixed radius from the placement rule, in the ported engine's ground units. */
  radius: number;
  /** A host can turn the globe toward a failing story without rebuilding the plates. */
  rotation?: [number, number, number, number];
  /** Where the globe's centre stands, at the origin by default: the glass sheet turning over moves it (ADR-1043 D3). */
  offset?: [number, number, number] | undefined;
  /** Names, selection and claim markers mount in each plate's local ground coordinates. */
  plateChildren?: (island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => ReactNode;
  /** R3F children can use the default orbit controls for host-driven focus. */
  children?: ReactNode;
  /** False hides the sea and every plate, for looking inside the globe (the knowledge core, E1). */
  surface?: boolean;
  /** Independent exterior switches, all true by default; showing hidden roads draws them on over a second.
   * surface=false still hides the whole exterior. */
  surfaces?: Partial<PlanetSurfaceVisibility>;
  /** Drawn inside the turning globe, in its own coordinates: the knowledge core. */
  inside?: ReactNode;
  /** How many radii half the short side spans: 1.18 by default, the planet filling 85% of it. */
  framing?: number | undefined;
  /** Positive moves the rendered globe right in CSS pixels, leaving room for an adjacent card. */
  sideOffset?: number | undefined;
  /** False keeps the eye where it is, zooming only, for a host that turns the globe itself. */
  orbit?: boolean;
  /** The selection's lit links, drawn as lanes over their roads; none by default. */
  lanes?: readonly LitLink[];
  /** The way inland from a dock on `story`'s island to `capability`'s territory, in the island's own ground coordinates
   * and starting on the dock, along lines the host has drawn there (ADR-0991 D4); without it a lane ends at its docks. */
  laneWays?: ((story: string, capability: string, dock: CoastPoint) => readonly CoastPoint[] | undefined) | undefined;
  /** A recorded growth to replay (world 7): islands rise, roads draw on, and plate children read `usePlanetGrowth`. */
  growth?: PlanetGrowth | undefined;
  /** Draw first and newly arriving roads on in a live host; recorded growth takes precedence. */
  liveRoads?: boolean | undefined;
  /** Draw the world as a glass sheet this size, the near pole of a sphere of `radius` (ADR-1043 D1): the sheet's glass
   * instead of the sea, lit, and seen by a perspective eye whose depth range spans the sheet (ADR-1062 D1). */
  sheet?: SheetExtent | undefined;
  /** Every island drawn as its coast line alone, hiding nothing beneath it: the glass sheet's Library face (ADR-1061 D2). */
  hollow?: boolean | undefined;
}

const NO_LANES: readonly LitLink[] = [];
const ORIGIN: [number, number, number] = [0, 0, 0];

/** How far below its resting place an island starts, in ground units: it rises out of the glass. */
const RISE_DEPTH = 6;

const Plate = memo(function Plate({ island, spot, radius, plate, visible, grounds, raised, hollow, children }: {
  island: Island; spot: PlanetSpot; radius: number; plate: PlanetPathwayPlate;
  visible: boolean; grounds: boolean; hollow: boolean;
  /** On the glass sheet, a raised plate of the shared thickness with sides (ADR-1059 D2). */
  raised: boolean;
  children: PlanetWorldCanvasProps['plateChildren'];
}) {
  const transform = useMemo(() => plateTransform(spot, radius, raised ? SHEET_LAND_LIFT : 0), [spot.x, spot.y, spot.z, radius, raised]);
  const { descriptors, coast } = plate;
  // ADR-0804 D1: the island is one flat, pale, see-through surface with a coast line, and nothing else; on the sheet it has sides.
  const ground = useMemo(() => islandSurface(coast, radius, island.story, raised ? SHEET_LAND_THICKNESS : 0), [coast, radius, island.story, raised]);
  useEffect(() => () => disposeIslandSurface(ground), [ground]);
  // Hollowed and filled in again in place, so turning the sheet over rebuilds no island.
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => { hollowIsland(ground, hollow); invalidate(); }, [ground, hollow, invalidate]);
  // World 7.4: an island not yet risen is hidden with its marks; a rising one swells from its middle out of the glass.
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
    {/* Html markers do not inherit Three's visibility: the legacy inside-only gate removes them. */}
    {visible && risen && children?.(island, descriptors, coast)}
  </group>;
});

function Surface({ radius, visible }: { radius: number; visible: boolean }) {
  const surface = useMemo(() => createPlanetSurface(radius), [radius]);
  useEffect(() => () => { surface.geometry.dispose(); for (const face of surface.material) face.dispose(); }, [surface]);
  // World 7.2: a growth from a point of light swells the glass first.
  const growth = usePlanetGrowth();
  useFrame(() => surface.scale.setScalar(Math.max(growth.globe(), 0.01)));
  return <primitive object={surface} visible={visible} />;
}

function Framing({ radius, framing, sideOffset, sheet }: { radius: number; framing: number; sideOffset: number; sheet: SheetExtent | undefined }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    // On the sheet the framing's zoom stands the perspective eye off the middle of the view, by as far as it asks (ADR-1062 D1).
    if (sheet !== undefined) applySheetEye(camera as PerspectiveCamera, Math.hypot(sheet.width, sheet.height), orthographicZoomFor(radius * framing, Math.min(size.width, size.height)), size);
    else applyPlanetFraming(camera as OrthographicCamera, radius, framing, size);
    invalidate();
  }, [camera, radius, framing, size.width, size.height, invalidate, sheet?.width, sheet?.height]);
  // Keeping these effects separate lets a card move without resetting wheel/pinch zoom.
  useLayoutEffect(() => {
    applyPlanetSideOffset(camera as OrthographicCamera, size, sideOffset);
    invalidate();
  }, [camera, sideOffset, size.width, size.height, invalidate]);
  // The wheel moves the sheet's eye, so its near and far planes follow it round the sheet.
  useFrame(() => { if (sheet !== undefined) sheetDepthRange(camera as PerspectiveCamera, Math.hypot(sheet.width, sheet.height)); });
  return null;
}

/** The wheel and pinch zoom the eye; zooming out stops at half the framed size (6.18). On the sheet they move the perspective
 * eye toward or away from the middle of the view, between the same zooms (ADR-1062 D1). */
function Wheel({ radius, framing, orbit, sheet }: { radius: number; framing: number; orbit: boolean; sheet: boolean }) {
  const size = useThree(state => state.size), camera = useThree(state => state.camera);
  if (!sheet) return <OrbitControls makeDefault enablePan={false} enableRotate={orbit} minZoom={wheelFloor(radius, framing, size)} maxZoom={30} />;
  // The eye stands this far off for a zoom of one CSS pixel per unit; the middle of the view lies on its line of sight.
  const unit = Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
  const middle = camera.position.clone().setLength(SHEET_RADIUS + PLATE_CLEARANCE);
  return <OrbitControls makeDefault enablePan={false} enableRotate={false} target={middle} minDistance={unit / 30} maxDistance={unit / wheelFloor(radius, framing, size)} />;
}

/** World 6.10: the globe draws only while some of its canvas is on screen, however busy its animations are. */
function PaintWhileSeen({ watch }: { watch: ViewportWatch | undefined }) {
  const get = useThree(state => state.get);
  const canvas = useThree(state => state.gl.domElement);
  useEffect(() => paintWhileSeen(get, canvas, watch), [get, canvas, watch]);
  // World 6.15: a context the browser hands back is drawn again, not left blank until something moves.
  useEffect(() => redrawOnRestore(get, canvas), [get, canvas]);
  return null;
}

/** World 6.21: the islands are drawn at once and the roads when routed, off the page's main thread where the page
 * offers a road worker; a routing its layout has overtaken draws nothing. */
function useRoadsWhenRouted(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number): PathwayDrawing & { routing: boolean } {
  const router = useMemo(() => pageRoadRouter(), []);
  const shown = useRef<{ spots: ReadonlyMap<string, PlanetSpot>; radius: number; drawing: PathwayDrawing }>(undefined);
  const now = useMemo(() => drawnAtOnce(scene, spots, radius, shown.current), [scene, spots, radius]);
  const [routed, setRouted] = useState<{ now: typeof now; drawing: PathwayDrawing }>();
  useEffect(() => {
    if (now.routing === undefined) return;
    const layout = new AbortController();
    void routedDrawing(scene, spots, radius, now.routing, router, layout.signal).then(drawing => { if (drawing) setRouted({ now, drawing }); });
    return () => layout.abort();
  }, [now, router]);
  const drawing = routed?.now === now ? routed.drawing : now.drawing;
  shown.current = { spots, radius, drawing };
  return { ...drawing, routing: routed?.now !== now && now.routing !== undefined };
}

/** The one dev-only seam an evidence capture observes the globe through: a capture build sets this global
 * before the page runs and is handed the canvas's live state getter. Nothing in the product sets it. */
const CAPTURE_SEAM = '__storytreeCaptureGlobe';

/** The globe: one Canvas, the see-through sea, and each story's island as a flat surface with a coast
 * (ADR-0804 D1). Nothing on it is lit, so there is no sun to calibrate; on the glass sheet a lamp shades the islands' sides
 * and the glass's edge, and the land's top keeps its exact colour (ADR-1062 D1). */
export function PlanetWorldCanvas({ scene, spots, radius, rotation = [0, 0, 0, 1], offset, plateChildren, children, surface = true, surfaces, inside, framing = 1.18, sideOffset = 0, orbit = true, lanes = NO_LANES, laneWays, growth, liveRoads = false, sheet, hollow = false }: PlanetWorldCanvasProps) {
  const drawing = useRoadsWhenRouted(scene, spots, radius);
  const inland = useMemo((): InlandWay | undefined => laneWays && ((dock, capability) => {
    const way = laneWays(dock.story, capability, dock.local), spot = spots.get(dock.story);
    return way && spot && way.length > 1 ? onIsland(way, spot, radius, sheet === undefined ? 0 : SHEET_LAND_LIFT) : undefined;
  }), [laneWays, spots, radius, sheet === undefined]);
  const pathways = drawing.plan;
  const reveal = useMemo(() => growth === undefined ? undefined : roadSegmentWindows(pathways, growth.plan.roads), [pathways, growth?.plan]);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const position: [number, number, number] = [0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4];
  const onCreated = useCallback(({ camera, get }: RootState) => {
    camera.lookAt(0, 0, 0);
    (globalThis as { [CAPTURE_SEAM]?: (state: () => RootState) => void })[CAPTURE_SEAM]?.(get);
  }, []);
  const watch = useMemo(viewportWatch, []);
  const exterior = globeExterior(surface, surfaces);
  // The globe's eye is orthographic and the sheet's a perspective one (ADR-1062 D1); a canvas keeps the eye it was made with,
  // so changing between them makes a new canvas.
  const perspective = sheet !== undefined;
  return <Canvas key={perspective ? 'sheet' : 'globe'} orthographic={!perspective} {...EXACT_COLOUR_CANVAS_PROPS} frameloop={startingFrameloop(watch)}
    camera={perspective ? { position, near: 0.1, far: radius * 10, fov: SHEET_FOV } : { position, near: 0.1, far: radius * 10 }} onCreated={onCreated}>
    <PaintWhileSeen watch={watch} />
    <color attach="background" args={['#101418']} />
    <Framing radius={radius} framing={framing} sideOffset={sideOffset} sheet={sheet} />
    <GrowthProvider growth={growth}>
    <group name="globe" quaternion={rotation} position={offset ?? ORIGIN}>
      {sheet === undefined ? <Surface radius={radius} visible={exterior.sea} /> : <SheetGlass extent={sheet} />}
      {scene.islands.map(island => {
        const spot = spots.get(island.story);
        if (spot === undefined) throw new Error(`No planet spot for story ${island.story}`);
        return <Plate key={island.story} island={island} spot={spot} radius={radius} plate={pathways.plates.get(island.story)!}
          visible={exterior.plates} grounds={exterior.grounds} raised={sheet !== undefined} hollow={hollow} children={plateChildren} />;
      })}
      <group name="globe-roads" visible={exterior.roads}><Pathways plan={pathways} reveal={reveal} live={liveRoads && growth === undefined} visible={exterior.roads} routing={drawing.routing} /><SelectionLanes plan={pathways} lit={lanes} inland={inland} /></group>
      {inside}
    </group>
    {perspective && <SheetLights />}
    <Wheel radius={radius} framing={framing} orbit={orbit} sheet={perspective} />
    {/* The host's children read the growth too (usePlanetGrowth), as the plates and the inside do. */}
    {children}
    </GrowthProvider>
    {exterior.roads && drawing.issue && <Html fullscreen zIndexRange={[45, 45]} style={{ pointerEvents: 'none' }}>
      <div role="alert" title={drawing.issue} style={{ position: 'absolute', right: 16, bottom: 16,
        maxWidth: 320, padding: '10px 14px', borderRadius: 6, background: '#352b20', color: '#ffe1ac' }}>
        {pathways.edges.length > 0 ? 'Some pathways could not be drawn.' : 'Pathways could not be drawn.'} Island health and selection are still available.
      </div>
    </Html>}
  </Canvas>;
}
