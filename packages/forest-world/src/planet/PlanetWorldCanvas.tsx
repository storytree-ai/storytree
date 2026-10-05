import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3, type Group, type OrthographicCamera } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { planetPathwayDrawing, type PlanetPathwayPlate } from './pathways.js';
import { Pathways, SelectionLanes } from './PlanetTrailRibbons.js';
import type { LitLink } from './lanes.js';
import type { Descriptor3D } from '../descriptors.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../exact-colour.js';
import { SHIPPED_ELEVATION_DEG } from './camera.js';
import { createPlanetSurface, plateTransform, type PlanetSpot } from './planet.js';
import { disposeIslandSurface, islandSurface } from './island-surface.js';
import { applyPlanetFraming, applyPlanetSideOffset } from './camera.js';
import { GrowthProvider, usePlanetGrowth, type PlanetGrowth } from './PlanetGrowth.js';
import { plateGrowth, roadSegmentWindows } from './growth.js';
import { paintWhileSeen, startingFrameloop, viewportWatch, type ViewportWatch } from './paint-while-seen.js';

export type { PlanetSpot } from './planet.js';
export { globeOccluder, plateTransform, PLATE_CLEARANCE } from './planet.js';
export { islandNormal, onIslandSurface } from './island-surface.js';
export { applyPlanetFraming, applyPlanetSideOffset } from './camera.js';
/** The eye's height above the globe's equator, in degrees: a host turns what it shows toward it. */
export { SHIPPED_ELEVATION_DEG } from './camera.js';
export { usePlanetGrowth, type GrowthReader, type PlanetGrowth } from './PlanetGrowth.js';
export { crossingLength, growthMoment, growthPlan, type GrowthOptions, type GrowthPlan, type GrowthStage } from './growth.js';

/** Exterior surfaces owned by the engine. The host owns the marks placed on each island. */
export interface PlanetSurfaceVisibility {
  sea: boolean;
  grounds: boolean;
  roads: boolean;
}

export interface PlanetWorldCanvasProps {
  scene: ForestScene;
  /** One unit direction per story; placement and capacity belong to lane A. */
  spots: ReadonlyMap<string, PlanetSpot>;
  /** Fixed radius from the placement rule, in the ported engine's ground units. */
  radius: number;
  /** A host can turn the globe toward a failing story without rebuilding the plates. */
  rotation?: [number, number, number, number];
  /** Names, selection and claim markers mount in each plate's local ground coordinates. */
  plateChildren?: (island: Island, descriptors: readonly Descriptor3D[], coast: readonly (readonly { x: number; z: number }[])[]) => ReactNode;
  /** R3F children can use the default orbit controls for host-driven focus. */
  children?: ReactNode;
  /** False hides the sea and every plate, for looking inside the globe (the knowledge core, E1). */
  surface?: boolean;
  /** Independent exterior switches, all true by default; surface=false still hides the whole exterior. */
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
  /** A recorded growth to replay (world 7): islands rise, roads draw on, and plate children read `usePlanetGrowth`. */
  growth?: PlanetGrowth | undefined;
}

const NO_LANES: readonly LitLink[] = [];

/** How far below its resting place an island starts, in ground units: it rises out of the glass. */
const RISE_DEPTH = 6;

const Plate = memo(function Plate({ island, spot, radius, plate, visible, grounds, children }: {
  island: Island; spot: PlanetSpot; radius: number; plate: PlanetPathwayPlate;
  visible: boolean; grounds: boolean;
  children: PlanetWorldCanvasProps['plateChildren'];
}) {
  const transform = useMemo(() => plateTransform(spot, radius), [spot.x, spot.y, spot.z, radius]);
  const { descriptors, coast } = plate;
  // ADR-0804 D1: the island is one flat, pale, see-through surface with a coast line, and nothing else.
  const ground = useMemo(() => islandSurface(coast, radius, island.story), [coast, radius, island.story]);
  useEffect(() => () => disposeIslandSurface(ground), [ground]);
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

function Framing({ radius, framing, sideOffset }: { radius: number; framing: number; sideOffset: number }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    applyPlanetFraming(camera as OrthographicCamera, radius, framing, size);
    invalidate();
  }, [camera, radius, framing, size.width, size.height, invalidate]);
  // Keeping these effects separate lets a card move without resetting wheel/pinch zoom.
  useLayoutEffect(() => {
    applyPlanetSideOffset(camera as OrthographicCamera, size, sideOffset);
    invalidate();
  }, [camera, sideOffset, size.width, size.height, invalidate]);
  return null;
}

/** World 6.10: the globe draws only while some of its canvas is on screen, however busy its animations are. */
function PaintWhileSeen({ watch }: { watch: ViewportWatch | undefined }) {
  const get = useThree(state => state.get);
  const canvas = useThree(state => state.gl.domElement);
  useEffect(() => paintWhileSeen(get, canvas, watch), [get, canvas, watch]);
  return null;
}

/** The one dev-only seam an evidence capture observes the globe through: a capture build sets this global
 * before the page runs and is handed the canvas's live state getter. Nothing in the product sets it. */
const CAPTURE_SEAM = '__storytreeCaptureGlobe';

/** The globe: one Canvas, the see-through sea, and each story's island as a flat surface with a coast
 * (ADR-0804 D1). Nothing on it is lit, so there is no sun to calibrate. */
export function PlanetWorldCanvas({ scene, spots, radius, rotation = [0, 0, 0, 1], plateChildren, children, surface = true, surfaces, inside, framing = 1.18, sideOffset = 0, orbit = true, lanes = NO_LANES, growth }: PlanetWorldCanvasProps) {
  const drawing = useMemo(() => planetPathwayDrawing(scene, spots, radius), [scene, spots, radius]);
  const pathways = drawing.plan;
  const reveal = useMemo(() => growth === undefined ? undefined : roadSegmentWindows(pathways, growth.plan.roads), [pathways, growth?.plan]);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const position: [number, number, number] = [0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4];
  const onCreated = useCallback(({ camera, get }: RootState) => {
    camera.lookAt(0, 0, 0);
    (globalThis as { [CAPTURE_SEAM]?: (state: () => RootState) => void })[CAPTURE_SEAM]?.(get);
  }, []);
  const watch = useMemo(viewportWatch, []);
  return <Canvas orthographic {...EXACT_COLOUR_CANVAS_PROPS} frameloop={startingFrameloop(watch)}
    camera={{ position, near: 0.1, far: radius * 10 }} onCreated={onCreated}>
    <PaintWhileSeen watch={watch} />
    <color attach="background" args={['#101418']} />
    <Framing radius={radius} framing={framing} sideOffset={sideOffset} />
    <GrowthProvider growth={growth}>
    <group name="globe" quaternion={rotation}>
      <Surface radius={radius} visible={surface && surfaces?.sea !== false} />
      {scene.islands.map(island => {
        const spot = spots.get(island.story);
        if (spot === undefined) throw new Error(`No planet spot for story ${island.story}`);
        return <Plate key={island.story} island={island} spot={spot} radius={radius} plate={pathways.plates.get(island.story)!}
          visible={surface} grounds={surfaces?.grounds !== false} children={plateChildren} />;
      })}
      <group name="globe-roads" visible={surface && surfaces?.roads !== false}><Pathways plan={pathways} reveal={reveal} /><SelectionLanes plan={pathways} lit={lanes} /></group>
      {inside}
    </group>
    <OrbitControls makeDefault enablePan={false} enableRotate={orbit} minZoom={0.1} maxZoom={30} />
    {/* The host's children read the growth too (usePlanetGrowth), as the plates and the inside do. */}
    {children}
    </GrowthProvider>
    {surface && surfaces?.roads !== false && drawing.issue && <Html fullscreen zIndexRange={[45, 45]} style={{ pointerEvents: 'none' }}>
      <div role="alert" title={drawing.issue} style={{ position: 'absolute', right: 16, bottom: 16,
        maxWidth: 320, padding: '10px 14px', borderRadius: 6, background: '#352b20', color: '#ffe1ac' }}>
        Pathways could not be drawn. Island health and selection are still available.
      </div>
    </Html>}
  </Canvas>;
}
