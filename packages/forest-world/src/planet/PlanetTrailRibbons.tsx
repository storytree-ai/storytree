/** Capability 6 · The planet. */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Vector3 } from 'three';
import type { PlanetPathways } from './pathways.js';
import { growthProgress, roadSegmentWindows, segmentDrawRange, type GrowthWindow } from './growth.js';
import { usePlanetGrowth } from './PlanetGrowth.js';
import { advanceLaneClock, laneDrawSeconds, laneProgress, laneRoutes, type LitLink } from './lanes.js';
import { liveRoadProgress, nextLiveRoads } from './live-roads.js';

const ribbonShapes = new WeakMap<BufferGeometry, {
  position: Float32Array; distances: number[]; movedPair: number | undefined;
}>();

/** Physical-width strips follow the shell and ease onto the real shore, with no supporting land. */
export function ribbon(route: { points: Vector3[]; width: number }, halo = false, lift = 0): BufferGeometry {
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
  const distances = route.points.map(() => 0);
  for (let i = 1; i < route.points.length; i++) distances[i] = distances[i - 1]! + route.points[i]!.distanceTo(route.points[i - 1]!);
  ribbonShapes.set(geometry, { position: new Float32Array(position), distances, movedPair: undefined });
  // Culling uses the complete strip even while its front is between two stations.
  geometry.computeBoundingSphere();
  return geometry;
}

/** Reveal physical distance, moving the last pair of vertices between route samples. */
export function revealRibbon(geometry: BufferGeometry, progress: number, fromEnd = false): void {
  const shape = ribbonShapes.get(geometry)!;
  const position = geometry.getAttribute('position');
  const restore = shape.movedPair;
  if (restore !== undefined) {
    for (let j = 0; j < 6; j++) position.array[restore * 6 + j] = shape.position[restore * 6 + j]!;
    shape.movedPair = undefined;
    position.needsUpdate = true;
  }
  const fraction = Math.max(0, Math.min(1, progress));
  const total = shape.distances.at(-1) ?? 0;
  const distance = (fromEnd ? 1 - fraction : fraction) * total;
  geometry.userData.pathwayReveal = { progress: fraction, drawnLength: fraction * total, totalLength: total, fromEnd };
  if (fraction === 0 || total === 0) { geometry.setDrawRange(0, 0); return; }
  if (fraction === 1) { geometry.setDrawRange(0, geometry.index?.count ?? 0); return; }
  let lo = 1, hi = shape.distances.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (shape.distances[mid]! < distance) lo = mid + 1;
    else hi = mid;
  }
  const previous = shape.distances[lo - 1]!;
  const between = (distance - previous) / (shape.distances[lo]! - previous);
  const frontPair = fromEnd ? lo - 1 : lo;
  for (let j = 0; j < 6; j++) {
    const start = shape.position[(lo - 1) * 6 + j]!;
    position.array[frontPair * 6 + j] = start + (shape.position[lo * 6 + j]! - start) * between;
  }
  shape.movedPair = frontPair;
  position.needsUpdate = true;
  geometry.setDrawRange(fromEnd ? frontPair * 6 : 0, fromEnd ? (geometry.index?.count ?? 0) - frontPair * 6 : lo * 6);
}

// Neither the road nor its light can occlude a name, claim marker or island selection ray.
const ignoreRay = () => {};

/** The roads between islands: a recorded growth (7.4), or the live host's real arrivals (6.16). */
export function Pathways({ plan, reveal, live = false }: { plan: PlanetPathways; reveal?: ReadonlyMap<string, GrowthWindow & { fromEnd: boolean }> | undefined; live?: boolean }) {
  const liveClock = useRef({ elapsed: 0, started: false, reduced: reducedMotion(), roads: new Map<string, GrowthWindow>() as ReadonlyMap<string, GrowthWindow> });
  const state = liveClock.current;
  if (live) {
    const next = nextLiveRoads(state.roads, plan, state.elapsed);
    if (next !== state.roads) {
      // A new arrival gets an undrawn first frame even after a long idle interval.
      if ([...next.keys()].some(key => !state.roads.has(key))) state.started = false;
      state.roads = next;
      state.reduced = reducedMotion();
    }
  }
  const windows = useMemo(() => live ? roadSegmentWindows(plan, state.roads) : reveal, [plan, live, state.roads, reveal]);
  const meshes = useMemo(() => plan.segments.filter(segment => segment.island === undefined)
    .map(route => {
      const geometry = ribbon(route), halo = ribbon(route, true);
      if (live) {
        const window = windows?.get(route.id), drawn = liveRoadProgress(window, state.elapsed, state.reduced);
        revealRibbon(geometry, drawn, window?.fromEnd);
        revealRibbon(halo, drawn, window?.fromEnd);
      }
      return { route, geometry, halo };
    }), [plan, live]);
  useEffect(() => () => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.halo.dispose(); }), [meshes]);
  const growth = usePlanetGrowth();
  const { invalidate } = useThree();
  useEffect(() => { if (live) invalidate(); }, [meshes, live, invalidate]);
  useFrame((_, delta) => {
    if (windows === undefined) return;
    if (live) {
      if (state.started) state.elapsed = advanceLaneClock(state.elapsed, delta);
      state.started = true;
    }
    const now = live ? state.elapsed : growth.now();
    let drawing = false;
    for (const { route, geometry, halo } of meshes) {
      const window = windows.get(route.id);
      // A segment no road schedules keeps painting whole.
      const drawn = live ? liveRoadProgress(window, now, state.reduced) : growthProgress(window, now, false);
      if (live) {
        revealRibbon(geometry, drawn, window?.fromEnd);
        revealRibbon(halo, drawn, window?.fromEnd);
        drawing ||= drawn < 1;
      } else {
        const range = segmentDrawRange((geometry.index?.count ?? 0) / 6, drawn, window?.fromEnd ?? false);
        geometry.setDrawRange(range.start, range.count);
        halo.setDrawRange(range.start, range.count);
      }
    }
    if (drawing) invalidate();
  });
  return <group name="pathways:cross-island" userData={{
    links: plan.edges.map(edge => ({ from: edge.from, to: edge.to })),
    segmentCount: plan.segments.length,
    localSegmentCount: plan.segments.filter(segment => segment.island !== undefined).length,
  }}>{meshes.map(({ route, geometry, halo }) => <group key={route.id}>
    <mesh name={`pathway:${route.id}`} geometry={geometry} raycast={ignoreRay}
      userData={{ links: route.links, widthGround: route.width, unrouted: route.unrouted }}>
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
  const key = lit.map(link => `${link.dir}:${link.from}->${link.to}`).sort().join('\n');
  const animation = useRef({ key, elapsed: 0, started: false, reduced: reducedMotion() });
  if (animation.current.key !== key) animation.current = { key, elapsed: 0, started: false, reduced: reducedMotion() };
  const lanes = useMemo(() => laneRoutes(plan, lit).map(lane => {
    const geometry = ribbon(lane, false, 0.12), seconds = laneDrawSeconds(lane.length);
    revealRibbon(geometry, laneProgress(animation.current.elapsed, seconds, animation.current.reduced));
    return { lane, geometry, seconds };
  }), [plan, lit]);
  useEffect(() => () => lanes.forEach(({ geometry }) => geometry.dispose()), [lanes]);
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [lanes, invalidate]);
  useFrame((_, delta) => {
    const state = animation.current;
    // The first submitted frame is undrawn. Slow frames may stretch wall time, never skip the front.
    if (state.started) state.elapsed = advanceLaneClock(state.elapsed, delta);
    state.started = true;
    let drawing = false;
    for (const { geometry, seconds } of lanes) {
      const progress = laneProgress(state.elapsed, seconds, state.reduced);
      revealRibbon(geometry, progress);
      drawing ||= progress < 1;
    }
    // The canvas draws on demand: keep asking for frames only while a lane is still drawing.
    if (drawing) invalidate();
  });
  return <group name="pathways:selection-lanes" userData={{ lanes: lanes.map(({ lane, seconds }) =>
    ({ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, seconds })) }}>
    {lanes.map(({ lane, geometry }) => <mesh key={`${lane.from}->${lane.to}`} name={`lane:${lane.dir}:${lane.from}->${lane.to}`}
      geometry={geometry} raycast={ignoreRay} renderOrder={2}>
      <meshBasicMaterial color={lane.colour} transparent opacity={0.95} depthWrite={false} side={DoubleSide}
        polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>)}
  </group>;
}
