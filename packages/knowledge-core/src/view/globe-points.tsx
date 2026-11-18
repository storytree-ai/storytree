// Capability 4 · Look inside and inspect an artifact
import type { GlobePoint } from "../shelves/positions.js";
import { noteMoments, noteShown } from "../shelves/growing.js";
import type { RecordEnvelope } from "@storytree/library";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type InterleavedBufferAttribute } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { dotColour } from "../kinds/kinds.js";
import { DOT_FLOOR, IN_VIEW, curvePoint, fillAt, growthPlan, heldNotes, noteTitle, replayAt, type Lighting, type Point, type ReplayMoment, type Trail, type WindowView } from "../look-inside/look-inside.js";

const noRaycast = () => {};

const GROW_MS = 900;
const FILL = { run: 1600, pause: 900 };
const REPLAY = { step: 700, rest: 2500 };

const noteState = (window: WindowView | undefined, id: string): "in-window" | "faded" | "glimpsed" | null =>
  window?.notes.has(id) ? "in-window" : window?.faded.has(id) ? "faded" : window?.glimpsed.has(id) ? "glimpsed" : null;
const lighter = (colour: string): string => `#${new Color(colour).lerp(new Color("#ffffff"), 0.55).getHexString()}`;

const QUIET = 0.12;

export function dotOpacity({ state, lit, anyLit, quiet }: { state: ReturnType<typeof noteState>; lit: boolean; anyLit: boolean; quiet: boolean }): number {
  const plain = state === "glimpsed" && !lit ? 0.4 : state === "faded" ? 0.8 : lit || state === "in-window" ? 1 : anyLit ? 0.3 : 0.52;
  return quiet && !lit && state === null ? plain * QUIET : plain;
}

const SHADED = { body: 0.5, glow: 0.4 };
const shadedBody = (colour: string): Color => new Color(colour).multiplyScalar(SHADED.body);
const shadedGlow = (colour: string): Color => new Color(colour).multiplyScalar(SHADED.glow);

const spheres = { flat: new SphereGeometry(1, 12, 8), shaded: new SphereGeometry(1, 20, 14) };
const materials = new Map<string, MeshBasicMaterial | MeshLambertMaterial>();

export function dotDrawing({ shaded, colour, opacity, size, radius }: { shaded: boolean; colour: string; opacity: number; size: number; radius: number }):
  { geometry: SphereGeometry; material: MeshBasicMaterial | MeshLambertMaterial; scale: number; ring: { radius: number; tube: number } } {
  const key = `${shaded ? "shaded" : "flat"} ${colour} ${opacity}`;
  let material = materials.get(key);
  if (material === undefined) {
    material = shaded ? new MeshLambertMaterial({ color: shadedBody(colour), emissive: shadedGlow(colour), transparent: true, opacity, depthWrite: false })
      : new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false });
    materials.set(key, material);
  }
  return { geometry: shaded ? spheres.shaded : spheres.flat, material, scale: grownScale(1, radius, size), ring: { radius: Math.max(0.015, size + 0.006) / size, tube: 0.0022 / size } };
}

export const grownScale = (shown: number, radius: number, size: number): number => Math.max(shown, 0.001) * radius * size;

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const trailKey = (trail: Trail) => `${trail.colour} ${trail.from} ${trail.to}`;

export interface CoreGrowth { now(): number; moment(date: string): number }

export function GlobePoints({ points, radius, notes, sizes, lit = new Map(), trails = [], window, replay = false, growth: grows, quiet, shaded = false }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  quiet?: ReadonlySet<string> | undefined;
  shaded?: boolean;
  sizes?: ReadonlyMap<string, number> | undefined;
  lit?: ReadonlyMap<string, Lighting>;
  trails?: readonly Trail[];
  window?: (WindowView & { colour: string }) | undefined;
  replay?: boolean;
  growth?: CoreGrowth | undefined;
}) {
  const at = useMemo(() => new Map<string, Point>([...points.map((point): [string, Point] => [point.id, point.at])]), [points]);
  const invalidate = useThree(state => state.invalidate);
  const group = useRef<Group>(null);
  const moments = useMemo(() => grows === undefined ? undefined : noteMoments(points, notes, date => grows.moment(date)), [grows, points, notes]);
  const grownAt = useRef(Number.NaN);
  useEffect(() => { grownAt.current = Number.NaN; });
  useFrame(() => {
    const now = grows?.now();
    if (moments === undefined || now === undefined || group.current === null || now === grownAt.current) return;
    grownAt.current = now;
    let growing = false;
    for (const dot of group.current.children) {
      if (!dot.name.startsWith("knowledge-point:")) continue;
      const shown = noteShown(moments.get(dot.userData.id as string), now);
      dot.visible = shown > 0;
      dot.scale.setScalar(grownScale(shown, radius, dot.userData.size as number));
      growing ||= shown < 1;
    }
    if (growing) invalidate();
  });
  const replaying = replay && !reducedMotion();
  const clock = useRef(performance.now());
  const moment = useRef<(ReplayMoment<Trail> & { keys: Set<string> }) | undefined>(undefined);
  const [, reach] = useState(0);
  useFrame(() => {
    if (!replaying) return;
    const now = performance.now();
    let next = replayAt(trails, now - clock.current, REPLAY);
    if (next.over) { clock.current = now; next = replayAt(trails, 0, REPLAY); }
    const before = moment.current;
    moment.current = { ...next, keys: new Set(next.drawn.map(trailKey)) };
    if (before === undefined || before.drawn.length !== next.drawn.length || (before.head === undefined) !== (next.head === undefined)) reach(tick => tick + 1);
    invalidate();
  });
  const onSteps = useMemo(() => new Set(trails.flatMap(({ from, to }) => [from, to])), [trails]);
  const unreached = (id: string): boolean => replaying && onSteps.has(id) && moment.current?.lit.has(id) !== true;
  const replayed = useMemo(() => !replaying ? undefined : (trail: Trail): number => {
    const now = moment.current;
    if (now === undefined) return 0;
    if (now.head !== undefined && trailKey(now.head.step) === trailKey(trail)) return now.head.t * now.head.t * (3 - 2 * now.head.t);
    return now.keys.has(trailKey(trail)) ? 1 : 0;
  }, [replaying]);
  const history = useRef<number | undefined>(undefined);
  const growth = useRef<{ starts: Map<string, number>; busy: Map<string, number> }>({ starts: new Map(), busy: new Map() });
  const starts = useMemo(() => {
    if (trails.length === 0 || replaying) return growth.current.starts;
    if (history.current === undefined) {
      history.current = Math.max(...trails.map(({ seq }) => seq));
      return growth.current.starts;
    }
    if (reducedMotion()) return growth.current.starts;
    const fresh = trails.filter(trail => trail.seq > history.current! && !growth.current.starts.has(trailKey(trail)))
      .map(trail => ({ key: trailKey(trail), mover: trail.mover, seq: trail.seq }));
    if (fresh.length === 0) return growth.current.starts;
    const plan = growthPlan(fresh, growth.current.busy, performance.now(), GROW_MS);
    growth.current = { starts: new Map([...growth.current.starts, ...plan.starts]), busy: plan.busy };
    return growth.current.starts;
  }, [trails]);
  const shown = useRef<ReadonlySet<string>>(new Set());
  const [, arrive] = useState(0);
  const now = performance.now();
  const held = heldNotes(trails.map(trail => ({ to: trail.to, key: trailKey(trail) })), starts, now, GROW_MS, shown.current);
  const showing = new Map([...lit].filter(([note]) => !held.has(note)));
  useEffect(() => { shown.current = new Set(showing.keys()); });
  useEffect(() => {
    const next = Math.min(...trails.flatMap(trail => {
      const start = starts.get(trailKey(trail));
      return start !== undefined && start + GROW_MS > now ? [start + GROW_MS] : [];
    }));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => arrive(tick => tick + 1), next - performance.now() + 16);
    return () => clearTimeout(timer);
  });
  return <group name="knowledge-points" ref={group}>
    {trails.map(trail => {
      const from = at.get(trail.from), to = at.get(trail.to);
      return from === undefined || to === undefined ? null
        : <TrailCurve key={trailKey(trail)} trail={trail} from={from} to={to} grow={starts.get(trailKey(trail))} radius={radius} replayed={replayed} />;
    })}
    {points.map(point => {
      const hidden = unreached(point.id);
      const state = hidden ? null : noteState(window, point.id);
      const lighting = hidden ? undefined : showing.get(point.id);
      const colour = dotColour(notes.get(point.id)?.type, state === "faded" ? lighter(window!.colour) : lighting?.colour ?? (state === null ? undefined : window!.colour));
      const opacity = dotOpacity({ state, lit: lighting !== undefined, anyLit: lit.size > 0, quiet: quiet?.has(point.id) === true });
      const size = sizes?.get(point.id) ?? DOT_FLOOR;
      const drawn = dotDrawing({ shaded, colour, opacity, size, radius });
      return <mesh key={point.id} name={`knowledge-point:${point.id}`} geometry={drawn.geometry} material={drawn.material} scale={drawn.scale}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, size, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null, toward: point.toward ?? null,
        lit: lighting?.colour ?? null, window: state, colour, opacity }}>
      {state === "in-window" && <Billboard name={`knowledge-window:${point.id}`}>
        <mesh raycast={noRaycast}>
          <torusGeometry args={[drawn.ring.radius, drawn.ring.tube, 8, 28]} />
          <meshBasicMaterial color={IN_VIEW} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      </Billboard>}
    </mesh>;
    })}
  </group>;
}

const STEPS = 24;
const sample = (from: Point, to: Point, end: number): number[] =>
  Array.from({ length: STEPS + 1 }, (_, index) => curvePoint(from, to, end * index / STEPS)).flatMap(({ x, y, z }) => [x, y, z]);

function TrailCurve({ trail, from, to, grow, radius, replayed }: {
  trail: Trail; from: Point; to: Point; grow: number | undefined; radius: number;
  replayed?: ((trail: Trail) => number) | undefined;
}) {
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const { step } = trail;
  const line = useMemo(() => {
    const made = lineOf(1.6, false);
    if (step?.edge === "dotted") Object.assign(made.material, { dashed: true, dashSize: radius * 0.007, gapSize: radius * 0.007 });
    if (step?.faded) made.material.opacity = 0.45;
    return made;
  }, [step?.edge, step?.faded, radius]);
  const fill = useMemo(() => {
    return step === undefined || reducedMotion() || replayed !== undefined ? undefined : lineOf(3, true);
  }, [step === undefined, replayed === undefined]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  useEffect(() => () => { fill?.geometry.dispose(); fill?.material.dispose(); }, [fill]);
  useEffect(() => {
    line.material.resolution.set(size.width, size.height);
    fill?.material.resolution.set(size.width, size.height);
  }, [line, fill, size]);
  const colours = useMemo(() => {
    const full = new Color(trail.colour);
    if (step !== undefined) {
      const drawn = step.faded ? full.lerp(new Color("#ffffff"), 0.55) : full;
      return Array.from({ length: STEPS + 1 }, () => drawn.toArray()).flat();
    }
    const dim = full.clone().multiplyScalar(0.25);
    return Array.from({ length: STEPS + 1 }, (_, index) => dim.clone().lerp(full, index / STEPS).toArray()).flat();
  }, [trail.colour, step?.faded]);
  const fillColours = useMemo(() => {
    const faint = new Color(trail.colour).lerp(new Color("#ffffff"), 0.5).multiplyScalar(step?.faded ? 0.12 : 0.25);
    return Array.from({ length: STEPS + 1 }, () => faint.toArray()).flat();
  }, [trail.colour, step?.faded]);
  const draw = (end: number) => {
    moveLine(line.geometry, sample(from, to, end), colours);
    if (step?.edge === "dotted") line.computeLineDistances();
    line.visible = end > 0;
  };
  const done = useRef(false);
  const began = useRef(performance.now());
  const shown = useRef(-1);
  useEffect(() => {
    done.current = grow === undefined;
    shown.current = replayed === undefined ? -1 : replayed(trail);
    draw(replayed !== undefined ? shown.current : grow === undefined ? 1 : 0);
    invalidate();
  }, [line, from, to, colours, grow, replayed]);
  useFrame(() => {
    if (replayed !== undefined) {
      const end = replayed(trail);
      if (end !== shown.current) { shown.current = end; draw(end); invalidate(); }
      return;
    }
    const now = performance.now();
    if (!done.current && grow !== undefined) {
      const progress = Math.min(1, Math.max(0, (now - grow) / GROW_MS));
      draw(progress * progress * (3 - 2 * progress));
      if (progress >= 1) { done.current = true; began.current = now; }
      invalidate();
    }
    if (fill === undefined) return;
    const run = done.current ? fillAt(now - began.current, FILL) : undefined;
    fill.visible = run !== undefined && run > 0;
    if (fill.visible) {
      moveLine(fill.geometry, sample(from, to, run!), fillColours);
    }
    fill.userData = { fill: run ?? null };
    invalidate();
  });
  return <group name={`knowledge-trail:${trail.from}>${trail.to}`}
    userData={{ from: trail.from, to: trail.to, colour: trail.colour, seq: trail.seq, edge: step?.edge ?? null, faded: step?.faded ?? false }}>
    <primitive object={line} />
    {fill !== undefined && <primitive object={fill} name={`knowledge-fill:${trail.from}>${trail.to}`} />}
  </group>;
}

export function moveLine(geometry: LineGeometry, positions: readonly number[], colours: readonly number[]): void {
  const start = geometry.getAttribute("instanceStart") as InterleavedBufferAttribute | undefined;
  const segments = positions.length / 3 - 1;
  if (start === undefined || start.count !== segments) geometry.setPositions([...positions]);
  else {
    const pairs = start.data.array;
    for (let i = 0; i < segments; i++) for (let k = 0; k < 6; k++) pairs[6 * i + k] = positions[3 * i + k]!;
    start.data.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  const tinted = geometry.getAttribute("instanceColorStart") as InterleavedBufferAttribute | undefined;
  if (geometry.userData.colours !== colours || tinted?.count !== segments) geometry.setColors([...colours]);
  geometry.userData.colours = colours;
}

function lineOf(width: number, additive: boolean): Line2 {
  const line = new Line2(new LineGeometry(), new LineMaterial({
    linewidth: width, vertexColors: true, transparent: true, depthWrite: false,
    ...(additive ? { blending: AdditiveBlending } : { opacity: 0.85 }),
  }));
  line.raycast = noRaycast;
  line.visible = false;
  line.frustumCulled = false;
  return line;
}

export function NoteRoots({ roots }: { roots: readonly (readonly [Point, Point])[] }) {
  const drawn = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(roots.flatMap(([from, to]) => [from.x, from.y, from.z, to.x, to.y, to.z]), 3));
    const segments = new LineSegments(geometry, new LineBasicMaterial({ color: "#e9f4fa", transparent: true, opacity: 0.22, depthWrite: false }));
    segments.name = "knowledge-roots";
    segments.userData = { roots: roots.length };
    segments.raycast = noRaycast;
    return segments;
  }, [roots]);
  useCompiled(drawn);
  useEffect(() => () => { drawn.geometry.dispose(); drawn.material.dispose(); }, [drawn]);
  return <primitive object={drawn} />;
}

export function SeaFloor({ corners, notes }: { corners: readonly Point[]; notes: number }) {
  const drawn = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(corners.flatMap(({ x, y, z }) => [x, y, z]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const floor = new Mesh(geometry, new MeshBasicMaterial({ color: "#9fc3d6", transparent: true, opacity: 0.06, side: DoubleSide, depthWrite: false }));
    floor.name = "knowledge-floor";
    floor.userData = { notes };
    floor.raycast = noRaycast;
    return floor;
  }, [corners, notes]);
  useCompiled(drawn);
  useEffect(() => () => { drawn.geometry.dispose(); (drawn.material as MeshBasicMaterial).dispose(); }, [drawn]);
  return <primitive object={drawn} />;
}

function useCompiled(drawn: LineSegments | Mesh): void {
  const { gl, camera, scene } = useThree();
  useLayoutEffect(() => { gl.compile(drawn, camera, scene); }, [gl, camera, scene, drawn]);
}
