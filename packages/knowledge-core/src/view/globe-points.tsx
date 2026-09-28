import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { WispBody } from "@storytree/forest-world/canvas";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, Vector3, type Group } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { curvePoint, noteTitle, tailSpan, type Lighting, type Point, type Trail, type Wisp } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes, lit = new Map(), trails = [], wisps = [] }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  /** Notes a running session read, in its colour; a shared one gets a halo (ADR-0738). */
  lit?: ReadonlyMap<string, Lighting>;
  /** Each session's reading path, one curve per step, pointing to the later read (ADR-0740). */
  trails?: readonly Trail[];
  /** Each drawn agent's wisp, flying its new steps as they arrive (ADR-0741). */
  wisps?: readonly Wisp[];
}) {
  const at = useMemo(() => new Map(points.map(point => [point.id, point.at])), [points]);
  return <group name="knowledge-points">
    {trails.map(trail => {
      const from = at.get(trail.from), to = at.get(trail.to);
      return from === undefined || to === undefined ? null
        : <TrailCurve key={`${trail.colour} ${trail.from} ${trail.to}`} trail={trail} from={from} to={to} />;
    })}
    {wisps.map(wisp => <FlyingWisp key={wisp.mover} wisp={wisp} at={at} radius={radius} />)}
    {points.map(point => <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null,
        lit: lit.get(point.id)?.colour ?? null, shared: lit.get(point.id)?.shared ?? false }}>
      <sphereGeometry args={[radius * (lit.has(point.id) ? 0.009 : 0.006), 12, 8]} />
      <meshBasicMaterial color={lit.get(point.id)?.colour ?? "#a5c5d1"} transparent opacity={lit.has(point.id) ? 1 : lit.size > 0 ? 0.3 : 0.52} depthWrite={false} />
      {lit.get(point.id)?.shared && <mesh raycast={noRaycast}>
        <sphereGeometry args={[radius * 0.017, 12, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.22} depthWrite={false} />
      </mesh>}
    </mesh>)}
  </group>;
}

const STEPS = 24;
const vector = ({ x, y, z }: Point) => new Vector3(x, y, z);

/**
 * One step of a reading path: a quadratic Bezier bowed away from the globe's centre, so it never
 * lies along a stored link, fading from dim at the earlier read to full colour at the later one
 * (ADR-0740 D1, D3). No arrowhead: the fade and the flying wisp show the way (ADR-0741 D4).
 */
function TrailCurve({ trail, from, to }: { trail: Trail; from: Point; to: Point }) {
  const points = Array.from({ length: STEPS + 1 }, (_, index) => vector(curvePoint(from, to, index / STEPS)));
  const full = new Color(trail.colour);
  const dim = full.clone().multiplyScalar(0.25);
  const colours = points.map((_, index) => dim.clone().lerp(full, index / STEPS).toArray() as [number, number, number]);
  return <group name={`knowledge-trail:${trail.from}>${trail.to}`} userData={{ from: trail.from, to: trail.to, colour: trail.colour }}>
    <Line points={points} vertexColors={colours} lineWidth={1.6} transparent opacity={0.85} depthWrite={false} raycast={noRaycast} />
  </group>;
}

/** How long one step's flight takes, and how many points draw its tail. */
const FLIGHT_MS = 1400;
const TAIL_POINTS = 20;
/** The wisp model's size against the globe: smaller than an island's session wisp. */
const WISP_SCALE = 0.011;
/** The model's tail lies along its local -X, so +X faces the way it flies. */
const FORWARD = new Vector3(1, 0, 0);

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One agent's wisp (ADR-0741). It opens resting at its latest read (no history replay, D3); each
 * step that arrives afterwards joins a queue and is flown in recorded order along the step's own
 * curve, facing the way it moves, trailing a tail that brightens toward it. When it lands the
 * tail draws in behind it. With reduced motion it moves straight to its new note.
 */
function FlyingWisp({ wisp, at, radius }: { wisp: Wisp; at: ReadonlyMap<string, Point>; radius: number }) {
  const body = useRef<Group>(null);
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const seen = useRef(wisp.steps.at(-1)?.seq ?? -Infinity);
  const queue = useRef<Trail[]>([]);
  const flight = useRef<{ step: Trail; start: number; duration: number } | undefined>(undefined);
  const resting = useRef(wisp.note);
  const tail = useMemo(() => {
    const line = new Line2(new LineGeometry(), new LineMaterial({
      linewidth: 4, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    line.raycast = noRaycast;
    line.visible = false;
    line.frustumCulled = false;
    return line;
  }, []);
  useEffect(() => () => { tail.geometry.dispose(); tail.material.dispose(); }, [tail]);
  useEffect(() => { tail.material.resolution.set(size.width, size.height); }, [tail, size]);
  const colours = useMemo(() => {
    const full = new Color(wisp.colour);
    // Additive: black adds nothing, so the far end of the tail fades to nothing.
    return Array.from({ length: TAIL_POINTS }, (_, index) => full.clone().multiplyScalar((index / (TAIL_POINTS - 1)) ** 1.6).toArray()).flat();
  }, [wisp.colour]);

  // New steps queue behind any flight in progress; history before the view opened is never flown.
  useEffect(() => {
    const fresh = wisp.steps.filter(({ seq }) => seq > seen.current);
    if (fresh.length === 0) return;
    seen.current = fresh.at(-1)!.seq;
    if (reducedMotion()) {
      queue.current = [];
      flight.current = undefined;
      resting.current = fresh.at(-1)!.to;
    } else queue.current.push(...fresh);
    invalidate();
  }, [wisp, invalidate]);

  useFrame(() => {
    const group = body.current;
    if (group === null) return;
    const now = performance.now();
    if (flight.current === undefined && queue.current.length > 0) {
      const step = queue.current.shift()!;
      // A backlog flies faster, so the wisp keeps up with its agent.
      flight.current = { step, start: now, duration: FLIGHT_MS / Math.min(3, 1 + queue.current.length * 0.5) };
    }
    const current = flight.current;
    const from = current === undefined ? undefined : at.get(current.step.from), to = current === undefined ? undefined : at.get(current.step.to);
    if (current === undefined || from === undefined || to === undefined) {
      if (current !== undefined) { resting.current = current.step.to; flight.current = undefined; }
      const rest = at.get(resting.current);
      group.visible = rest !== undefined;
      if (rest !== undefined) group.position.set(rest.x, rest.y, rest.z);
      tail.visible = false;
      return;
    }
    // t runs past 1 while the tail draws in behind the landed wisp.
    const t = (now - current.start) / current.duration;
    const [tailStart] = tailSpan(t);
    if (tailStart >= 1) {
      resting.current = current.step.to;
      flight.current = undefined;
      tail.visible = false;
      invalidate();
      return;
    }
    const head = Math.min(1, t);
    const eased = head * head * (3 - 2 * head);
    const place = vector(curvePoint(from, to, eased));
    group.visible = true;
    group.position.copy(place);
    const ahead = vector(curvePoint(from, to, Math.min(1, eased + 0.02)));
    const behind = vector(curvePoint(from, to, Math.max(0, eased - 0.02)));
    const direction = ahead.sub(behind);
    if (direction.lengthSq() > 0) group.quaternion.setFromUnitVectors(FORWARD, direction.normalize());
    const start = Math.min(eased, tailStart * tailStart * (3 - 2 * Math.min(1, tailStart)));
    const positions: number[] = [];
    for (let index = 0; index < TAIL_POINTS; index++) {
      const point = curvePoint(from, to, start + (eased - start) * index / (TAIL_POINTS - 1));
      positions.push(point.x, point.y, point.z);
    }
    tail.geometry.setPositions(positions);
    tail.geometry.setColors(colours);
    tail.computeLineDistances();
    tail.visible = eased > start;
    invalidate();
  });

  return <>
    <primitive object={tail} name={`knowledge-wisp-tail:${wisp.mover}`} />
    <group ref={body} name={`knowledge-wisp:${wisp.mover}`} userData={{ mover: wisp.mover, colour: wisp.colour }} scale={radius * WISP_SCALE}>
      <WispBody colour={wisp.colour} />
    </group>
  </>;
}
