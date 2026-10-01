import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, Color, type InterleavedBufferAttribute } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SessionRing } from "./ring.js";
import { arcKey, arrived, curvePoint, IN_VIEW, fillAt, stepPoint, glowAt, growthPlan, heldNotes, ringArcs, noteTitle, replayAt, tailSpan, type AgentPath, type Lighting, type Point, type ReplayMoment, type Trail, type WindowView } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** How long a new step's line takes to grow, and each step of a glow's loop, and its rest between loops (ADR-0742). */
const GROW_MS = 900;
const GLOW = { step: 900, pause: 1200 };
/** A traversal step's faint fill: how long it takes to run from the earlier note to the later, and its rest (ADR-0756). */
const FILL = { run: 1600, pause: 900 };
/** A selected session's replay (ADR-0797): each step's line grows in this long, and the finished picture holds this long. */
const REPLAY = { step: 700, rest: 2500 };

/** How a selected session's note is drawn (ADR-0756): a compacted read lighter, a glimpse faintest. */
const noteState = (window: WindowView | undefined, id: string): "in-window" | "faded" | "glimpsed" | null =>
  window?.notes.has(id) ? "in-window" : window?.faded.has(id) ? "faded" : window?.glimpsed.has(id) ? "glimpsed" : null;
const lighter = (colour: string): string => `#${new Color(colour).lerp(new Color("#ffffff"), 0.55).getHexString()}`;

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const trailKey = (trail: Trail) => `${trail.colour} ${trail.from} ${trail.to}`;

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes, lit = new Map(), trails = [], paths = [], window, replay = false, stops }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  /** Notes a running session read, in its latest reader's colour, with every session that read it (ADR-0738, ADR-0754 D2). */
  lit?: ReadonlyMap<string, Lighting>;
  /** Each session's reading path, one curve per step, from the earlier read to the later (ADR-0740). */
  trails?: readonly Trail[];
  /** Each drawn agent's path, replayed by a looping glow (ADR-0742). */
  paths?: readonly AgentPath[];
  /** The selected session's window, in its colour: a warm white ring on each note it holds now, compacted reads lighter, glimpses faint (ADR-0756). */
  window?: (WindowView & { colour: string }) | undefined;
  /** A selected session: its trails replay as one head walking them in recorded order, building the picture, then resting and starting again (ADR-0797). */
  replay?: boolean;
  /** Where else a step can start or end (ADR-0804 D5): each file circle's stop on the land, outside the core, by its stop id. */
  stops?: ReadonlyMap<string, Point> | undefined;
}) {
  const at = useMemo(() => new Map<string, Point>([...points.map((point): [string, Point] => [point.id, point.at]), ...(stops ?? [])]), [points, stops]);
  const invalidate = useThree(state => state.invalidate);
  // One replay for the session, never one per agent: a single clock walks every trail in seq order (ADR-0797 D1).
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
    // Matched by key: the window is read again every few seconds, remaking the same steps as new objects.
    moment.current = { ...next, keys: new Set(next.drawn.map(trailKey)) };
    // Notes light as the head reaches them: a render only when it passes a step, not every frame.
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
  // Steps already read when the view first had any are history and never grow (ADR-0742 D4).
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
  // A newly read note lights, and each session's arc on it appears, only when that session's line into it arrives (ADR-0742 D2, ADR-0754 D2).
  const shown = useRef<ReadonlySet<string>>(new Set());
  const [, arrive] = useState(0);
  const now = performance.now();
  const held = heldNotes(trails.map(trail => ({ to: arcKey(trail.to, trail.colour), key: trailKey(trail) })), starts, now, GROW_MS, shown.current);
  const showing = arrived(lit, held);
  useEffect(() => { shown.current = new Set([...showing].flatMap(([note, { readers }]) => readers.map(({ colour }) => arcKey(note, colour)))); });
  useEffect(() => {
    const next = Math.min(...trails.flatMap(trail => {
      const start = starts.get(trailKey(trail));
      return start !== undefined && start + GROW_MS > now ? [start + GROW_MS] : [];
    }));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => arrive(tick => tick + 1), next - performance.now() + 16);
    return () => clearTimeout(timer);
  });
  return <group name="knowledge-points">
    {trails.map(trail => {
      const from = at.get(trail.from), to = at.get(trail.to);
      return from === undefined || to === undefined ? null
        : <TrailCurve key={trailKey(trail)} trail={trail} from={from} to={to} grow={starts.get(trailKey(trail))} radius={radius} replayed={replayed} />;
    })}
    {!reducedMotion() && !replaying && paths.map(path => <PathGlow key={path.mover} path={path} at={at} starts={starts} />)}
    {points.map(point => {
      // A note the replay has not reached yet is drawn as if unread (ADR-0797 D1).
      const hidden = unreached(point.id);
      const state = hidden ? null : noteState(window, point.id);
      const lighting = hidden ? undefined : showing.get(point.id);
      // An open read wears its reader's colour, or the session's; a compacted one is lighter; a glimpse is the session's, faint (ADR-0756).
      const colour = state === "faded" ? lighter(window!.colour) : lighting?.colour ?? (state === null ? "#a5c5d1" : window!.colour);
      const opacity = state === "glimpsed" && lighting === undefined ? 0.4 : state === "faded" ? 0.8 : lighting !== undefined || state === "in-window" ? 1 : lit.size > 0 ? 0.3 : 0.52;
      const size = (lighting !== undefined && state !== "faded") || state === "in-window" ? 0.009 : state === "faded" ? 0.0075 : 0.006;
      return <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null,
        lit: lighting?.colour ?? null, arcs: lighting !== undefined ? ringArcs(lighting) : [], window: state, colour, opacity }}>
      <sphereGeometry args={[radius * size, 12, 8]} />
      <meshBasicMaterial color={colour} transparent opacity={opacity} depthWrite={false} />
      {state === "in-window" && <Billboard name={`knowledge-window:${point.id}`}>
        <mesh raycast={noRaycast}>
          <torusGeometry args={[radius * 0.015, radius * 0.0022, 8, 28]} />
          <meshBasicMaterial color={IN_VIEW} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      </Billboard>}
      {lighting !== undefined && ringArcs(lighting).length > 0 && <SessionRing name={`knowledge-arcs:${point.id}`}
        arcs={ringArcs(lighting)} radius={radius * 0.0125} tube={radius * 0.0016} />}
    </mesh>;
    })}
  </group>;
}

const STEPS = 24;
const sample = (from: Point, to: Point, end: number, kind?: "hop" | "dive"): number[] =>
  Array.from({ length: STEPS + 1 }, (_, index) => stepPoint(kind, from, to, end * index / STEPS)).flatMap(({ x, y, z }) => [x, y, z]);

/**
 * One step of a reading path: a quadratic Bezier bowed away from the globe's centre, so it never
 * cuts through the globe, with no arrowhead (ADR-0740 D1; ADR-0742 D5). A new step grows from its
 * earlier read to its later one, starting at `grow` (ADR-0742 D2); before then it is not drawn.
 *
 * A log's reading path fades from dim at the earlier read to full colour at the later one. A
 * selected session's traversal step (ADR-0756) is one colour, solid along a stored link and dotted
 * for a jump, lighter when a read it touches was compacted out; once grown, a faint fill runs along
 * it from the earlier note to the later, like a progress bar, then rests and runs again.
 */
function TrailCurve({ trail, from, to, grow, radius, replayed }: {
  trail: Trail; from: Point; to: Point; grow: number | undefined; radius: number;
  /** How far the session's replay has drawn this step, 0 to 1, when one is replaying (ADR-0797): it then has no fill of its own. */
  replayed?: ((trail: Trail) => number) | undefined;
}) {
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const { step } = trail;
  const line = useMemo(() => {
    const made = lineOf(1.6, false);
    // A step over the land is drawn after the land's tints and circles, which are otherwise laid over it (ADR-0804 D5).
    if (step?.kind !== undefined) { made.renderOrder = 6; made.material.linewidth = 2.4; }
    if (step?.edge === "dotted") Object.assign(made.material, { dashed: true, dashSize: radius * 0.007, gapSize: radius * 0.007 });
    if (step?.faded) made.material.opacity = 0.45;
    return made;
  }, [step?.edge, step?.faded, step?.kind, radius]);
  const fill = useMemo(() => {
    const made = step === undefined || reducedMotion() || replayed !== undefined ? undefined : lineOf(3, true);
    if (made !== undefined && step?.kind !== undefined) made.renderOrder = 6;
    return made;
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
  // Faint: additive, so a quarter of a lightened colour only brightens the line it runs along.
  const fillColours = useMemo(() => {
    const faint = new Color(trail.colour).lerp(new Color("#ffffff"), 0.5).multiplyScalar(step?.faded ? 0.12 : 0.25);
    return Array.from({ length: STEPS + 1 }, () => faint.toArray()).flat();
  }, [trail.colour, step?.faded]);
  // Drawn to `end` of the way along; a log path's colours stay dim-to-bright over what is drawn.
  const draw = (end: number) => {
    moveLine(line.geometry, sample(from, to, end, step?.kind), colours);
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
      moveLine(fill.geometry, sample(from, to, run!, step?.kind), fillColours);
    }
    fill.userData = { fill: run ?? null };
    invalidate();
  });
  return <group name={`knowledge-trail:${trail.from}>${trail.to}`}
    userData={{ from: trail.from, to: trail.to, colour: trail.colour, seq: trail.seq, edge: step?.edge ?? null, faded: step?.faded ?? false, kind: step?.kind ?? null }}>
    <primitive object={line} />
    {fill !== undefined && <primitive object={fill} name={`knowledge-fill:${trail.from}>${trail.to}`} />}
  </group>;
}

/**
 * Draws a line through `positions` in `colours`. A line the core animates is redrawn every frame, and
 * three's `setPositions` and `setColors` make new GPU buffers on every call; this moves its points in
 * place and uploads its colours only when they change (ADR-0836 D1).
 */
export function moveLine(geometry: LineGeometry, positions: readonly number[], colours: readonly number[]): void {
  const start = geometry.getAttribute("instanceStart") as InterleavedBufferAttribute | undefined;
  const segments = positions.length / 3 - 1;
  if (start === undefined || start.count !== segments) geometry.setPositions([...positions]);
  else {
    // As `LineGeometry.setPositions` lays them out: each segment is its start point, then its end.
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

/** A thick line whose points change as it grows or glows; additive for a glow, so its dark end adds nothing. */
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

const GLOW_POINTS = 20;

/**
 * One agent's looping glow (ADR-0742 D3): it travels the agent's grown steps in recorded order,
 * bright at its head and fading behind, so it shows which way the agent read; after the last step
 * it rests, then starts again from the first.
 */
function PathGlow({ path, at, starts }: { path: AgentPath; at: ReadonlyMap<string, Point>; starts: ReadonlyMap<string, number> }) {
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const began = useRef(performance.now());
  const glow = useMemo(() => lineOf(3.5, true), []);
  useEffect(() => () => { glow.geometry.dispose(); glow.material.dispose(); }, [glow]);
  useEffect(() => { glow.material.resolution.set(size.width, size.height); }, [glow, size]);
  const colours = useMemo(() => {
    // Additive: black adds nothing, so the far end fades to nothing; the head is whitened to glow.
    const head = new Color(path.colour).lerp(new Color("#ffffff"), 0.12);
    return Array.from({ length: GLOW_POINTS }, (_, index) => head.clone().multiplyScalar((index / (GLOW_POINTS - 1)) ** 1.8).toArray()).flat();
  }, [path.colour]);

  useFrame(() => {
    const now = performance.now();
    // A step still growing, or yet to grow, is not part of the loop yet.
    const steps = path.steps.filter(step => {
      const start = starts.get(`${step.colour} ${step.from} ${step.to}`);
      return (start === undefined || start + GROW_MS <= now) && at.has(step.from) && at.has(step.to);
    });
    const place = glowAt(steps.length, now - began.current, GLOW);
    invalidate();
    if (place === undefined) { glow.visible = false; return; }
    const step = steps[place.step]!;
    const from = at.get(step.from)!, to = at.get(step.to)!;
    const [tail, head] = tailSpan(place.t);
    const positions: number[] = [];
    for (let index = 0; index < GLOW_POINTS; index++) {
      const point = curvePoint(from, to, tail + (head - tail) * index / (GLOW_POINTS - 1));
      positions.push(point.x, point.y, point.z);
    }
    moveLine(glow.geometry, positions, colours);
    glow.visible = head > tail;
    glow.userData = { mover: path.mover, step: `${step.from}>${step.to}` };
  });

  return <primitive object={glow} name={`knowledge-glow:${path.mover}`} />;
}
