// Throwaway look instrument. No product routing or app behaviour is changed.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ColorManagement, DirectionalLight, Group, Mesh, Quaternion, ShaderChunk,
  ShaderMaterial, Vector3, type MeshStandardMaterial,
} from 'three';
import { forestDescriptors, GROUND_PER_WORLD_UNIT, islandReach, type Descriptor3D } from '@storytree/forest-world';
import { type ForestScene, type Island } from '@storytree/forest';
import {
  SpikeCellGround, SpikeKitProps, SPIKE_GROUND_INPUT, preloadKit, shippedGroundBuild,
} from '@storytree/forest-world/canvas';
import { cellGroundGeometry } from '../../../packages/forest-world/src/cell-ground-geometry.js';
import { createGroundInputCache } from '../../../packages/forest-world/src/ground-dependency.js';
import { createGrowthTexture } from '../../../packages/forest-world/src/ForestWorldCanvas.growth-material.js';
import { EXACT_COLOUR_CANVAS_PROPS } from '../../../packages/forest-world/src/exact-colour.js';
import { calibrateLights, intensitiesFor } from '../../../packages/forest-world/src/light-calibration.js';
import { LIGHT_DIRECTION } from '../../../packages/forest-world/src/shade-ladder.js';
import { frameWorld, restingWorldFraming, SHIPPED_ELEVATION_DEG } from '../../../packages/forest-world/src/camera-framing.js';
import { landHeightRange } from '../../../packages/forest-world/src/land-relief.js';
import { SHORE_DIP } from '../../../packages/forest-world/src/shore-fall.js';
import kitBytes from '@storytree/forest-world/assets/dressing-kit.glb';

type Lighting = 'L1' | 'L2' | 'L3';
const params = new URLSearchParams(location.search);
const lighting = (params.get('light') ?? 'L1') as Lighting;
const turn = Number(params.get('turn') ?? 0);
const synthetic = params.has('synthetic');
const rim = params.has('rim');
const RADIUS = 210;
// Relief has negative heights. A tangent sea at the y=0 datum cuts holes through the
// existing ground. Keep its entire top surface above water, leaving its skirt to dip in.
const CLEARANCE = Math.max(landHeightRange(), SHORE_DIP) + 0.1;
const PLATE_RADIUS = RADIUS + CLEARANCE;
const UP = new Vector3(0, 1, 0);
const SUN = new Vector3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z).normalize();
const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
const EYE = new Vector3(0, Math.sin(elevation), Math.cos(elevation));
// The starting camera is the flat forest's camera. A camera-attached sun must agree at rest.
const restCamera = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -elevation);
const SUN_IN_VIEW = SUN.clone().applyQuaternion(restCamera.clone().invert());
const ready = new Set<string>();
const stats: Record<string, unknown> = { lighting, turn, synthetic, radius: RADIUS, clearance: CLEARANCE, plateRadius: PLATE_RADIUS, ready: false };
(window as any).planetLook = stats;

function patchOnce(source: string, from: string, to: string) {
  if (!source.includes(from)) throw new Error(`Planet spike shader anchor missing: ${from}`);
  return source.replace(from, to);
}

/** One scene owns one ambient and directional light, at the original calibrated strengths. */
function Lights({ mode }: { mode: Lighting | 'flat' }) {
  const gl = useThree(s => s.gl);
  const lit = useMemo(() => intensitiesFor(calibrateLights(gl)), [gl]);
  const key = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    const worldSun = mode === 'L1' ? SUN_IN_VIEW.clone().applyQuaternion(camera.quaternion) : SUN;
    key.current!.position.copy(worldSun).multiplyScalar(1000);
    key.current!.updateMatrixWorld();
  }, -2);
  return <><ambientLight intensity={lit.ambient} /><directionalLight ref={key} intensity={lit.directional} position={SUN.clone().multiplyScalar(1000).toArray()} /></>;
}

/** The shader's material fields and steepness mask must travel with the plate, not the globe. */
function patchGround(material: ShaderMaterial) {
  material.vertexShader = patchOnce(material.vertexShader,
    'vNormal = normalize(mat3(modelMatrix) * normal);', 'vNormal = normalize(normal);');
  material.vertexShader = patchOnce(material.vertexShader,
    'vWorld = (modelMatrix * vec4(position, 1.0)).xyz;', 'vWorld = position;');
  material.needsUpdate = true;
}

/** Group-scoped lights do not exist in Three. A per-material direction supplies L2 without
 * N suns illuminating every tree. Keep the kit's status and growth hooks, and its full BRDF. */
function patchKit(material: MeshStandardMaterial) {
  const direction = { value: new Vector3() };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.uPlateLightView = direction;
    shader.fragmentShader = patchOnce(shader.fragmentShader, '#include <common>', '#include <common>\nuniform vec3 uPlateLightView;');
    const lightChunk = patchOnce(ShaderChunk.lights_fragment_begin,
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n directLight.direction = uPlateLightView;');
    shader.fragmentShader = patchOnce(shader.fragmentShader, '#include <lights_fragment_begin>', lightChunk);
  };
  material.customProgramCacheKey = () => `${previousKey()}|planet-look-local-light-v1`;
  material.needsUpdate = true;
  return direction;
}

function Plate({ descriptors, id, mode, position, rotation, title, label }: {
  descriptors: Descriptor3D[]; id: string; mode: Lighting | 'flat';
  position?: Vector3; rotation?: Quaternion; title?: string; label?: boolean;
}) {
  const group = useRef<Group>(null);
  const ground = useMemo(() => createGroundInputCache(SPIKE_GROUND_INPUT)(descriptors), [descriptors]);
  const growth = useMemo(() => createGrowthTexture(ground.growthLayout.size + 1), [ground]);
  const [settled, setSettled] = useState(false);
  const onSettled = useCallback(() => setSettled(true), []);
  const patched = useRef(new Map<ShaderMaterial | MeshStandardMaterial, { value: Vector3 } | null>());
  useEffect(() => () => growth.texture.dispose(), [growth]);
  useFrame(({ camera, gl }) => {
    if (!group.current) return;
    group.current.updateWorldMatrix(true, true);
    const quaternion = group.current.getWorldQuaternion(new Quaternion());
    const worldSun = mode === 'L2' ? SUN.clone().applyQuaternion(quaternion)
      : mode === 'L1' ? SUN_IN_VIEW.clone().applyQuaternion(camera.quaternion) : SUN.clone();
    const localSun = worldSun.clone().applyQuaternion(quaternion.clone().invert());
    const viewSun = worldSun.clone().transformDirection(camera.matrixWorldInverse);
    ((stats.lightDirections ??= {}) as any)[id] = { world: worldSun.toArray(), local: localSun.toArray(), view: viewSun.toArray(), groundRevision: ground.revision };
    group.current.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as ShaderMaterial | MeshStandardMaterial;
      if (!patched.current.has(material)) {
        if (material instanceof ShaderMaterial) {
          patchGround(material);
          patched.current.set(material, null);
          const points = object.geometry.getAttribute('position');
          let radius = 0;
          let rimPoint = new Vector3();
          let projected = 0;
          for (let i = 0; i < points.count; i++) {
            const x = points.getX(i), z = points.getZ(i);
            if (Math.hypot(x, z) > radius) { radius = Math.hypot(x, z); rimPoint.set(x, 0, z); }
            if (mode !== 'flat') {
              const platePoint = new Vector3(x, 0, z).applyMatrix4(group.current!.matrixWorld);
              const seaPoint = platePoint.clone().normalize().multiplyScalar(RADIUS);
              const a = platePoint.clone().project(camera), b = seaPoint.project(camera);
              projected = Math.max(projected, Math.hypot((a.x-b.x)*gl.domElement.clientWidth/2, (a.y-b.y)*gl.domElement.clientHeight/2));
            }
          }
          ((stats.plates ??= {}) as any)[id] = { radius, rimPoint: rimPoint.toArray(), projectedGapPx: projected,
            radialLift: Math.hypot(PLATE_RADIUS, radius) - PLATE_RADIUS,
            datumGap: Math.hypot(PLATE_RADIUS, radius) - RADIUS,
            vertices: points.count, groundBuildRevision: ground.revision };
        } else patched.current.set(material, patchKit(material));
      }
      if (material instanceof ShaderMaterial) material.uniforms.uLightDir.value.copy(localSun);
      else patched.current.get(material)!.value.copy(viewSun);
    });
    if (settled) ready.add(id);
  }, -1);
  return <group ref={group} position={position} quaternion={rotation}>
    <SpikeCellGround ground={ground} growth={growth} />
    <SpikeKitProps placements={ground.placements} alphaByPlacement={new Map()} islandByPlacement={ground.islandByPlacement}
      layout={ground.growthLayout} growth={growth} targets={null} onTargets={undefined} onSettled={onSettled} />
    {label && <Html portal={{ current: document.getElementById('globe-labels')! }} center position={[0, 30, 0]} occlude style={{ pointerEvents: 'none' }}><div className="label">{title}</div></Html>}
  </group>;
}

/** Temporary exponential wrap, same flat spiral, with a fixed radius and no packing promises. */
function spot(island: Island) {
  const x = island.x * GROUND_PER_WORLD_UNIT, z = island.z * GROUND_PER_WORLD_UNIT;
  const distance = Math.hypot(x, z), angle = distance / RADIUS;
  const normal = distance === 0 ? UP.clone() : new Vector3(Math.sin(angle)*x/distance, Math.cos(angle), Math.sin(angle)*z/distance);
  return { position: normal.clone().multiplyScalar(PLATE_RADIUS), rotation: new Quaternion().setFromUnitVectors(UP, normal) };
}

function CameraSetup({ target, zoom, control = false }: { target: Vector3; zoom: number; control?: boolean }) {
  const camera = useThree(s => s.camera);
  useEffect(() => {
    camera.position.copy(target).addScaledVector(EYE, 1800);
    camera.lookAt(target); camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (control) (window as any).orbitLookEye = (degrees: number) => {
      const eye = EYE.clone().applyAxisAngle(new Vector3(0, Math.cos(elevation), -Math.sin(elevation)), degrees*Math.PI/180);
      camera.position.copy(target).addScaledVector(eye, 1800);
      camera.lookAt(target); camera.updateMatrixWorld();
    };
  }, [camera, target, zoom, control]);
  return null;
}

function Completion({ count, side }: { count: number; side: string }) {
  const frames = useRef(0);
  useFrame(({ gl, scene, camera }) => {
    if (ready.size < count) return;
    if (++frames.current === 4) {
      gl.getContext().finish();
      ((stats.sides ??= {}) as any)[side] = { calls: gl.info.render.calls, triangles: gl.info.render.triangles,
        camera: camera.position.toArray(), zoom: camera.zoom, canvases: document.querySelectorAll('canvas').length,
        renderer: gl.getContext().getParameter(gl.getContext().RENDERER),
        unmaskedRenderer: gl.getContext().getParameter(gl.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL) };
      stats.ready = Object.keys(stats.sides as object).length === 2;
    }
  });
  return null;
}

async function main() {
  // Match the Canvas's exact-colour mode BEFORE parsing the shared kit's materials.
  ColorManagement.enabled = false;
  stats.stage = 'kit loading';
  await preloadKit(kitBytes);
  stats.stage = 'kit loaded';
  const forests = await fetch('/forests.json').then(r => r.json());
  const forest: ForestScene = synthetic ? forests.synthetic : forests.own;
  const descriptors = forestDescriptors(forest);
  const width = document.getElementById('flat')!.clientWidth, height = document.getElementById('flat')!.clientHeight;
  const frame = restingWorldFraming(descriptors.filter(d => d.kind !== 'skipped'), { width, height });
  const bounds = descriptors.reduce((box, d) => {
    if (d.kind === 'cell-ground') for (const p of d.points ?? []) {
      box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x);
      box.minZ = Math.min(box.minZ, p.z); box.maxZ = Math.max(box.maxZ, p.z);
    }
    return box;
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const flatFit = Math.min((width-120)/(bounds.maxX-bounds.minX), (height-180)/((bounds.maxZ-bounds.minZ)*Math.sin(elevation)+24));
  const zoom = rim ? frame.resting.scale : Math.min(frame.resting.scale, (Math.min(width, height)-110)/(2*PLATE_RADIUS+60), synthetic ? flatFit : Infinity);
  stats.zoom = zoom; stats.viewport = { width, height }; stats.stories = forest.islands.length;
  stats.trees = forest.islands.reduce((sum, island) => sum + island.trees.length, 0);
  stats.resting = frame.resting;
  const plates = forest.islands.map(island => ({ island, descriptors: forestDescriptors({ islands: [{
    ...island, x: 0, z: 0, trees: island.trees.map(tree => ({ ...tree, x: tree.x-island.x, z: tree.z-island.z })),
  }] }), ...spot(island) }));
  stats.stage = 'descriptors ready';
  let shownPlates = plates;
  let flatDescriptors = descriptors;
  let measurement: { from: Vector3; to: Vector3 } | undefined;
  let globeTarget = new Vector3();
  let target = new Vector3(...frameWorld(descriptors.filter(d => d.kind !== 'skipped')).target);
  if (synthetic) target.set((bounds.minX+bounds.maxX)/2, 0, (bounds.minZ+bounds.maxZ)/2);
  if (rim) {
    const biggest = [...plates].sort((a, b) => {
      const radius = (plate: typeof a) => islandReach(plate.descriptors, new Map([[plate.island.story, { x: 0, z: 0 }]])).get(plate.island.story)!;
      return radius(b) - radius(a);
    })[0]!;
    const ground = createGroundInputCache(SPIKE_GROUND_INPUT)(biggest.descriptors);
    const built = shippedGroundBuild(ground.cells, ground.casters, ground.strips);
    const positions = cellGroundGeometry(built.input).positions;
    const farthest = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.hypot(positions[i]!, positions[i+2]!) > farthest.length()) farthest.set(positions[i]!, 0, positions[i+2]!);
    }
    const normal = new Vector3(1, 0, 0), screenUp = new Vector3(0, Math.cos(elevation), -Math.sin(elevation));
    const upToNormal = new Quaternion().setFromUnitVectors(UP, normal);
    const from = farthest.clone().normalize().applyQuaternion(upToNormal);
    const angle = Math.atan2(normal.dot(from.clone().cross(screenUp)), from.dot(screenUp));
    const rotation = new Quaternion().setFromAxisAngle(normal, angle).multiply(upToNormal);
    const position = normal.clone().multiplyScalar(PLATE_RADIUS);
    const rimPoint = farthest.clone().applyQuaternion(rotation).add(position);
    measurement = { from: rimPoint.clone().normalize().multiplyScalar(RADIUS), to: rimPoint };
    shownPlates = [{ ...biggest, position, rotation }];
    flatDescriptors = biggest.descriptors;
    target = new Vector3();
    globeTarget = position.clone().add(new Vector3(-35, 0, 0));
    const curvature = Math.hypot(PLATE_RADIUS, farthest.length()) - PLATE_RADIUS;
    stats.rim = { story: biggest.island.story, radius: farthest.length(), curvatureLiftPx: curvature*zoom,
      clearancePx: CLEARANCE*zoom, totalDatumGapPx: (curvature+CLEARANCE)*zoom, restingZoom: zoom,
      definition: 'Radial distance from the outermost mesh footprint at local y=0 to the concentric sphere; shown edge-on. Surface relief and skirt depth are excluded.' };
    document.getElementById('measure')!.textContent = `Library rim: ${(curvature*zoom).toFixed(1)} px from curvature + ${(CLEARANCE*zoom).toFixed(1)} px clearance = ${((curvature+CLEARANCE)*zoom).toFixed(1)} px to the water at the plate datum.`;
  }
  const count = shownPlates.length + 1;
  const turnRotation = new Quaternion().setFromAxisAngle(new Vector3(0, Math.cos(elevation), -Math.sin(elevation)), turn * Math.PI / 180);
  const modeCaption = lighting === 'L1' ? 'Light follows your eye' : lighting === 'L2' ? 'Each island keeps its own light' : `Fixed sun · globe turned ${turn}°`;
  document.getElementById('title')!.textContent = `Storytree on a globe · ${synthetic ? '36-story synthetic forest' : 'the five stories of 0.3'} · ${lighting}`;
  document.getElementById('subtitle')!.textContent = synthetic ? 'Fictional work states: green, building yellow, pale and failing. Same island scale on both sides.' : 'Agent link, app, arc surface, forest and library. Fresh-seed work states: planned yellow.';
  document.getElementById('flat-note')!.textContent = `${rim ? 'Resting' : 'Comparison'} scale · ${zoom.toFixed(3)} px per ground unit`;
  document.getElementById('globe-caption')!.innerHTML = `${modeCaption}<small>Same scale · opaque sea · flat island plates</small>`;
  document.getElementById('footer')!.textContent = 'Look test, 27 September 2026 · Temporary placement, radius 210 ground units. The original paint, trees and light strengths are retained. Ground cast shadows keep their original direction; these frames compare the changing surface light. This is not a proposed placement rule.';
  if (rim) {
    document.getElementById('title')!.textContent = 'The largest island’s rim · library · 13 capability trees';
    document.getElementById('subtitle')!.textContent = 'The same library plate, flat on the left and edge-on against the globe on the right. Actual resting scale, no enlarged pixels.';
    document.getElementById('globe-caption')!.innerHTML = 'Library at the globe’s edge<small>The cyan line measures the plate datum to the water</small>';
    document.getElementById('footer')!.textContent = `Curvature-only rim lift: ${((stats.rim as any).curvatureLiftPx).toFixed(1)} pixels at ${zoom.toFixed(3)} px per ground unit. Sea radius 210; plate datum ${PLATE_RADIUS.toFixed(3)}; outer footprint radius ${((stats.rim as any).radius).toFixed(3)} ground units. The clearance keeps the original low terrain above water. Relief and the hanging skirt are excluded from the datum measurement.`;
  }
  createRoot(document.getElementById('flat')!).render(<Canvas orthographic {...EXACT_COLOUR_CANVAS_PROPS} dpr={1}
    camera={{ position: EYE.clone().multiplyScalar(1800).toArray(), near: 0.1, far: 5000, zoom }}>
    <color attach="background" args={['#101418']} /><CameraSetup target={target} zoom={zoom} /><Lights mode="flat" />
    <Plate descriptors={flatDescriptors} id="flat" mode="flat" />
    {!synthetic && !rim && forest.islands.map(island => <Html portal={{ current: document.getElementById('flat-labels')! }} key={island.story} center position={[island.x*GROUND_PER_WORLD_UNIT, 30, island.z*GROUND_PER_WORLD_UNIT]}><div className="label">{island.title}</div></Html>)}
    <Completion count={count} side="flat" />
  </Canvas>);
  createRoot(document.getElementById('globe')!).render(<Canvas orthographic {...EXACT_COLOUR_CANVAS_PROPS} dpr={1}
    camera={{ position: EYE.clone().multiplyScalar(1800).toArray(), near: 0.1, far: 5000, zoom }}>
    <color attach="background" args={['#080c10']} /><CameraSetup target={globeTarget} zoom={zoom} control /><Lights mode={lighting} />
    <mesh><sphereGeometry args={[RADIUS, 128, 96]} /><meshBasicMaterial color="#101418" /></mesh>
    <group quaternion={turnRotation}>
      {shownPlates.map(({ island, descriptors, position, rotation }) => <Plate key={island.story} id={island.story} descriptors={descriptors}
        mode={lighting} position={position} rotation={rotation} title={island.title} label={!synthetic && !rim} />)}
    </group>
    {measurement && <Line points={[measurement.from, measurement.to]} color="#67e8df" lineWidth={3} depthTest={false} />}
    <OrbitControls target={globeTarget} enablePan={false} enableDamping={false} />
    <Completion count={count} side="globe" />
  </Canvas>);
}
main().catch(error => { console.error(error); document.body.dataset.error = String(error); });
