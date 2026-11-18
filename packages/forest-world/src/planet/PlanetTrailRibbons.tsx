// Capability 4 · The planet
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, PerspectiveCamera, ShaderMaterial, Vector3, type Camera, type Mesh, type Object3D } from 'three';
import { usePlanetGrowth } from './PlanetGrowth.js';
import { advanceLaneClock, LANE_DOTS, LANE_STRANDS, laneDrawn, laneScale, laneDrawSeconds, laneHead, laneHeads, laneProgress, laneShown, restShown, SEA_LANE, SEA_LANE_FILL, SEA_LANE_ONE, type LaneRoute, type RestStretch } from './lanes.js';

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

export const LANE_HEAD = { tail: 34, widen: 0.2, tint: '#ffe2b0', mix: 0.55 } as const;

export function laneMaterial(colour: string, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColour: { value: new Color(colour) }, uOpacity: { value: opacity }, uDrawn: { value: -1 }, uHead: { value: 0 }, uScale: { value: 1 },
      uTail: { value: LANE_HEAD.tail }, uWiden: { value: LANE_HEAD.widen },
      uTint: { value: new Color(LANE_HEAD.tint) }, uMix: { value: LANE_HEAD.mix } },
    vertexShader: `attribute float along; attribute vec3 sideways;
uniform float uDrawn; uniform float uHead; uniform float uTail; uniform float uWiden; uniform float uScale;
varying float vAlong;
void main() {
  float head = uHead * (1.0 - smoothstep(0.0, uTail * 0.4, abs(uDrawn - along)));
  vAlong = along;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + sideways * (uScale - 1.0 + uScale * uWiden * head), 1.0);
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

export function drawLane(material: ShaderMaterial, progress: number, head: number, length: number, scale = 1): void {
  material.uniforms.uDrawn!.value = progress > 0 ? progress * length : -1;
  material.uniforms.uHead!.value = head;
  material.uniforms.uScale!.value = scale;
}

export function laneDots(stretches: readonly RestStretch[], lift = 0.08): BufferGeometry {
  const position: number[] = [], ahead: number[] = [], corner: number[] = [], size: number[] = [], order: number[] = [], across: number[] = [],
    ends: number[] = [], bright: number[] = [], index: number[] = [];
  for (const stretch of stretches) {
    const perStrand = stretch.dots.length / stretch.strands;
    stretch.dots.forEach(({ at, along, across: out, ends: [from, to] }, k) => {
      const p = at.clone().addScaledVector(at.clone().normalize(), lift), first = position.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        position.push(...p.toArray());
        ahead.push(...along.toArray());
        corner.push(u, v);
        size.push(stretch.size);
        order.push(k % perStrand);
        across.push(out);
        ends.push(from, to);
        bright.push(stretch.bright);
      }
      index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('ahead', new Float32BufferAttribute(ahead, 3));
  geometry.setAttribute('corner', new Float32BufferAttribute(corner, 2));
  geometry.setAttribute('size', new Float32BufferAttribute(size, 1));
  geometry.setAttribute('order', new Float32BufferAttribute(order, 1));
  geometry.setAttribute('across', new Float32BufferAttribute(across, 1));
  geometry.setAttribute('ends', new Float32BufferAttribute(ends, 2));
  geometry.setAttribute('bright', new Float32BufferAttribute(bright, 1));
  geometry.setAttribute('shown', new Float32BufferAttribute(new Array<number>(position.length / 3).fill(1), 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export const LANE_BRIGHT = { mix: 0.6, opacity: 0.33 } as const;

export function laneDotMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColour: { value: new Color(SEA_LANE) }, uBright: { value: new Color(SEA_LANE_FILL) }, uOpacity: { value: LANE_DOTS.opacity }, uScale: { value: 1 },
      uFan: { value: LANE_STRANDS.fan * SEA_LANE_ONE }, uMix: { value: LANE_BRIGHT.mix }, uMore: { value: LANE_BRIGHT.opacity } },
    vertexShader: `attribute vec3 ahead; attribute vec2 corner; attribute float size; attribute float order; attribute float shown;
attribute float across; attribute vec2 ends; attribute float bright;
uniform float uScale; uniform float uFan;
varying vec2 vCorner; varying float vShown; varying float vBright;
void main() {
  vec3 side = normalize(cross(normalize(position), ahead)), forward = normalize(cross(side, normalize(position)));
  vCorner = corner;
  vBright = bright;
  vShown = shown * (mod(order + 0.5, uScale) < 1.0 ? 1.0 : 0.0);
  float spread = smoothstep(0.0, uFan * uScale, min(ends.x, ends.y));
  vec3 centre = position + side * across * uScale * spread;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(centre + (forward * corner.x + side * corner.y) * size * uScale * 0.5, 1.0);
}`,
    fragmentShader: `uniform vec3 uColour; uniform vec3 uBright; uniform float uOpacity; uniform float uMix; uniform float uMore;
varying vec2 vCorner; varying float vShown; varying float vBright;
void main() {
  if (vShown < 0.5 || dot(vCorner, vCorner) > 1.0) discard;
  gl_FragColor = vec4(mix(uColour, uBright, uMix * vBright), min(1.0, uOpacity * (1.0 + uMore * vBright)));
}`,
    transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
}

export function drawDots(material: ShaderMaterial, geometry: BufferGeometry, stretches: readonly RestStretch[], selected: boolean, island: (story: string) => number, scale = 1): boolean {
  material.uniforms.uOpacity!.value = LANE_DOTS.opacity * (selected ? LANE_DOTS.dim : 1);
  material.uniforms.uScale!.value = scale;
  const shown = geometry.getAttribute('shown') as Float32BufferAttribute;
  let at = 0, changed = false;
  for (const stretch of stretches) {
    const value = restShown(stretch, island) ? 1 : 0;
    for (let i = 0; i < stretch.dots.length * 4; i++, at++) if (shown.getX(at) !== value) { shown.setX(at, value); changed = true; }
  }
  if (changed) shown.needsUpdate = true;
  return changed;
}

export function worldPerPixel(object: Object3D, geometry: BufferGeometry, camera: Camera, height: number): number {
  if (!(camera instanceof PerspectiveCamera) || geometry.boundingSphere === null || height <= 0) return 0;
  const centre = geometry.boundingSphere.center.clone().applyMatrix4(object.matrixWorld);
  const scale = new Vector3().setFromMatrixScale(object.matrixWorld).x || 1;
  return 2 * centre.distanceTo(camera.getWorldPosition(new Vector3())) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom / height / scale;
}

export function RestLanes({ stretches, selected, scale }: { stretches: readonly RestStretch[]; selected: boolean; scale: { current: number } }) {
  const dots = useMemo(() => ({ geometry: laneDots(stretches), material: laneDotMaterial() }), [stretches]);
  useEffect(() => () => { dots.geometry.dispose(); dots.material.dispose(); }, [dots]);
  const { invalidate } = useThree();
  const growth = usePlanetGrowth();
  const mesh = useRef<Mesh>(null);
  drawDots(dots.material, dots.geometry, stretches, selected, growth.island, scale.current);
  useEffect(() => { invalidate(); }, [dots, selected, invalidate]);
  useFrame(({ camera, size }) => {
    if (mesh.current) scale.current = laneScale(worldPerPixel(mesh.current, dots.geometry, camera, size.height));
    if (drawDots(dots.material, dots.geometry, stretches, selected, growth.island, scale.current)) invalidate();
  });
  return <group name="pathways:rest-lanes" userData={{ stretches: stretches.length, strands: stretches.reduce((n, s) => n + s.strands, 0),
    dots: stretches.reduce((n, s) => n + s.dots.length, 0) }}>
    <mesh ref={mesh} name="lane-dots" geometry={dots.geometry} material={dots.material} raycast={ignoreRay} renderOrder={1} />
  </group>;
}

const ignoreRay = () => {};

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SelectionLanes({ routes, scale }: { routes: readonly LaneRoute[]; scale: { readonly current: number } }) {
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
      drawLane(strip.material, laneDrawn(lane, growth.island, elapsed, seconds, reduced), head, lane.length, scale.current);
    }
  };
  draw(animation.current.elapsed, animation.current.reduced);
  useFrame((_, delta) => {
    const state = animation.current;
    if (state.started) state.elapsed = advanceLaneClock(state.elapsed, delta);
    state.started = true;
    draw(state.elapsed, state.reduced);
    let drawing = false;
    for (const { lane, seconds, heads } of lanes) {
      drawing ||= laneProgress(state.elapsed, seconds, state.reduced) < 1 || laneHead(state.elapsed, lane.length, heads, state.reduced) > 0;
    }
    if (drawing) invalidate();
  });
  return <group name="pathways:selection-lanes" userData={{ lanes: lanes.map(({ lane, seconds, heads }) =>
    ({ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, seconds, heads })) }}>
    {lanes.map(({ lane, strip }) => <mesh key={`${lane.dir}:${lane.from}->${lane.to}`}
      name={`lane:${lane.dir}:${lane.from}->${lane.to}`} geometry={strip.geometry} material={strip.material}
      raycast={ignoreRay} renderOrder={2} userData={{ from: lane.from, to: lane.to, dir: lane.dir, length: lane.length, ...lane.typeOnly ? { typeOnly: true } : {} }} />)}
  </group>;
}
