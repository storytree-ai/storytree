import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Vector3 } from 'three';
import type { PlanetPathways } from './pathways.js';
import { laneDrawSeconds, laneProgress, laneRoutes, type LitLink } from './lanes.js';

/** Physical-width strips follow the shell and ease onto the real shore, with no supporting land. */
function ribbon(route: { points: Vector3[]; width: number }, halo = false, lift = 0): BufferGeometry {
  const position: number[] = [], normal: number[] = [], index: number[] = [];
  const half = route.width * (halo ? 2.4 : 1) / 2;
  for (let i = 0; i < route.points.length; i++) {
    const radial = route.points[i]!.clone().normalize(), p = route.points[i]!.clone().addScaledVector(radial, lift);
    const tangent = route.points[Math.min(route.points.length - 1, i + 1)]!.clone().sub(route.points[Math.max(0, i - 1)]!);
    const side = radial.clone().cross(tangent).normalize().multiplyScalar(half);
    for (const sign of [-1, 1]) {
      position.push(...p.clone().addScaledVector(side, sign).toArray());
      normal.push(...radial.toArray());
    }
    if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

// Neither the road nor its light can occlude a name, claim marker or island selection ray.
const ignoreRay = () => {};

export function Pathways({ plan }: { plan: PlanetPathways }) {
  const meshes = useMemo(() => plan.segments.filter(segment => segment.island === undefined)
    .map(route => ({ route, geometry: ribbon(route), halo: ribbon(route, true) })), [plan]);
  useEffect(() => () => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.halo.dispose(); }), [meshes]);
  return <group name="pathways:cross-island" userData={{
    links: plan.edges.map(edge => ({ from: edge.from, to: edge.to })),
    segmentCount: plan.segments.length,
    localSegmentCount: plan.segments.filter(segment => segment.island !== undefined).length,
  }}>{meshes.map(({ route, geometry, halo }) => <group key={route.id}>
    <mesh name={`pathway:${route.id}`} geometry={geometry} raycast={ignoreRay}
      userData={{ links: route.links, widthGround: route.width }}>
      <meshBasicMaterial color="#c7bba1" side={DoubleSide} />
    </mesh>
    <mesh name={`pathway-halo:${route.id}`} geometry={halo} raycast={ignoreRay}>
      <meshBasicMaterial color="#dacaaa" transparent opacity={0.10} depthWrite={false} side={DoubleSide} forceSinglePass />
    </mesh>
  </group>)}</group>;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A selected story's lit links (world 6.8–6.9): each lane rides just above its road and draws on from the
 * capability built on, at constant speed; a new selection draws its lanes again. */
export function SelectionLanes({ plan, lit }: { plan: PlanetPathways; lit: readonly LitLink[] }) {
  const lanes = useMemo(() => laneRoutes(plan, lit).map(lane => ({ lane, geometry: ribbon(lane, false, 0.12),
    seconds: laneDrawSeconds(lane.length) })), [plan, lit]);
  useEffect(() => () => lanes.forEach(({ geometry }) => geometry.dispose()), [lanes]);
  const { clock, invalidate } = useThree();
  const started = useRef({ lanes, at: clock.getElapsedTime(), reduced: reducedMotion() });
  if (started.current.lanes !== lanes) started.current = { lanes, at: clock.getElapsedTime(), reduced: reducedMotion() };
  const reveal = () => {
    const { at, reduced } = started.current;
    let drawing = false;
    for (const { geometry, seconds } of lanes) {
      const progress = laneProgress(clock.getElapsedTime() - at, seconds, reduced);
      const quads = (geometry.index?.count ?? 0) / 6;
      geometry.setDrawRange(0, Math.round(progress * quads) * 6);
      drawing ||= progress < 1;
    }
    // The canvas draws on demand: keep asking for frames only while a lane is still drawing.
    if (drawing) invalidate();
  };
  useEffect(() => { reveal(); }, [lanes]);
  useFrame(reveal);
  return <group name="pathways:selection-lanes" userData={{ lanes: lanes.map(({ lane, seconds }) =>
    ({ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, seconds })) }}>
    {lanes.map(({ lane, geometry }) => <mesh key={`${lane.from}->${lane.to}`} name={`lane:${lane.dir}:${lane.from}->${lane.to}`}
      geometry={geometry} raycast={ignoreRay} renderOrder={2}>
      <meshBasicMaterial color={lane.colour} transparent opacity={0.95} depthWrite={false} side={DoubleSide}
        polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>)}
  </group>;
}
