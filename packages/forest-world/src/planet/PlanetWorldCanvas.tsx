import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DirectionalLight, Group, Quaternion, Vector3, type Camera } from 'three';
import type { ForestScene, Island } from '@storytree/forest';
import { CellGround, KitProps, SHIPPED_GROUND_INPUT, preloadKit } from '../ForestWorldCanvas.js';
import { forestDescriptors } from '../forest-ground/forest-ground.js';
import type { Descriptor3D } from '../world-to-3d.js';
import { createGroundInputCache } from '../ground-dependency.js';
import { createGrowthTexture } from '../ForestWorldCanvas.growth-material.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../exact-colour.js';
import { calibrateLights, intensitiesFor } from '../light-calibration.js';
import { SHIPPED_ELEVATION_DEG, orthographicZoomFor } from '../camera-framing.js';
import { lightForCamera, plateTransform, type PlanetSpot } from './planet.js';
import type { KitPlacement } from '../kit-vocabulary.js';

export type { PlanetSpot } from './planet.js';
export { plateTransform, PLATE_CLEARANCE } from './planet.js';

export interface PlanetWorldCanvasProps {
  scene: ForestScene;
  /** One unit direction per story; placement and capacity belong to lane A. */
  spots: ReadonlyMap<string, PlanetSpot>;
  /** Fixed radius from the placement rule, in the ported engine's ground units. */
  radius: number;
  kitBytes?: Uint8Array;
  /** A host can turn the globe toward a failing story without rebuilding the plates. */
  rotation?: [number, number, number, number];
  /** Names, selection and claim markers mount in each plate's local ground coordinates. */
  plateChildren?: (island: Island, descriptors: readonly Descriptor3D[]) => ReactNode;
  /** R3F children can use the default orbit controls for host-driven focus. */
  children?: ReactNode;
  /** False hides the sea and every plate, for looking inside the globe (the knowledge core, E1). */
  surface?: boolean;
  /** Drawn inside the turning globe, in its own coordinates: the knowledge core. */
  inside?: ReactNode;
}

const ALPHA: ReadonlyMap<KitPlacement, number> = new Map();
const settled = () => {};

const Plate = memo(function Plate({ island, spot, radius, children }: {
  island: Island; spot: PlanetSpot; radius: number;
  children: PlanetWorldCanvasProps['plateChildren'];
}) {
  const group = useRef<Group>(null);
  const transform = useMemo(() => plateTransform(spot, radius), [spot.x, spot.y, spot.z, radius]);
  const descriptors = useMemo(() => forestDescriptors({ islands: [{
    ...island, x: 0, z: 0,
    trees: island.trees.map(tree => ({ ...tree, x: tree.x - island.x, z: tree.z - island.z })),
  }] }), [island]);
  const cache = useMemo(() => createGroundInputCache(SHIPPED_GROUND_INPUT), []);
  const ground = cache(descriptors);
  const growth = useMemo(() => createGrowthTexture(ground.growthLayout.size + 1), [ground]);
  useEffect(() => () => growth.texture.dispose(), [growth]);
  const localLight = useMemo(() => new Vector3(), []);
  const inversePlate = useMemo(() => new Quaternion(), []);
  // Controls update at -1; lights then follow the new eye before the renderer draws.
  useFrame(({ camera }) => {
    if (group.current === null) return;
    group.current.getWorldQuaternion(inversePlate).invert();
    lightForCamera(camera.quaternion, localLight).applyQuaternion(inversePlate);
  });
  return <group ref={group} position={transform.position} quaternion={transform.quaternion} name={`planet:${island.story}`}>
    <CellGround ground={ground} growth={growth} plateLight={localLight} />
    <KitProps placements={ground.placements} alphaByPlacement={ALPHA} islandByPlacement={ground.islandByPlacement}
      layout={ground.growthLayout} growth={growth} targets={null} onTargets={undefined} onSettled={settled} />
    {children?.(island, descriptors)}
  </group>;
});

function Lights() {
  const gl = useThree(s => s.gl);
  const lit = useMemo(() => intensitiesFor(calibrateLights(gl)), [gl]);
  const key = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    if (key.current === null) return;
    lightForCamera(camera.quaternion, key.current.position).multiplyScalar(1000);
    key.current.updateMatrixWorld();
  });
  return <><ambientLight intensity={lit.ambient} /><directionalLight ref={key} intensity={lit.directional} /></>;
}

function Framing({ radius }: { radius: number }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    camera.zoom = orthographicZoomFor(radius * 1.18, Math.min(size.width, size.height));
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, radius, size.width, size.height, invalidate]);
  return null;
}

/** A second mount of 0.2's ground and pines: one Canvas and one calibrated sun for all plates.
 * The flat ForestWorldCanvas retains its own camera, controls, material defaults and lighting. */
export function PlanetWorldCanvas({ scene, spots, radius, rotation = [0, 0, 0, 1], kitBytes, plateChildren, children, surface = true, inside }: PlanetWorldCanvasProps) {
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  const position: [number, number, number] = [0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4];
  const onCreated = useCallback(({ camera }: { camera: Camera }) => {
    camera.lookAt(0, 0, 0);
    // Canvas has configured exact colour before parsing the shared kit's materials.
    // KitProps reports a load failure and still lets the ground draw, as the flat mount does.
    if (kitBytes !== undefined) void preloadKit(kitBytes).catch(() => {});
  }, [kitBytes]);
  return <Canvas orthographic {...EXACT_COLOUR_CANVAS_PROPS} frameloop="demand"
    camera={{ position, near: 0.1, far: radius * 10 }} onCreated={onCreated}>
    <color attach="background" args={['#101418']} />
    <Lights />
    <Framing radius={radius} />
    <group quaternion={rotation}>
      {surface && <mesh name="planet:sea">
        <sphereGeometry args={[radius, 96, 64]} />
        <meshStandardMaterial color="#101418" roughness={1} />
      </mesh>}
      {surface && scene.islands.map(island => {
        const spot = spots.get(island.story);
        if (spot === undefined) throw new Error(`No planet spot for story ${island.story}`);
        return <Plate key={island.story} island={island} spot={spot} radius={radius} children={plateChildren} />;
      })}
      {inside}
    </group>
    <OrbitControls makeDefault enablePan={false} minZoom={0.1} maxZoom={30} />
    {children}
  </Canvas>;
}
