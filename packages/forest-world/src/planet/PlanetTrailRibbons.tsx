/** Capability 4 · The planet. */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, ShaderMaterial, Vector3 } from 'three';
import { usePlanetGrowth } from './PlanetGrowth.js';
import { advanceLaneClock, laneDrawn, laneDrawSeconds, laneHead, laneHeads, laneProgress, laneShown, type LaneRoute } from './lanes.js';

/** A lane's strip: at each vertex its physical distance along the route (`along`) and the way out to its side at half
 * the strip's width (`sideways`), so a shader can draw its front and head. */
export function laneRibbon(route: { points: Vector3[]; widths: readonly number[] }, lift = 0): BufferGeometry {
  const position: number[] = [], sideways: number[] = [], along: number[] = [], index: number[] = [];
  let distance = 0;
  for (let i = 0; i < route.points.length; i++) {
    if (i) distance += route.points[i]!.distanceTo(route.points[i - 1]!);
    const radial = route.points[i]!.clone().normalize(), p = route.points[i]!.clone().addScaledVector(radial, lift);
    const tangent = route.points[Math.min(route.points.length - 1, i + 1)]!.clone().sub(route.points[Math.max(0, i - 1)]!);
    const side = radial.clone().cross(tangent).normalize().multiplyScalar(route.widths[i]! / 2);
    for (const sign of [-1, 1]) {
      position.push(...p.clone().addScaledVector(side, sign).toArray());
      sideways.push(...side.clone().multiplyScalar(sign).toArray());
      along.push(distance);
    }
    if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('sideways', new Float32BufferAttribute(sideways, 3));
  geometry.setAttribute('along', new Float32BufferAttribute(along, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The head (ADR-1000 D2), warm lamplight rather than a white spark: how far behind the front its brightness fades, how
 * much wider than the body it runs, and the cream it is tinted towards and how far. */
export const LANE_HEAD = { tail: 34, widen: 0.2, tint: '#ffe2b0', mix: 0.55 } as const;

/** Drawn where a fragment's distance along the route is at most `uDrawn`: the front lies at its exact physical
 * distance wherever it falls between samples. Near the front the strip warms towards cream and widens a little (the head).
 * Colours are written as authored (the globe's exact-colour mode). */
export function laneMaterial(colour: string, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColour: { value: new Color(colour) }, uOpacity: { value: opacity }, uDrawn: { value: -1 }, uHead: { value: 0 },
      uTail: { value: LANE_HEAD.tail }, uWiden: { value: LANE_HEAD.widen },
      uTint: { value: new Color(LANE_HEAD.tint) }, uMix: { value: LANE_HEAD.mix } },
    vertexShader: `attribute float along; attribute vec3 sideways;
uniform float uDrawn; uniform float uHead; uniform float uTail; uniform float uWiden;
varying float vAlong;
void main() {
  float head = uHead * (1.0 - smoothstep(0.0, uTail * 0.4, abs(uDrawn - along)));
  vAlong = along;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + sideways * uWiden * head, 1.0);
}`,
    fragmentShader: `uniform vec3 uColour; uniform vec3 uTint; uniform float uMix; uniform float uOpacity; uniform float uDrawn; uniform float uHead; uniform float uTail;
varying float vAlong;
void main() {
  float behind = uDrawn - vAlong;
  if (behind < 0.0) discard;
  float head = uHead * (1.0 - smoothstep(0.0, uTail, behind));
  gl_FragColor = vec4(mix(uColour, uTint, uMix * head), uOpacity);
}`,
    transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** Set a lane's front `progress` of the way along its `length`, its head at `head` brightness; nothing at 0. */
export function drawLane(material: ShaderMaterial, progress: number, head: number, length: number): void {
  material.uniforms.uDrawn!.value = progress > 0 ? progress * length : -1;
  material.uniforms.uHead!.value = head;
}

// No lane can occlude a name, claim marker or island selection ray.
const ignoreRay = () => {};

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A selected story's lit links (The drawing engine 4.8–4.9, ADR-1236 D1, ADR-1261 D3–D5): each lane one solid pale
 * sea-blue line at sea on its own route, lanes sharing a stretch one line there, wider by how many share it up to a cap,
 * ending at the far island's dock and just off the selected island's port (`seaLanes`); it draws on from the island
 * built on, every lane starting together at one pace, with a warm head at the front of each stretch it leads; a plumbing
 * call is one more link among them (ADR-1277 D1). In a recorded growth a lane shows once both its islands have risen
 * (4.33). A new selection draws its lanes again. */
export function SelectionLanes({ routes }: { routes: readonly LaneRoute[] }) {
  const key = routes.map(lane => `${lane.colour}:${lane.dir}:${lane.from}->${lane.to}`).sort().join('\n');
  const animation = useRef({ key, elapsed: 0, started: false, reduced: reducedMotion() });
  if (animation.current.key !== key) animation.current = { key, elapsed: 0, started: false, reduced: reducedMotion() };
  const lanes = useMemo(() => {
    const heads = laneHeads(routes);
    return routes.map((lane, i) => ({ lane, seconds: laneDrawSeconds(lane.length), heads: heads[i]!,
      strip: { geometry: laneRibbon(lane, 0.12), material: laneMaterial(lane.colour, 1) } }));
  }, [routes]);
  useEffect(() => () => lanes.forEach(({ strip }) => { strip.geometry.dispose(); strip.material.dispose(); }), [lanes]);
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [lanes, invalidate]);
  const growth = usePlanetGrowth();
  const draw = (elapsed: number, reduced: boolean) => {
    for (const { lane, strip, seconds, heads } of lanes) {
      const head = laneShown(lane, growth.island) ? laneHead(elapsed, lane.length, heads, reduced) : 0;
      drawLane(strip.material, laneDrawn(lane, growth.island, elapsed, seconds, reduced), head, lane.length);
    }
  };
  draw(animation.current.elapsed, animation.current.reduced);
  useFrame((_, delta) => {
    const state = animation.current;
    // The first submitted frame is undrawn. Slow frames may stretch wall time, never skip the front.
    if (state.started) state.elapsed = advanceLaneClock(state.elapsed, delta);
    state.started = true;
    draw(state.elapsed, state.reduced);
    let drawing = false;
    for (const { lane, seconds, heads } of lanes) {
      drawing ||= laneProgress(state.elapsed, seconds, state.reduced) < 1 || laneHead(state.elapsed, lane.length, heads, state.reduced) > 0;
    }
    // The canvas draws on demand: keep asking for frames only while a lane is still drawing or its head fading.
    if (drawing) invalidate();
  });
  return <group name="pathways:selection-lanes" userData={{ lanes: lanes.map(({ lane, seconds, heads }) =>
    ({ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, seconds, heads })) }}>
    {lanes.map(({ lane, strip }) => <mesh key={`${lane.dir}:${lane.from}->${lane.to}`}
      name={`lane:${lane.dir}:${lane.from}->${lane.to}`} geometry={strip.geometry} material={strip.material}
      raycast={ignoreRay} renderOrder={2} userData={{ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, ...lane.typeOnly ? { typeOnly: true } : {} }} />)}
  </group>;
}
