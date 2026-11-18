// Capability 4 · The planet
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { Canvas, flushSync as flushRoot, useFrame, useStore, useThree, type RootState } from '@react-three/fiber';
import { flushSync } from 'react-dom';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3, type Group, type PerspectiveCamera } from 'three';
import type { ForestScene, Island, Store } from '../scene.js';
import { storeLayout, tableNameSizes } from './store.js';
import type { PathwayDrawing, PlanetPathwayPlate } from './pathways.js';
import { drawnAtOnce, islandDocks, pageRoadRouter, roadsWhenRouted, type IslandDock } from './road-routing.js';
import { RestLanes, SelectionLanes } from './PlanetTrailRibbons.js';
import { restLanes, type LitLink } from './lanes.js';
import { litIsland, portMarks, seaLanes, type SeaPort } from './ports.js';
import type { Descriptor3D } from '../descriptors.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../exact-colour.js';
import { SHIPPED_ELEVATION_DEG } from './camera.js';
import { plateTransform, type PlanetSpot } from './planet.js';
import { disposeIslandSurface, hollowIsland, islandSurface } from './island-surface.js';
import { applyPlanetSideOffset, orthographicZoomFor, wheelFloor, type FramingViewport } from './camera.js';
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
export { SHIPPED_ELEVATION_DEG } from './camera.js';
export type { IslandDock } from './road-routing.js';
export { usePlanetGrowth, type GrowthReader, type PlanetGrowth } from './PlanetGrowth.js';
export { crossingLength, growthMoment, growthPlan, type GrowthOptions, type GrowthPlan, type GrowthStage } from './growth.js';

export type { PlanetSurfaceVisibility } from './exterior.js';
export { storeLayout, type StoreLayout, type StoreTile } from './store.js';
export { applySheetEye, clearGlass, seenFromBelow, SHEET_FOV, SHEET_LAND_LIFT, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, sheetPoint, sheetSpot, tiltFromEye, UnderTheGlass, type SheetExtent, type SheetPoint } from './sheet.js';

export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}

export interface PlanetWorldCanvasProps {
  scene: ForestScene;
  spots: ReadonlyMap<string, PlanetSpot>;
  storeSpots?: ReadonlyMap<string, PlanetSpot> | undefined;
  radius: number;
  rotation?: [number, number, number, number];
  globe?: Ref<Group> | undefined;
  offset?: [number, number, number] | undefined;
  plateChildren?: (island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[], docks: readonly IslandDock[] | undefined) => ReactNode;
  storeChildren?: ((address: string, name: readonly [number, number, number]) => ReactNode) | undefined;
  children?: ReactNode;
  surface?: boolean;
  surfaces?: Partial<PlanetSurfaceVisibility>;
  inside?: ReactNode;
  framing?: number | undefined;
  floor?: ((size: FramingViewport) => number) | undefined;
  sideOffset?: number | undefined;
  lanes?: readonly LitLink[];
  growth?: PlanetGrowth | undefined;
  sheet: SheetExtent;
  hollow?: boolean | undefined;
  onLanesNotice?: ((notice: LanesNotice | undefined) => void) | undefined;
}

export interface LanesNotice { readonly text: string; readonly issue: string }

const NO_LANES: readonly LitLink[] = [];
const NO_DOCKS: readonly IslandDock[] = [];
const NO_PORTS: readonly SeaPort[] = [];
const ORIGIN: [number, number, number] = [0, 0, 0];

const RISE_DEPTH = 6;

const Plate = memo(function Plate({ island, spot, radius, plate, docks, ports, visible, grounds, hollow, children }: {
  island: Island; spot: PlanetSpot; radius: number; plate: PlanetPathwayPlate; docks: readonly IslandDock[] | undefined;
  ports: readonly SeaPort[];
  visible: boolean; grounds: boolean; hollow: boolean;
  children: PlanetWorldCanvasProps['plateChildren'];
}) {
  const transform = useMemo(() => plateTransform(spot, radius, SHEET_LAND_LIFT), [spot.x, spot.y, spot.z, radius]);
  const { descriptors, coast } = plate;
  const ground = useMemo(() => islandSurface(coast, radius, island.story, SHEET_LAND_THICKNESS), [coast, radius, island.story]);
  useEffect(() => () => disposeIslandSurface(ground), [ground]);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => { hollowIsland(ground, hollow); invalidate(); }, [ground, hollow, invalidate]);
  const portGroup = useMemo(() => ports.length === 0 ? undefined : portMarks(ports, radius), [ports, radius]);
  useEffect(() => () => portGroup?.traverse(o => { if ('geometry' in o) (o as { geometry: { dispose(): void } }).geometry.dispose(); }), [portGroup]);
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
    {visible && risen && children?.(island, descriptors, coast, docks)}
  </group>;
});

const STORE_THICKNESS = 2;
const TILE_RISE = 0.6;
const STORE_COLOUR = '#4f7fae';
const TILE_COLOUR = '#edf3f5';

const StorePlate = memo(function StorePlate({ store, spot, radius, visible, children }: { store: Store; spot: PlanetSpot; radius: number; visible: boolean; children?: PlanetWorldCanvasProps['storeChildren'] }) {
  const transform = useMemo(() => plateTransform(spot, radius, SHEET_LAND_LIFT), [spot.x, spot.y, spot.z, radius]);
  const laid = useMemo(() => storeLayout(store.tables), [store.tables]);
  const named = useMemo(() => [0, TILE_RISE, -laid.depth / 2 + 18] as const, [laid.depth]);
  const label = { pointerEvents: 'none', whiteSpace: 'nowrap', font: '13px system-ui, sans-serif' } as const;
  const plate = useRef<Group>(null);
  const names = useRef(new Map<string, HTMLSpanElement>());
  const at = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const group = plate.current;
    if (group === null || !visible) return;
    const sizes = tableNameSizes(laid, (x, z) => {
      group.localToWorld(at.set(x, TILE_RISE, z)).project(camera);
      return [(at.x + 1) * size.width / 2, (1 - at.y) * size.height / 2];
    });
    for (const [table, px] of sizes) {
      const name = names.current.get(table), font = `${px.toFixed(1)}px`;
      if (name !== undefined && name.style.fontSize !== font) name.style.fontSize = font;
    }
  });
  return <group ref={plate} position={transform.position} quaternion={transform.quaternion} name={`store:${store.address}`} visible={visible}>
    <mesh position={[0, -STORE_THICKNESS / 2, 0]}>
      <boxGeometry args={[laid.width, STORE_THICKNESS, laid.depth]} />
      <meshLambertMaterial color={STORE_COLOUR} />
    </mesh>
    {laid.tiles.map(tile => <mesh key={tile.name} name={`store-table:${tile.name}`} position={[tile.x, TILE_RISE / 2, tile.z]}>
      <boxGeometry args={[tile.width, TILE_RISE, tile.depth]} />
      <meshLambertMaterial color={TILE_COLOUR} />
    </mesh>)}
    {visible && <>
      <Overlay className="planet-store-name" position={[...named]} center zIndexRange={[25, 21]} style={label}>
        <span style={{ color: '#e8f0f8', fontWeight: 600 }} data-store={store.address}>{store.address}</span>
      </Overlay>
      {laid.tiles.map(tile => <Overlay key={tile.name} className="planet-store-table" position={[tile.x, TILE_RISE, tile.z]} center zIndexRange={[25, 21]} style={label}>
        <span ref={(span) => { if (span === null) names.current.delete(tile.name); else names.current.set(tile.name, span); }} style={{ color: '#1c2733' }}>{tile.name}</span>
      </Overlay>)}
      {children?.(store.address, named)}
    </>}
  </group>;
});

function Framing({ radius, framing, sideOffset, sheet }: { radius: number; framing: number; sideOffset: number; sheet: SheetExtent }) {
  const { camera, invalidate } = useThree();
  const store = useStore();
  const reach = Math.hypot(sheet.width, sheet.height);
  useLayoutEffect(() => {
    const { size } = store.getState();
    applySheetEye(camera as PerspectiveCamera, reach, orthographicZoomFor(radius * framing, Math.min(size.width, size.height)), size);
    invalidate();
  }, [camera, radius, framing, invalidate, reach, store]);
  useLayoutEffect(() => {
    applyPlanetSideOffset(camera as PerspectiveCamera, store.getState().size, sideOffset);
    invalidate();
  }, [camera, sideOffset, invalidate, store]);
  useLayoutEffect(() => {
    let last = store.getState().size;
    return store.subscribe(() => {
      const { size } = store.getState();
      if (size.width === last.width && size.height === last.height && size.left === last.left) return;
      sheetKeptOnResize(camera as PerspectiveCamera, reach, last, size);
      last = size;
    });
  }, [camera, reach, store]);
  useFrame(() => sheetDepthRange(camera as PerspectiveCamera, reach));
  return null;
}

function Wheel({ radius, framing, floor }: { radius: number; framing: number; floor: ((size: FramingViewport) => number) | undefined }) {
  const size = useThree(state => state.size), camera = useThree(state => state.camera);
  const unit = Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
  const middle = camera.position.clone().setLength(SHEET_RADIUS + PLATE_CLEARANCE);
  return <OrbitControls makeDefault enablePan={false} enableRotate={false} target={middle} minDistance={unit / 30} maxDistance={unit / wheelFloor(radius, floor?.(size) ?? framing, size)} />;
}

function PaintWhileSeen({ watch }: { watch: ViewportWatch | undefined }) {
  const get = useThree(state => state.get);
  const canvas = useThree(state => state.gl.domElement);
  useEffect(() => paintWhileSeen(get, canvas, watch), [get, canvas, watch]);
  useEffect(() => redrawOnRestore(get, canvas), [get, canvas]);
  return null;
}

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

const CAPTURE_SEAM = '__storytreeCaptureGlobe';

const FIRST_SIZE_WAIT_MS = 50;

function drawnOnResize(state: () => RootState | undefined): typeof ResizeObserver {
  return class extends ResizeObserver {
    constructor(seen: ResizeObserverCallback) {
      let first: ReturnType<typeof setTimeout> | undefined;
      super((entries, observer) => {
        const before = state()?.size;
        if (before === undefined) {
          clearTimeout(first);
          first = setTimeout(() => seen(entries, observer), FIRST_SIZE_WAIT_MS);
          return;
        }
        flushSync(() => seen(entries, observer));
        flushSync(() => flushRoot(() => {}));
        const now = state();
        if (now !== undefined && now.size !== before && now.frameloop !== 'never') now.advance(performance.now());
      });
    }
  };
}

export function PlanetWorldCanvas({ scene, spots, storeSpots, radius, rotation = [0, 0, 0, 1], offset, globe, plateChildren, storeChildren, children, surface = true, surfaces, inside, framing = 1.18, floor, sideOffset = 0, lanes = NO_LANES, growth, sheet, hollow = false, onLanesNotice }: PlanetWorldCanvasProps) {
  const drawing = useRoadsWhenRouted(scene, spots, radius);
  const pathways = drawing.plan;
  const exterior = globeExterior(surface, surfaces);
  const noticeText = exterior.roads && drawing.issue ? `${pathways.lanes.edges.length > 0 ? 'Some lanes could not be drawn.' : 'Lanes could not be drawn.'} Island health and selection are still available.` : undefined;
  useEffect(() => onLanesNotice?.(noticeText === undefined ? undefined : { text: noticeText, issue: drawing.issue! }), [onLanesNotice, noticeText, drawing.issue]);
  const docks = useMemo(() => islandDocks(pathways, drawing.routing), [pathways, drawing.routing]);
  const docksOn = useCallback((story: string) => docks === undefined ? undefined : docks.get(story) ?? NO_DOCKS, [docks]);
  const selected = useMemo(() => litIsland(scene, lanes), [scene, lanes]);
  const sea = useMemo(() => {
    const spot = selected === undefined ? undefined : spots.get(selected);
    return seaLanes(pathways, lanes, selected === undefined || spot === undefined ? undefined : { story: selected, spot, radius });
  }, [pathways, lanes, selected, spots, radius]);
  const rest = useMemo(() => restLanes(pathways.lanes), [pathways.lanes]);
  const laneScale = useRef(1);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const position: [number, number, number] = [0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4];
  const root = useRef<() => RootState>(undefined);
  const made = useRef<{ rotation: typeof rotation; offset: typeof offset }>(undefined);
  made.current ??= { rotation, offset };
  const pose = globe === undefined ? { rotation, offset } : made.current;
  const resize = useMemo(() => ({ debounce: 0, polyfill: drawnOnResize(() => root.current?.()) }), []);
  const onCreated = useCallback(({ camera, get }: RootState) => {
    camera.lookAt(0, 0, 0);
    root.current = get;
    (globalThis as { [CAPTURE_SEAM]?: (state: () => RootState) => void })[CAPTURE_SEAM]?.(get);
  }, []);
  const watch = useMemo(viewportWatch, []);
  return <Canvas {...EXACT_COLOUR_CANVAS_PROPS} frameloop={startingFrameloop(watch)} resize={resize}
    camera={{ position, near: 0.1, far: radius * 10, fov: SHEET_FOV }} onCreated={onCreated}>
    <PaintWhileSeen watch={watch} />
    <color attach="background" args={['#101418']} />
    <Framing radius={radius} framing={framing} sideOffset={sideOffset} sheet={sheet} />
    <GrowthProvider growth={growth}>
    <group ref={globe ?? null} name="globe" quaternion={pose.rotation} position={pose.offset ?? ORIGIN}>
      <SheetGlass extent={sheet} clear={hollow} />
      {scene.islands.map(island => {
        const spot = spots.get(island.story);
        if (spot === undefined) throw new Error(`No planet spot for story ${island.story}`);
        return <Plate key={island.story} island={island} spot={spot} radius={radius} plate={pathways.plates.get(island.story)!} docks={docksOn(island.story)}
          ports={island.story === selected ? sea.ports : NO_PORTS} visible={exterior.plates} grounds={exterior.grounds} hollow={hollow} children={plateChildren} />;
      })}
      {scene.stores?.map(store => {
        const spot = storeSpots?.get(store.address);
        return spot === undefined ? null : <StorePlate key={store.address} store={store} spot={spot} radius={radius} visible={exterior.plates && !hollow} children={storeChildren} />;
      })}
      <group name="globe-lanes" visible={exterior.roads}><RestLanes stretches={rest} selected={sea.lanes.length > 0} scale={laneScale} /><SelectionLanes routes={sea.lanes} scale={laneScale} /></group>
      {inside}
    </group>
    <SheetLights />
    <Wheel radius={radius} framing={framing} floor={floor} />
    {children}
    </GrowthProvider>
    {noticeText !== undefined && onLanesNotice === undefined && <Overlay fullscreen zIndexRange={[45, 45]} style={{ pointerEvents: 'none' }}>
      <div role="alert" title={drawing.issue} style={{ position: 'absolute', right: 16, bottom: 16,
        maxWidth: 320, padding: '10px 14px', borderRadius: 6, background: '#352b20', color: '#ffe1ac' }}>
        {noticeText}
      </div>
    </Overlay>}
  </Canvas>;
}
