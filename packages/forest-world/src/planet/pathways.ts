/** Capability 6 · The planet. Capability trails over the glass between tangent islands, dock to dock (forest contracts 3.6–3.7).
 * The existing cost-grid router owns routing, merging and width; this adapter only changes spaces. */
import type { ForestScene, Island } from '../scene.js';
import { Quaternion, Vector3 } from 'three';
import { clipToCoast, rimLoops, SHIPPED_COAST, type CoastPoint } from '../coast-clip.js';
import { routeTrails, trailFillWidth, type TrailEdgeIn, type TrailEdgeOut, type TrailNetwork, type TrailSegment } from '../core/routing.js';
import { forestDescriptors } from '../forest-ground/forest-ground.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import type { Descriptor3D, InstanceDescriptor } from '../descriptors.js';
import { onIslandSurface } from './island-surface.js';
import { plateTransform, type PlanetSpot } from './planet.js';

export interface PlanetPathwayPlate {
  descriptors: Descriptor3D[];
  /** The island's coast loops in the plate's local ground coordinates: the outline of its flat surface. */
  coast: CoastPoint[][];
}

export interface PlanetPathwaySegment {
  id: string;
  points: Vector3[];
  /** Physical ground units, from the original capability links sharing this segment. */
  width: number;
  links: string[];
  /** On a road between islands: its longest stretch, in ground units, that the router never planned: the straight
   * run on the chart from where the router ends it to its dock on the coast, or a gap the globe filled in along its
   * surface. */
  unrouted?: number;
}

export interface PlanetPathways {
  plates: Map<string, PlanetPathwayPlate>;
  segments: PlanetPathwaySegment[];
  edges: TrailEdgeOut[];
  docks: { story: string; point: Vector3; local: CoastPoint; links: string[] }[];
  /** A plain lane for each of the scene's row links, by story id, coast to coast along the globe: lit on selection
   * only, never drawn as a road. */
  rowLanes?: { from: string; to: string; points: Vector3[] }[];
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
interface Link extends TrailEdgeIn { source: string; target: string }
interface Dock { story: string; local: CoastPoint; point: Vector3; links: Set<string> }

// Polls preserve unchanged island objects; retain their ground input and relief through routing.
const preparedGrounds = new WeakMap<Island, PreparedGround>();
// Routing is the costly part (ADR-0836 D1): the routes between islands are kept while every island's place and size are.
let crossRoutes: { key: string; network: TrailNetwork } | undefined;
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
 * plate a coast 80 units out stood 11 units over its drawn land, and the road climbing to it showed past the globe's
 * edge (the owner, 2026-10-06: "the payways look to flow off the globe when they hit the edge rather then end"). */
function onGround(g: Ground, p: CoastPoint): Vector3 {
  return g.surface(p).applyQuaternion(g.transform.quaternion).add(g.at);
}

/** The farthest apart two points of a road between islands are on the chart, in chart units: the router's own step. */
const CHART_STEP = 0.8;

/** How far over the glass a road between islands rides, away from its docks, in ground units. */
const ROAD_LIFT = 1.02;

/** The farthest apart two points of a road between islands may be, in ground units: the ribbon is drawn straight
 * between them, and at this length it sags a fraction of a unit, so it stays on the glass. */
const MAX_ROAD_STEP = 1;

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
    const steps = Math.ceil(a.distanceTo(b) / MAX_ROAD_STEP);
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

/** A plain lane between two islands (a row link's, which has no road): from the coast point of `to` nearest `from`
 * to the coast point of `from` nearest that, riding the road lift over the globe and easing to each dock's height. */
function coastToCoast(from: Ground, to: Ground, radius: number, coasts: Map<Ground, Vector3[]>): Vector3[] {
  const coast = (g: Ground) => coasts.get(g) ?? coasts.set(g, g.rings.flat().map(local => onGround(g, local))).get(g)!;
  const nearestTo = (points: Vector3[], target: Vector3) => points.reduce((best, p) => p.distanceTo(target) < best.distanceTo(target) ? p : best);
  const start = nearestTo(coast(to), from.at), end = nearestTo(coast(from), start);
  // Waypoints a tenth of a radian apart first: alongTheGlobe fills a gap by its straight chord, short of the arc on a long lane.
  const angle = start.angleTo(end), waypoints = Math.max(1, Math.ceil(angle / 0.1));
  const points = alongTheGlobe(Array.from({ length: waypoints + 1 }, (_, i) => {
    const t = i / waypoints, sin = Math.sin(angle);
    if (i === 0 || i === waypoints || sin < 1e-9) return (i === waypoints ? end : start).clone();
    return start.clone().normalize().multiplyScalar(Math.sin((1 - t) * angle) / sin).addScaledVector(end.clone().normalize(), Math.sin(t * angle) / sin)
      .setLength(start.length() + (end.length() - start.length()) * t);
  }));
  const walk = [0];
  for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + points[i]!.distanceTo(points[i - 1]!));
  const length = walk.at(-1)!;
  return points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return point;
    const ease = Math.max(0, 1 - Math.min(walk[i]!, length - walk[i]!) / 8);
    return point.clone().setLength(radius + ROAD_LIFT + (point.length() - radius - ROAD_LIFT) * ease);
  });
}

function requireNetwork(network: TrailNetwork): void {
  if (network.dropped.length || network.caves.length || network.segments.some(s => s.hidden)) {
    throw new Error(`Cannot draw all pathways between islands: ${JSON.stringify({ dropped: network.dropped, caves: network.caves })}`);
  }
}

/** The candidate poles: a fixed Fibonacci spiral of 4000 directions, about 3° apart. */
const POLES = Array.from({ length: 4000 }, (_, i) => {
  const z = 1 - (2 * i + 1) / 4000, s = Math.sqrt(1 - z * z), turn = i * Math.PI * (3 - Math.sqrt(5));
  return new Vector3(s * Math.cos(turn), s * Math.sin(turn), z);
});

/**
 * The chart's pole: the direction that brings the farthest coast nearest. The chart stretches land sideways by
 * θ/sinθ at θ from its pole (2.5 times at 122°, 3.3 at 135°), so about +z a road to an island far round the globe
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

/** One ordered chain per recorded capability edge between islands, from dock to dock; a link within an island has
 * none, since nothing draws it (ADR-0951 D3). Routes are planned on an azimuthal chart about the islands' own middle
 * (`chartPole`). */
export function buildPlanetPathways(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number, route: typeof routeTrails = routeTrails): PlanetPathways {
  const plan: PlanetPathways = { plates: new Map(), segments: [], edges: [], docks: [] };
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
    for (const tree of island.trees) if (tree.capability !== undefined) owners.set(tree.capability, g.id);
  }
  const links: Link[] = [...new Map((scene.links ?? []).map(edge => [keyOf(edge), edge])).values()].map(edge => {
    const source = owners.get(edge.from), target = owners.get(edge.to);
    if (source === undefined || target === undefined) throw new Error(`Unknown capability endpoint for pathway ${displayKey(edge)}`);
    if (edge.from === edge.to) throw new Error(`A capability pathway cannot connect to itself: ${edge.from}`);
    return { ...edge, source, target };
  });
  const cross = links.filter(link => link.source !== link.target);
  const pairs = [...new Map(cross.map(link => {
    const pair = { from: link.source, to: link.target };
    return [keyOf(pair), pair];
  })).values()];
  const maxWidth = trailFillWidth(cross.length) * RIBBON_GROUND_SCALE;
  const nodes = [...grounds.values()].map(g => ({ id: g.id, ...g.centre, r: g.r, outline: g.chartRings.map(ring => ring.map(({ x, y }) => ({ x, y }))) }));
  const crossKey = JSON.stringify([nodes, pairs, maxWidth]);
  const network = crossRoutes?.key === crossKey ? crossRoutes.network
    : route(nodes, pairs, 'globe-pathways-real-seed', { cellSize: 2, clearance: maxWidth / 2 + 1, falloff: maxWidth, meanderAmp: 0.4 });
  crossRoutes = { key: crossKey, network };
  requireNetwork(network);
  const crossSegments = new Map(network.segments.map(segment => [segment.id, segment]));
  const crossEdges = new Map(network.edges.map(edge => [keyOf(edge), edge]));
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
  for (const segment of network.segments) {
    const routed = spline(segment);
    const ends = [docks.get(`${segment.id}:0`), docks.get(`${segment.id}:${segment.points.length - 1}`)];
    // The router ends a road on its island's charted coast; the dock is the nearest coast to that end, so any straight
    // line left between them on the chart is the snap from the router's polyline to the coast's, sampled at its step.
    const points = [...ends[0] ? [chart(ends[0].point)] : [], ...routed, ...ends[1] ? [chart(ends[1].point)] : []]
      .flatMap((point, i, all) => {
        if (i === 0) return [point];
        const from = all[i - 1]!, steps = Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / CHART_STEP);
        return Array.from({ length: steps }, (_, j) => j + 1 === steps ? point
          : { x: from.x + (point.x - from.x) * (j + 1) / steps, y: from.y + (point.y - from.y) * (j + 1) / steps });
      });
    const walk = [0];
    for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const length = walk.at(-1)!;
    // Over the sea a road rides its lift above the glass; within 8 units of a dock it eases to the dock's height. A short
    // road's two approaches overlap, so it blends between its ends' heights rather than adding them up. A junction,
    // an end with no dock, rides at the lift on every road that meets there, so the chain does not break at it.
    const height = (end: Dock | undefined) => end ? end.point.length() - radius : ROAD_LIFT;
    const ease = Math.min(8, length);
    const world = points.map((point, i) => {
      const from = ends[0] ? Math.max(0, 1 - walk[i]! / 8) : 0;
      const to = ends[1] ? Math.max(0, 1 - (length - walk[i]!) / 8) : 0;
      const junction = (ends[0] ? 1 : Math.min(1, walk[i]! / ease)) * (ends[1] ? 1 : Math.min(1, (length - walk[i]!) / ease));
      const blend = Math.max(from, to) * junction;
      const dock = from + to === 0 ? ROAD_LIFT : (height(ends[0]) * from + height(ends[1]) * to) / (from + to);
      return sphere(point).multiplyScalar(radius + ROAD_LIFT + (dock - ROAD_LIFT) * blend);
    });
    if (ends[0]) world[0] = ends[0].point.clone();
    if (ends[1]) world[world.length - 1] = ends[1].point.clone();
    const approach = (end: Dock | undefined, at: Point) => end ? Math.hypot(chart(end.point).x - at.x, chart(end.point).y - at.y) : 0;
    const unrouted = Math.max(approach(ends[0], routed[0]!), approach(ends[1], routed.at(-1)!),
      ...world.slice(1).map((point, i) => point.distanceTo(world[i]!)));
    plan.segments.push({ id: `cross:${segment.id}`, points: alongTheGlobe(world), width: 0, links: [], unrouted });
  }

  for (const g of grounds.values()) plan.plates.set(g.id, g.plate);
  for (const link of cross) {
    const pairKey = keyOf({ from: link.source, to: link.target });
    const pair = pairDocks.get(pairKey), edge = crossEdges.get(pairKey);
    if (!pair || !edge) throw new Error(`Missing cross-island route for ${displayKey(link)}`);
    pair.source.links.add(displayKey(link));
    pair.target.links.add(displayKey(link));
    plan.edges.push({ from: link.from, to: link.to, segments: refPrefix('cross:', edge) });
  }
  const segmentById = new Map(plan.segments.map(segment => [segment.id, segment]));
  for (const edge of plan.edges) for (const ref of edge.segments) {
    const segment = segmentById.get(ref.id);
    if (!segment) throw new Error(`Missing pathway segment ${ref.id}`);
    if (!segment.links.includes(displayKey(edge))) segment.links.push(displayKey(edge));
  }
  for (const segment of plan.segments) {
    if (segment.links.length === 0) throw new Error(`Orphan pathway segment ${segment.id}`);
    segment.links.sort();
    segment.width = trailFillWidth(segment.links.length) * RIBBON_GROUND_SCALE;
  }
  plan.docks = [...docks.values()].map(dock => ({ story: dock.story, point: dock.point, local: dock.local, links: [...dock.links].sort() }));
  const coasts = new Map<Ground, Vector3[]>();
  plan.rowLanes = (scene.rowLinks ?? []).flatMap(({ from, to }) => {
    const a = grounds.get(from), b = grounds.get(to);
    return a === undefined || b === undefined || a === b ? [] : [{ from, to, points: coastToCoast(a, b, radius, coasts) }];
  });
  return plan;
}

/** A routing failure is visible without taking any island (especially a failing one) off the page. */
export function planetPathwayDrawing(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number): {
  plan: PlanetPathways; issue: string | undefined;
} {
  // A link naming a capability on no island (one depending on a retired capability, say) is left out on its own,
  // rather than costing every road; the notice names it.
  const drawn = new Set(scene.islands.flatMap(island => island.trees.flatMap(tree => tree.capability === undefined ? [] : [tree.capability])));
  const links = scene.links ?? [];
  const kept = links.filter(link => drawn.has(link.from) && drawn.has(link.to));
  const left = links.filter(link => !kept.includes(link)).map(link => `${link.from}->${link.to}`);
  const leftOut = left.length === 0 ? undefined : `Left out ${left.length === 1 ? 'a link' : `${left.length} links`} naming a capability on no island: ${left.join(', ')}`;
  try {
    return { plan: buildPlanetPathways({ ...scene, links: kept }, spots, radius), issue: leftOut };
  } catch (error) {
    return {
      plan: buildPlanetPathways({ ...scene, links: [] }, spots, radius),
      issue: [error instanceof Error ? error.message : String(error), leftOut].filter(Boolean).join('; '),
    };
  }
}
