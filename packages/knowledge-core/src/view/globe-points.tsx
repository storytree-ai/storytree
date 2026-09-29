import type { GlobePoint } from "../shelves/positions.js";
import type { RecordEnvelope } from "@storytree/library";
import { Billboard, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, Color } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { curvePoint, glowAt, growthPlan, heldNotes, noteTitle, tailSpan, type AgentPath, type Lighting, type Point, type Trail, type WindowView } from "../look-inside/look-inside.js";

const noRaycast = () => {};

/** The window's colour (ADR-0746 D1): a warm white no session wears, since sessions take their colours from the whole hue wheel. */
const IN_VIEW = "#f4ecd8";

/** How long a new step's line takes to grow, and each step of a glow's loop, and its rest between loops (ADR-0742). */
const GROW_MS = 900;
const GLOW = { step: 900, pause: 1200 };

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const trailKey = (trail: Trail) => `${trail.colour} ${trail.from} ${trail.to}`;

/** Mesh raycasts stay disabled: the globe picks these small dots in screen space. */
export function GlobePoints({ points, radius, notes, lit = new Map(), trails = [], paths = [], window }: {
  points: readonly GlobePoint[]; radius: number; notes: ReadonlyMap<string, RecordEnvelope>;
  /** Notes a running session read, in its colour; a shared one gets a halo (ADR-0738). */
  lit?: ReadonlyMap<string, Lighting>;
  /** Each session's reading path, one curve per step, from the earlier read to the later (ADR-0740). */
  trails?: readonly Trail[];
  /** Each drawn agent's path, replayed by a looping glow (ADR-0742). */
  paths?: readonly AgentPath[];
  /** The selected session's window: a warm white ring on each note it holds now, and dotted warm white in-view lines (ADR-0746 D1). */
  window?: WindowView | undefined;
}) {
  const at = useMemo(() => new Map(points.map(point => [point.id, point.at])), [points]);
  // Steps already read when the view first had any are history and never grow (ADR-0742 D4).
  const history = useRef<number | undefined>(undefined);
  const growth = useRef<{ starts: Map<string, number>; busy: Map<string, number> }>({ starts: new Map(), busy: new Map() });
  const starts = useMemo(() => {
    if (trails.length === 0) return growth.current.starts;
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
  // A newly read note lights only when the line growing into it arrives (ADR-0742 D2).
  const shown = useRef<ReadonlySet<string>>(new Set());
  const [, arrived] = useState(0);
  const now = performance.now();
  const held = heldNotes(trails.map(trail => ({ to: trail.to, key: trailKey(trail) })), starts, now, GROW_MS, shown.current);
  const showing = held.size === 0 ? lit : new Map([...lit].filter(([note]) => !held.has(note)));
  useEffect(() => { shown.current = new Set(showing.keys()); });
  useEffect(() => {
    const next = Math.min(...trails.flatMap(trail => {
      const start = starts.get(trailKey(trail));
      return start !== undefined && start + GROW_MS > now ? [start + GROW_MS] : [];
    }));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => arrived(tick => tick + 1), next - performance.now() + 16);
    return () => clearTimeout(timer);
  });
  return <group name="knowledge-points">
    {trails.map(trail => {
      const from = at.get(trail.from), to = at.get(trail.to);
      return from === undefined || to === undefined ? null
        : <TrailCurve key={trailKey(trail)} trail={trail} from={from} to={to} grow={starts.get(trailKey(trail))} />;
    })}
    {window?.links.map(({ from, to }) => {
      const a = at.get(from), b = at.get(to);
      // Straight, dotted and headless, so it never reads as a reading path's curve or a followed link (ADR-0740 D3).
      return a === undefined || b === undefined ? null : <group key={`${from}>${to}`} name={`knowledge-in-view:${from}>${to}`} userData={{ from, to, kind: "in-view" }}>
        <Line points={[[a.x, a.y, a.z], [b.x, b.y, b.z]]} color={IN_VIEW} lineWidth={1.2} transparent opacity={0.8} depthWrite={false}
          dashed dashSize={radius * 0.006} gapSize={radius * 0.01} raycast={noRaycast} />
      </group>;
    })}
    {!reducedMotion() && paths.map(path => <PathGlow key={path.mover} path={path} at={at} starts={starts} />)}
    {points.map(point => <mesh key={point.id} name={`knowledge-point:${point.id}`}
      position={[point.at.x, point.at.y, point.at.z]} raycast={noRaycast}
      userData={{ id: point.id, title: notes.has(point.id) ? noteTitle(notes.get(point.id)!) : point.id, depth: point.depth ?? null, home: point.home ?? null,
        lit: showing.get(point.id)?.colour ?? null, shared: showing.get(point.id)?.shared ?? false }}>
      <sphereGeometry args={[radius * (showing.has(point.id) ? 0.009 : 0.006), 12, 8]} />
      <meshBasicMaterial color={showing.get(point.id)?.colour ?? "#a5c5d1"} transparent opacity={showing.has(point.id) ? 1 : lit.size > 0 ? 0.3 : 0.52} depthWrite={false} />
      {window?.notes.has(point.id) === true && <Billboard name={`knowledge-window:${point.id}`}>
        <mesh raycast={noRaycast}>
          <torusGeometry args={[radius * 0.015, radius * 0.0022, 8, 28]} />
          <meshBasicMaterial color={IN_VIEW} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      </Billboard>}
      {showing.get(point.id)?.shared && <mesh raycast={noRaycast}>
        <sphereGeometry args={[radius * 0.017, 12, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.22} depthWrite={false} />
      </mesh>}
    </mesh>)}
  </group>;
}

const STEPS = 24;
const sample = (from: Point, to: Point, end: number): number[] =>
  Array.from({ length: STEPS + 1 }, (_, index) => curvePoint(from, to, end * index / STEPS)).flatMap(({ x, y, z }) => [x, y, z]);

/**
 * One step of a reading path: a quadratic Bezier bowed away from the globe's centre, so it never
 * lies along a stored link, fading from dim at the earlier read to full colour at the later one,
 * with no arrowhead (ADR-0740 D1, D3; ADR-0742 D5). A new step grows from its earlier read to its
 * later one, starting at `grow` (ADR-0742 D2); before then it is not drawn.
 */
function TrailCurve({ trail, from, to, grow }: { trail: Trail; from: Point; to: Point; grow: number | undefined }) {
  const invalidate = useThree(state => state.invalidate);
  const size = useThree(state => state.size);
  const line = useMemo(() => lineOf(1.6, false), []);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  useEffect(() => { line.material.resolution.set(size.width, size.height); }, [line, size]);
  const colours = useMemo(() => {
    const full = new Color(trail.colour);
    const dim = full.clone().multiplyScalar(0.25);
    return Array.from({ length: STEPS + 1 }, (_, index) => dim.clone().lerp(full, index / STEPS).toArray()).flat();
  }, [trail.colour]);
  // Drawn to `end` of the way along; the colours stay dim-to-bright over what is drawn.
  const draw = (end: number) => {
    line.geometry.setPositions(sample(from, to, end));
    line.geometry.setColors(colours);
    line.visible = end > 0;
  };
  const done = useRef(false);
  useEffect(() => {
    done.current = grow === undefined;
    draw(grow === undefined ? 1 : 0);
    invalidate();
  }, [line, from, to, colours, grow]);
  useFrame(() => {
    if (done.current || grow === undefined) return;
    const progress = Math.min(1, Math.max(0, (performance.now() - grow) / GROW_MS));
    draw(progress * progress * (3 - 2 * progress));
    if (progress >= 1) done.current = true;
    invalidate();
  });
  return <group name={`knowledge-trail:${trail.from}>${trail.to}`} userData={{ from: trail.from, to: trail.to, colour: trail.colour }}>
    <primitive object={line} />
  </group>;
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
    glow.geometry.setPositions(positions);
    glow.geometry.setColors(colours);
    glow.computeLineDistances();
    glow.visible = head > tail;
    glow.userData = { mover: path.mover, step: `${step.from}>${step.to}` };
  });

  return <primitive object={glow} name={`knowledge-glow:${path.mover}`} />;
}
