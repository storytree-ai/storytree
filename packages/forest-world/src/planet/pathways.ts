/** Capability 4 · The planet. Sea lanes over the glass between tangent islands, dock to dock (forest contracts 3.6–3.7,
 * ADR-1261: the beige roads between islands are retired). The existing cost-grid router owns routing and merging; this
 * adapter only changes spaces. */
import type { ForestScene, Island } from '../scene.js';
import { Quaternion, Vector3 } from 'three';
import { clipToCoast, rimLoops, SHIPPED_COAST, type CoastPoint } from '../coast-clip.js';
import { routeTrails, type TrailEdgeIn, type TrailEdgeOut, type TrailIsland, type TrailNetwork, type TrailSegment, type TrailTuning } from '../core/routing.js';
import { forestDescriptors } from '../forest-ground/forest-ground.js';
import type { Descriptor3D, InstanceDescriptor } from '../descriptors.js';
import { onIslandSurface } from './island-surface.js';
import { plateTransform, type PlanetSpot } from './planet.js';
import { SEA_LANE_CAP } from './lanes.js';

export interface PlanetPathwayPlate {
  descriptors: Descriptor3D[];
  /** The island's coast loops in the plate's local ground coordinates: the outline of its flat surface. */
  coast: CoastPoint[][];
}

/** One stretch of a lane's route at sea (ADR-1261 D3), shared by every link routed along it. */
export interface PlanetLaneSegment {
  id: string;
  points: Vector3[];
  /** The capability links routed along it. */
  links: string[];
  /** How many of its links are type-only (ADR-0991 D1); absent for none. */
  typeOnlyLinks?: number;
  /** Its longest stretch, in ground units, that the router never planned: the straight run on the chart from where the
   * router ends it to its dock on the coast, or a gap the globe filled in along its surface. */
  unrouted?: number;
}

/** The lanes' plan (ADR-1261 D3): every capability link between islands routed by the trail router
 * dock to dock, around islands, merging where lanes head the same way. */
export interface PlanetLanes {
  segments: PlanetLaneSegment[];
  /** Each capability link's chain of segments, from the building capability to the one built on, with the islands it
   * joins (`islands`: the building one's story, then the built-on one's). */
  edges: (TrailEdgeOut & { typeOnly?: true; islands: readonly [string, string] })[];
  /** Where lanes come ashore, with the capability links each carries. */
  docks: { story: string; point: Vector3; local: CoastPoint; links: string[] }[];
}

export interface PlanetPathways {
  plates: Map<string, PlanetPathwayPlate>;
  /** The lanes. */
  lanes: PlanetLanes;
}

interface Point { x: number; y: number }
interface ChartPoint extends Point { local: CoastPoint }
interface PreparedGround {
  descriptors: Descriptor3D[];
  rings: CoastPoint[][];
  /** Kept with the ground, so a status change on another island does not rebuild this island's ground texture. */
  plate: PlanetPathwayPlate;
}
interface Ground extends PreparedGround {
  id: string;
  transform: ReturnType<typeof plateTransform>;
  surface: ReturnType<typeof onIslandSurface>;
  at: Vector3;
  chartRings: ChartPoint[][];
  centre: Point;
  r: number;
}
interface Link extends TrailEdgeIn { source: string; target: string; typeOnly?: true }

/** The routes between islands a drawing asks the router for: plain data, so a worker can route them. Its lanes', one
 * per pair of islands a capability link joins (ADR-1261 D3). */
export interface CrossRouting {
  islands: TrailIsland[];
  lanes: { edges: TrailEdgeIn[]; seed: string; tuning: Partial<TrailTuning> };
}

/** What routing a drawing answers: its lanes' network. */
export interface PlanetNetworks { lanes: TrailNetwork }

/** Routes a drawing's lanes with `route`. */
export function routePlanet(routing: CrossRouting, route: typeof routeTrails = routeTrails): PlanetNetworks {
  return { lanes: route(routing.islands, routing.lanes.edges, routing.lanes.seed, routing.lanes.tuning) };
}
interface Dock { story: string; local: CoastPoint; point: Vector3; links: Set<string> }

// Polls preserve unchanged island objects; retain their ground input and relief through routing.
const preparedGrounds = new WeakMap<Island, PreparedGround>();
// Routing is the costly part (ADR-0836 D1): the routes between islands are kept while every island's place and size
// are, and moved with them when every island moved by one shift on the chart.
let crossRoutes: { key: string; routing: CrossRouting; network: PlanetNetworks } | undefined;
/** How far a charted point may stray from the one shift and still count as moved by it, in ground units: well under
 * the router's 2-unit cell. A desktop sheet shift of tens of units bends a chart point by under 1e-3. */
const SHIFT_TOLERANCE = 0.01;

/** The routes kept for a layout's routing: the last routing's when nothing changed, or the last routing's moved by one
 * shift when its islands all moved by that shift on the chart, with the same sizes, outlines, edges and tuning (the
 * drawing engine 4.37). A moved network is kept as this layout's. */
function keptNetwork(key: string, routing: CrossRouting): PlanetNetworks | undefined {
  if (crossRoutes === undefined) return undefined;
  if (crossRoutes.key === key) return crossRoutes.network;
  const shift = chartShift(crossRoutes.routing, routing);
  if (shift === undefined) return undefined;
  const network = { lanes: shiftedNetwork(crossRoutes.network.lanes, shift) };
  crossRoutes = { key, routing, network };
  return network;
}

function chartShift(was: CrossRouting, now: CrossRouting): Point | undefined {
  if (JSON.stringify(was.lanes) !== JSON.stringify(now.lanes)) return undefined;
  if (was.islands.length !== now.islands.length || was.islands.length === 0) return undefined;
  const shift = { x: now.islands[0]!.x - was.islands[0]!.x, y: now.islands[0]!.y - was.islands[0]!.y };
  const moved = (a: Point, b: Point) => Math.abs(b.x - a.x - shift.x) <= SHIFT_TOLERANCE && Math.abs(b.y - a.y - shift.y) <= SHIFT_TOLERANCE;
  return was.islands.every((a, i) => {
    const b = now.islands[i]!, rings = a.outline ?? [], to = b.outline ?? [];
    return a.id === b.id && Math.abs(a.r - b.r) <= SHIFT_TOLERANCE && moved(a, b) && rings.length === to.length
      && rings.every((ring, j) => ring.length === to[j]!.length && ring.every((point, k) => moved(point, to[j]![k]!)));
  }) ? shift : undefined;
}

/** The network moved by `shift` on the chart: its curves (`d`, alternating x and y), polylines and caves. */
function shiftedNetwork(network: TrailNetwork, shift: Point): TrailNetwork {
  const along = <P extends Point>(p: P): P => ({ ...p, x: p.x + shift.x, y: p.y + shift.y });
  return {
    ...network,
    segments: network.segments.map(segment => {
      let i = 0;
      const d = segment.d.replace(/-?\d+(?:\.\d+)?/g, n => String(Math.round((Number(n) + (i++ % 2 === 0 ? shift.x : shift.y)) * 100) / 100));
      return { ...segment, d, points: segment.points.map(along) };
    }),
    caves: network.caves.map(along),
  };
}

function prepareGround(island: Island): PreparedGround {
  const old = preparedGrounds.get(island);
  if (old) return old;
  const descriptors = forestDescriptors({ islands: [{ ...island, x: 0, z: 0 }] });
  const cells = clipToCoast(descriptors.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.points !== undefined), SHIPPED_COAST);
  const rings = rimLoops(cells.map(c => c.points!));
  const prepared = { descriptors, rings, plate: { descriptors, coast: rings } };
  preparedGrounds.set(island, prepared);
  return prepared;
}

/** How far the island's coast reaches from its middle, in ground units: what the globe leaves room for (ADR-0804 D7). */
export function islandCoastReach(island: Island): number {
  return Math.max(0, ...prepareGround(island).rings.flat().map(point => Math.hypot(point.x, point.z)));
}

/** The same local coast the plate draws, for the host to lay out its territories. */
export function islandCoast(island: Island): readonly (readonly CoastPoint[])[] {
  return prepareGround(island).rings;
}

const keyOf = (edge: TrailEdgeIn) => JSON.stringify([edge.from, edge.to]);
const displayKey = (edge: TrailEdgeIn) => `${edge.from}->${edge.to}`;
const refPrefix = (prefix: string, edge: TrailEdgeOut) => edge.segments.map(ref => ({ ...ref, id: prefix + ref.id }));

/** Evaluate the router's actual cubic curve, not its angular control polygon. */
function spline(segment: TrailSegment): Point[] {
  const values = segment.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (values.length < 2) throw new Error(`No curve for trail ${segment.id}`);
  const out: Point[] = [{ x: values[0]!, y: values[1]! }];
  let a = out[0]!;
  for (let i = 2; i < values.length; i += 6) {
    const b = { x: values[i]!, y: values[i + 1]! };
    const c = { x: values[i + 2]!, y: values[i + 3]! };
    const d = { x: values[i + 4]!, y: values[i + 5]! };
    const steps = Math.max(8, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y)
      + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y)) / 0.8));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, u = 1 - t;
      out.push({ x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y });
    }
    a = d;
  }
  // SVG rounds to two decimals; the shared network's true junctions must remain exact.
  out[0] = { ...segment.points[0]! };
  out[out.length - 1] = { ...segment.points.at(-1)! };
  return out;
}

/** Snap to the actual clipped coast; retain its local coordinates through chart projection. */
function nearest(p: Point, rings: readonly (readonly ChartPoint[])[]): ChartPoint {
  let best: ChartPoint | undefined;
  let distance = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    const q = { x: a.x + t * dx, y: a.y + t * dy,
      local: { x: a.local.x + t * (b.local.x - a.local.x), z: a.local.z + t * (b.local.z - a.local.z) } };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < distance) { best = q; distance = d; }
  }
  if (!best) throw new Error('A pathway cannot dock on an island without a coast');
  return best;
}

/** Plate point `p` where the globe draws it: on the island's surface, bent onto the sphere (ADR-0804 D1). On the flat
 * plate a coast 80 units out stood 11 units over its drawn land, and the route climbing to it showed past the globe's
 * edge (the owner, 2026-10-06: "the payways look to flow off the globe when they hit the edge rather then end"). */
function onGround(g: Ground, p: CoastPoint): Vector3 {
  return g.surface(p).applyQuaternion(g.transform.quaternion).add(g.at);
}

/** How far a lane's route keeps off every coast, in ground units: a port's berth and half the widest lane (ADR-1261 D3). */
const LANE_CLEARANCE = 3 + SEA_LANE_CAP / 2;

/** The farthest apart two points of a lane are on the chart, in chart units: the router's own step. */
const CHART_STEP = 0.8;

/** How far over the glass a lane rides, away from its docks, in ground units. */
const LANE_LIFT = 1.02;

/** The farthest apart two points of a lane may be, in ground units: its strip is drawn straight between them, and at
 * this length it sags a fraction of a unit, so it stays on the glass. */
const MAX_LANE_STEP = 1;

/**
 * `points` with every longer gap filled in along the globe's surface, its height eased between the gap's ends.
 * The route is planned on an azimuthal chart that stretches islands far from its pole sideways, so a route can stop
 * short of a far island's coast; its dock was then joined by one straight chord through the ball (the owner,
 * 2026-10-05: "i can see a stray pathway").
 */
function alongTheGlobe(points: readonly Vector3[]): Vector3[] {
  const out = [points[0]!.clone()];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const steps = Math.ceil(a.distanceTo(b) / MAX_LANE_STEP);
    const [from, to] = [a.clone().normalize(), b.clone().normalize()];
    const angle = from.angleTo(to), sin = Math.sin(angle);
    for (let j = 1; j < steps; j++) {
      const t = j / steps;
      const direction = sin < 1e-9 ? from.clone().lerp(to, t).normalize()
        : from.clone().multiplyScalar(Math.sin((1 - t) * angle) / sin).addScaledVector(to, Math.sin(t * angle) / sin);
      out.push(direction.multiplyScalar(a.length() + (b.length() - a.length()) * t));
    }
    out.push(b.clone());
  }
  return out;
}

function requireNetwork(network: TrailNetwork, what = 'pathways'): void {
  if (network.dropped.length || network.caves.length || network.segments.some(s => s.hidden)) {
    throw new Error(`Cannot draw all ${what} between islands: ${JSON.stringify({ dropped: network.dropped, caves: network.caves })}`);
  }
}

/** The candidate poles: a fixed Fibonacci spiral of 4000 directions, about 3° apart. */
const POLES = Array.from({ length: 4000 }, (_, i) => {
  const z = 1 - (2 * i + 1) / 4000, s = Math.sqrt(1 - z * z), turn = i * Math.PI * (3 - Math.sqrt(5));
  return new Vector3(s * Math.cos(turn), s * Math.sin(turn), z);
});

/**
 * The chart's pole: the direction that brings the farthest coast nearest. The chart stretches land sideways by
 * θ/sinθ at θ from its pole (2.5 times at 122°, 3.3 at 135°), so about +z a route to an island far round the globe
 * stopped well short of its coast. On storytree's own plan the farthest island's middle sits 135° from +z and 113°
 * from this pole, which weighs each island by its coast's reach.
 * It depends only on where the islands are and how far their coasts reach, so routes are kept while no island moves.
 */
function chartPole(islands: readonly { at: Vector3; reach: number }[]): Vector3 {
  if (islands.length === 0) return new Vector3(0, 0, 1);
  let best = POLES[0]!, worst = Infinity;
  for (const pole of POLES) {
    let far = 0;
    for (const island of islands) far = Math.max(far, pole.angleTo(island.at) + island.reach);
    if (far < worst) { best = pole; worst = far; }
  }
  return best;
}

/** Everything a drawing's lanes are laid out from, before and apart from routing them. */
function chartPathways(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number) {
  const pole = chartPole(scene.islands.flatMap(island => {
    const spot = spots.get(island.story);
    return spot ? [{ at: new Vector3(spot.x, spot.y, spot.z), reach: islandCoastReach(island) / radius }] : [];
  }));
  const toChart = new Quaternion().setFromUnitVectors(pole, new Vector3(0, 0, 1)), fromChart = toChart.clone().invert();
  const chart = (v: Vector3): Point => {
    const n = v.clone().normalize().applyQuaternion(toChart), angle = Math.acos(Math.max(-1, Math.min(1, n.z))), s = Math.hypot(n.x, n.y);
    if (s < 1e-10) {
      if (n.z < 0) throw new Error('A pathway cannot chart the antipode of the islands\' middle');
      return { x: 0, y: 0 };
    }
    return { x: radius * angle * n.x / s, y: radius * angle * n.y / s };
  };
  const sphere = (p: Point): Vector3 => {
    const d = Math.hypot(p.x, p.y), angle = d / radius;
    return (d < 1e-10 ? new Vector3(0, 0, 1)
      : new Vector3(Math.sin(angle) * p.x / d, Math.sin(angle) * p.y / d, Math.cos(angle))).applyQuaternion(fromChart);
  };
  const grounds = new Map<string, Ground>();
  const owners = new Map<string, string>();
  const surface = onIslandSurface(radius);
  for (const island of scene.islands) {
    const spot = spots.get(island.story);
    if (!spot) throw new Error(`No planet spot for story ${island.story}`);
    const prepared = prepareGround(island);
    const transform = plateTransform(spot, radius), at = new Vector3(...transform.position);
    const g: Ground = { ...prepared, id: island.story, transform, surface, at, chartRings: [], centre: chart(at), r: 0 };
    g.chartRings = g.rings.map(ring => ring.map(local => ({ ...chart(onGround(g, local)), local })));
    g.r = Math.max(...g.chartRings.flat().map(p => Math.hypot(p.x - g.centre.x, p.y - g.centre.y)));
    grounds.set(g.id, g);
    owners.set(island.story, g.id);
    for (const tree of island.trees) if (tree.capability !== undefined) owners.set(tree.capability, g.id);
  }
  const links: Link[] = [...new Map((scene.links ?? []).map(edge => [keyOf(edge), edge])).values()].map(edge => {
    const source = owners.get(edge.from), target = owners.get(edge.to);
    if (source === undefined || target === undefined) throw new Error(`Unknown capability endpoint for pathway ${displayKey(edge)}`);
    if (edge.from === edge.to) throw new Error(`A capability pathway cannot connect to itself: ${edge.from}`);
    return { ...edge, source, target };
  });
  const cross = links.filter(link => link.source !== link.target);
  // One route per pair of islands a capability link joins, kept a berth and half the
  // widest lane off every coast, so a lane never crosses or grazes another island's land.
  const pairs = [...new Map(cross.map(link => ({ from: link.source, to: link.target })).map(pair => [keyOf(pair), pair])).values()];
  const nodes = [...grounds.values()].map(g => ({ id: g.id, ...g.centre, r: g.r, outline: g.chartRings.map(ring => ring.map(({ x, y }) => ({ x, y }))) }));
  const routing: CrossRouting = { islands: nodes,
    lanes: { edges: pairs, seed: 'globe-lanes-seed', tuning: { cellSize: 2, clearance: LANE_CLEARANCE, falloff: 2 * LANE_CLEARANCE, meanderAmp: 0.4 } } };
  return { grounds, cross, chart, sphere, routing, key: JSON.stringify([nodes, pairs]) };
}

/** A routed network laid on the globe: each segment's points, ids prefixed, from dock to dock, and each edge's docks by
 * its pair of islands. Docks are where the network's ends meet each island's coast. */
function laidOnGlobe(network: TrailNetwork, prefix: string, grounds: ReadonlyMap<string, Ground>, chart: (v: Vector3) => Point,
  sphere: (p: Point) => Vector3, radius: number) {
  const crossSegments = new Map(network.segments.map(segment => [segment.id, segment]));
  const edges = new Map(network.edges.map(edge => [keyOf(edge), edge]));
  const docks = new Map<string, Dock>();
  const pairDocks = new Map<string, { source: Dock; target: Dock }>();
  for (const edge of network.edges) {
    const dockAt = (story: string, first: boolean): Dock => {
      const ref = first ? edge.segments[0] : edge.segments.at(-1);
      if (!ref) throw new Error(`Empty cross-island trail ${displayKey(edge)}`);
      const segment = crossSegments.get(ref.id)!;
      const end = first !== ref.reversed ? 0 : segment.points.length - 1;
      const key = `${segment.id}:${end}`;
      const old = docks.get(key);
      if (old) return old;
      const g = grounds.get(story)!;
      const snap = nearest(segment.points[end]!, g.chartRings);
      const dock = { story, local: snap.local, point: onGround(g, snap.local), links: new Set<string>() };
      docks.set(key, dock);
      return dock;
    };
    pairDocks.set(keyOf(edge), { source: dockAt(edge.from, true), target: dockAt(edge.to, false) });
  }
  const segments = network.segments.map(segment => {
    const routed = spline(segment);
    const ends = [docks.get(`${segment.id}:0`), docks.get(`${segment.id}:${segment.points.length - 1}`)];
    // The router ends a lane on its island's charted coast; the dock is the nearest coast to that end, so any straight
    // line left between them on the chart is the snap from the router's polyline to the coast's, sampled at its step.
    const points = clearOfLand([...ends[0] ? [chart(ends[0].point)] : [], ...routed, ...ends[1] ? [chart(ends[1].point)] : []]
      .flatMap((point, i, all) => {
        if (i === 0) return [point];
        const from = all[i - 1]!, steps = Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / CHART_STEP);
        return Array.from({ length: steps }, (_, j) => j + 1 === steps ? point
          : { x: from.x + (point.x - from.x) * (j + 1) / steps, y: from.y + (point.y - from.y) * (j + 1) / steps });
      }), grounds);
    const walk = [0];
    for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const length = walk.at(-1)!;
    // Over the sea a lane rides its lift above the glass; within 8 units of a dock it eases to the dock's height. A short
    // lane's two approaches overlap, so it blends between its ends' heights rather than adding them up. A junction,
    // an end with no dock, rides at the lift on every lane that meets there, so the chain does not break at it.
    const height = (end: Dock | undefined) => end ? end.point.length() - radius : LANE_LIFT;
    const ease = Math.min(8, length);
    const world = points.map((point, i) => {
      const from = ends[0] ? Math.max(0, 1 - walk[i]! / 8) : 0;
      const to = ends[1] ? Math.max(0, 1 - (length - walk[i]!) / 8) : 0;
      const junction = (ends[0] ? 1 : Math.min(1, walk[i]! / ease)) * (ends[1] ? 1 : Math.min(1, (length - walk[i]!) / ease));
      const blend = Math.max(from, to) * junction;
      const dock = from + to === 0 ? LANE_LIFT : (height(ends[0]) * from + height(ends[1]) * to) / (from + to);
      return sphere(point).multiplyScalar(radius + LANE_LIFT + (dock - LANE_LIFT) * blend);
    });
    if (ends[0]) world[0] = ends[0].point.clone();
    if (ends[1]) world[world.length - 1] = ends[1].point.clone();
    const approach = (end: Dock | undefined, at: Point) => end ? Math.hypot(chart(end.point).x - at.x, chart(end.point).y - at.y) : 0;
    const unrouted = Math.max(approach(ends[0], routed[0]!), approach(ends[1], routed.at(-1)!),
      ...world.slice(1).map((point, i) => point.distanceTo(world[i]!)));
    return { id: `${prefix}${segment.id}`, points: alongTheGlobe(world), links: [] as string[], unrouted };
  });
  return { segments, edges, docks, pairDocks };
}

/** How far apart, in chart units, the gentlest curve's control points are spaced, widest first: a stretch takes the
 * widest whose curve keeps clear of land (`clearOfLand`), none at last (the route as the router drew it). */
const CURVE_SPANS = [24, 18, 12, 9, 6, 4] as const;

/** How near, in chart units, a curved lane may come to a coast away from its own docks: the routed lane keeps
 * LANE_CLEARANCE off, and the curve may cut a bend by less than half of that. */
const CURVE_KEEP = 2;

/** `points` drawn as the gentlest curve that keeps clear of land (ADR-1307 D4, the owner, 2026-11-10: "fine dots
 * with gentle curves"): the widest of CURVE_SPANS whose curve (`gentleCurve`) comes no nearer than CURVE_KEEP to any
 * island's coast, except within that and a little more of its own two ends, which dock on a coast. */
export function clearOfLand(points: readonly Point[], grounds: ReadonlyMap<string, Pick<Ground, 'centre' | 'r' | 'chartRings'>>): Point[] {
  const [first, last] = [points[0]!, points.at(-1)!];
  const near = (p: Point, q: Point, d: number) => Math.hypot(p.x - q.x, p.y - q.y) < d;
  for (const span of CURVE_SPANS) {
    const curve = gentleCurve(points, span, CHART_STEP);
    const clear = curve.every(p => near(p, first, CURVE_KEEP + 2) || near(p, last, CURVE_KEEP + 2) || [...grounds.values()].every(g =>
      !near(p, g.centre, g.r + CURVE_KEEP) || (!insideRings(p, g.chartRings) && !near(p, nearest(p, g.chartRings), CURVE_KEEP))));
    if (clear) return curve;
  }
  return [...points];
}

/** Whether `p` lies inside a coast's rings (even-odd). */
function insideRings(p: Point, rings: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A polyline's gentle curve: its points taken every about `span` along it (its ends kept), and a cubic B-spline through
 * those, clamped to the two ends and sampled about every `step`. A right-angle bend becomes an arc of radius about two
 * thirds of `span` that cuts the corner by about a quarter of `span`; a line shorter than two spans is kept as it is. */
export function gentleCurve(points: readonly Point[], span: number, step: number): Point[] {
  const walk = [0];
  for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const length = walk.at(-1)!, n = Math.round(length / span);
  if (n < 2) return points.map(p => ({ x: p.x, y: p.y }));
  let i = 1;
  const control = Array.from({ length: n + 1 }, (_, k) => {
    const d = k * length / n;
    while (i < points.length - 1 && walk[i]! < d) i++;
    const a = points[i - 1]!, b = points[i]!, t = (d - walk[i - 1]!) / (walk[i]! - walk[i - 1]! || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
  const c = [control[0]!, control[0]!, ...control, control[n]!, control[n]!], per = Math.max(1, Math.ceil(length / n / step));
  const out: Point[] = [];
  for (let s = 0; s + 3 < c.length; s++) for (let j = s === 0 ? 0 : 1; j <= per; j++) {
    const t = j / per, w = [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
    out.push({ x: w.reduce((sum, wk, k) => sum + wk * c[s + k]!.x, 0), y: w.reduce((sum, wk, k) => sum + wk * c[s + k]!.y, 0) });
  }
  // The clamped spline ends where the line does, but exactly, so a junction's segments still meet.
  out[0] = { x: points[0]!.x, y: points[0]!.y };
  out[out.length - 1] = { x: points.at(-1)!.x, y: points.at(-1)!.y };
  return out;
}

/** Each capability link between islands on `laid`'s chain for its pair of islands, its docks and segments carrying it. */
function linkOnto(laid: ReturnType<typeof laidOnGlobe>, prefix: string, cross: readonly Link[]) {
  const edges = cross.map(link => {
    const pairKey = keyOf({ from: link.source, to: link.target });
    const pair = laid.pairDocks.get(pairKey), edge = laid.edges.get(pairKey);
    if (!pair || !edge) throw new Error(`Missing cross-island route for ${displayKey(link)}`);
    pair.source.links.add(displayKey(link));
    pair.target.links.add(displayKey(link));
    return { from: link.from, to: link.to, segments: refPrefix(prefix, edge), islands: [link.source, link.target] as const, ...link.typeOnly ? { typeOnly: true as const } : {} };
  });
  const segmentById = new Map(laid.segments.map(segment => [segment.id, segment]));
  for (const edge of edges) for (const ref of edge.segments) {
    const segment = segmentById.get(ref.id);
    if (!segment) throw new Error(`Missing pathway segment ${ref.id}`);
    if (!segment.links.includes(displayKey(edge))) segment.links.push(displayKey(edge));
  }
  const typeOnly = new Set(edges.filter(edge => edge.typeOnly).map(displayKey));
  const docks = [...laid.docks.values()].map(dock => ({ story: dock.story, point: dock.point, local: dock.local, links: [...dock.links].sort() }));
  return { edges, segmentById, typeOnly, docks };
}

/** One ordered chain per recorded capability edge between islands, from dock to dock; a link within an island has
 * none, since nothing draws it (ADR-0951 D3). Routes are planned on an azimuthal chart about the islands' own middle
 * (`chartPole`). */
export function buildPlanetPathways(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number, route: typeof routeTrails = routeTrails): PlanetPathways {
  const { grounds, cross, chart, sphere, routing, key: crossKey } = chartPathways(scene, spots, radius);
  const network = keptNetwork(crossKey, routing) ?? routePlanet(routing, route);
  // A drawing with no lanes between islands leaves the last routing kept.
  if (routing.lanes.edges.length > 0) crossRoutes = { key: crossKey, routing, network };
  requireNetwork(network.lanes, 'lanes');
  const lanes = laidOnGlobe(network.lanes, 'lane:', grounds, chart, sphere, radius);
  const segments: PlanetLaneSegment[] = lanes.segments;
  const { edges, typeOnly, docks } = linkOnto(lanes, 'lane:', cross);
  const plan: PlanetPathways = { plates: new Map(), lanes: { segments, edges, docks } };
  for (const g of grounds.values()) plan.plates.set(g.id, g.plate);
  for (const segment of segments) {
    if (segment.links.length === 0) throw new Error(`Orphan lane segment ${segment.id}`);
    segment.links.sort();
    const typed = segment.links.filter(link => typeOnly.has(link)).length;
    if (typed > 0) segment.typeOnlyLinks = typed;
  }
  return plan;
}

/** A routing failure is visible without taking any island (especially a failing one) off the page, and is logged. */
export function planetPathwayDrawing(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number, route: typeof routeTrails = routeTrails): PathwayDrawing {
  const { kept, leftOut } = drawnLinks(scene);
  try {
    return { plan: buildPlanetPathways({ ...scene, links: kept }, spots, radius, route), issue: leftOut };
  } catch (error) {
    console.error('forest-world planet: the lanes could not be drawn', error);
    return {
      plan: buildPlanetPathways({ ...scene, links: [] }, spots, radius),
      issue: [error instanceof Error ? error.message : String(error), leftOut].filter(Boolean).join('; '),
    };
  }
}

export interface PathwayDrawing { plan: PlanetPathways; issue: string | undefined }

/** The links a drawing routes, and the notice naming those it leaves out. A link naming a capability on no island
 * (one depending on a retired capability, say) is left out on its own, rather than costing every lane. A link end
 * may name an island as a whole, by its story. */
function drawnLinks(scene: ForestScene) {
  const drawn = new Set(scene.islands.flatMap(island => [island.story, ...island.trees.flatMap(tree => tree.capability === undefined ? [] : [tree.capability])]));
  const links = scene.links ?? [];
  const kept = links.filter(link => drawn.has(link.from) && drawn.has(link.to));
  const left = links.filter(link => !kept.includes(link)).map(link => `${link.from}->${link.to}`);
  const leftOut = left.length === 0 ? undefined : `Left out ${left.length === 1 ? 'a link' : `${left.length} links`} naming a capability on no island: ${left.join(', ')}`;
  return { kept, leftOut };
}

/** The routing a drawing still waits on: undefined when it routes nothing between islands, its routes are kept from
 * the last routing, or a link it cannot draw leaves it to say so without routing. */
export function pathwayRouting(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number): { key: string; routing: CrossRouting } | undefined {
  let charted: ReturnType<typeof chartPathways>;
  try {
    charted = chartPathways({ ...scene, links: drawnLinks(scene).kept }, spots, radius);
  } catch {
    // Not logged here: planetPathwayDrawing, which the drawing falls back to, meets the same failure and logs it.
    return undefined;
  }
  return charted.routing.lanes.edges.length === 0 || keptNetwork(charted.key, charted.routing) !== undefined ? undefined : { key: charted.key, routing: charted.routing };
}

/** Keeps a network routed elsewhere (in a worker) as this page's last routing, so its drawing routes nothing. */
export function keepRoutes({ key, routing }: { key: string; routing: CrossRouting }, network: PlanetNetworks): void {
  crossRoutes = { key, routing, network };
}

/** Whether `key`'s routes are the ones kept from the last routing. */
export function routesKept(key: string): boolean {
  return crossRoutes?.key === key;
}

/** Every island's plate and no lanes: what is on show while the lanes are routed. */
export function islandsOnly(scene: ForestScene): PathwayDrawing {
  return { plan: { plates: new Map(scene.islands.map(island => [island.story, prepareGround(island).plate])),
    lanes: { segments: [], edges: [], docks: [] } }, issue: undefined };
}
