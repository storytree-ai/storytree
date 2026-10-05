/** Capability trails on tangent islands and the glass between them (forest contracts 3.6–3.7).
 * The existing cost-grid router owns routing, merging and width; this adapter only changes spaces. */
import type { ForestScene, Island } from '../scene.js';
import { Vector3 } from 'three';
import { clipToCoast, rimLoops, SHIPPED_COAST, type CoastPoint } from '../coast-clip.js';
import { routeTrails, trailFillWidth, type TrailEdgeIn, type TrailEdgeOut, type TrailNetwork, type TrailSegment } from '../core/routing.js';
import { forestDescriptors, parcelSpots } from '../forest-ground/forest-ground.js';
import { shoreRelief, type ShoreRelief } from '../shore-fall.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import type { Descriptor3D, InstanceDescriptor } from '../descriptors.js';
import { plateTransform, type PlanetSpot } from './planet.js';

export interface PlanetPathwayPlate {
  descriptors: Descriptor3D[];
  paths: Map<string, CoastPoint[][]>;
  /** The island's coast loops in the plate's local ground coordinates: the outline of its flat surface. */
  coast: CoastPoint[][];
}

export interface PlanetPathwaySegment {
  id: string;
  /** Present only for a route on that island; the cross-island ribbon draws the others. */
  island?: string;
  points: Vector3[];
  /** Physical ground units, from the original capability links sharing this segment. */
  width: number;
  links: string[];
}

export interface PlanetPathways {
  plates: Map<string, PlanetPathwayPlate>;
  segments: PlanetPathwaySegment[];
  edges: TrailEdgeOut[];
  docks: { story: string; point: Vector3; local: CoastPoint; links: string[] }[];
}

interface Point { x: number; y: number }
interface ChartPoint extends Point { local: CoastPoint }
interface PreparedGround {
  descriptors: Descriptor3D[];
  parcels: Map<string, CoastPoint>;
  relief: ShoreRelief;
  rings: CoastPoint[][];
}
interface Ground extends PreparedGround {
  id: string;
  transform: ReturnType<typeof plateTransform>;
  at: Vector3;
  chartRings: ChartPoint[][];
  centre: Point;
  r: number;
}
interface Link extends TrailEdgeIn { source: string; target: string }
interface Dock { id: string; story: string; local: CoastPoint; point: Vector3; links: Set<string> }

// Polls preserve unchanged island objects; retain their ground input and relief through routing.
const preparedGrounds = new WeakMap<Island, PreparedGround>();
const pathwayPlates = new WeakMap<Descriptor3D[], { key: string; plate: PlanetPathwayPlate }>();
// Routing is the costly part (ADR-0836 D1): an island's own routes are kept while its ground and docks are,
// and the routes between islands while every island's place and size are.
const localRoutes = new WeakMap<Descriptor3D[], { key: string; network: TrailNetwork }>();
let crossRoutes: { key: string; network: TrailNetwork } | undefined;
function prepareGround(island: Island): PreparedGround {
  const old = preparedGrounds.get(island);
  if (old) return old;
  const descriptors = forestDescriptors({ islands: [{ ...island, x: 0, z: 0 }] });
  const cells = clipToCoast(descriptors.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.points !== undefined), SHIPPED_COAST);
  const prepared = { descriptors, parcels: parcelSpots(descriptors), relief: shoreRelief(cells), rings: rimLoops(cells.map(c => c.points!)) };
  preparedGrounds.set(island, prepared);
  return prepared;
}

/** How far the island's coast reaches from its middle, in ground units: what the globe leaves room for (ADR-0804 D7). */
export function islandCoastReach(island: Island): number {
  return Math.max(0, ...prepareGround(island).rings.flat().map(point => Math.hypot(point.x, point.z)));
}

const keyOf = (edge: TrailEdgeIn) => JSON.stringify([edge.from, edge.to]);
const displayKey = (edge: TrailEdgeIn) => `${edge.from}->${edge.to}`;
const refPrefix = (prefix: string, edge: TrailEdgeOut) => edge.segments.map(ref => ({ ...ref, id: prefix + ref.id }));
const reverseChain = (chain: TrailEdgeOut['segments']) => [...chain].reverse().map(ref => ({ id: ref.id, reversed: !ref.reversed }));

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

function inside(p: Point, rings: readonly (readonly Point[])[]): boolean {
  let yes = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
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

function onGround(g: Ground, p: CoastPoint): Vector3 {
  return new Vector3(p.x, g.relief.height(p.x, p.z), p.z).applyQuaternion(g.transform.quaternion).add(g.at);
}

/** The farthest apart two points of a road between islands may be, in ground units: the ribbon is drawn straight
 * between them, and at this length it sags a fraction of a unit, so it stays on the glass. */
const MAX_ROAD_STEP = 1;

/**
 * `points` with every longer gap filled in along the globe's surface, its height eased between the gap's ends.
 * The route is planned on an azimuthal chart that stretches islands far from its pole sideways (up to 3.3 times at
 * 135°), so a route can stop well short of a far island's coast; its dock was then joined by one straight chord
 * through the ball (the owner, 2026-10-05: "i can see a stray pathway").
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

function requireNetwork(network: TrailNetwork, where: string, cross = false): void {
  if (network.dropped.length || (cross && (network.caves.length || network.segments.some(s => s.hidden)))) {
    throw new Error(`Cannot draw all pathways ${where}: ${JSON.stringify({ dropped: network.dropped, caves: network.caves })}`);
  }
}

/** One ordered chain per recorded capability edge, including its two shore connections.
 * The azimuthal chart covers the fixed 36-place spiral, including its occupied far hemisphere. */
export function buildPlanetPathways(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number, route: typeof routeTrails = routeTrails): PlanetPathways {
  const plan: PlanetPathways = { plates: new Map(), segments: [], edges: [], docks: [] };
  const chart = (v: Vector3): Point => {
    const n = v.clone().normalize(), angle = Math.acos(Math.max(-1, Math.min(1, n.z))), s = Math.hypot(n.x, n.y);
    if (s < 1e-10) {
      if (n.z < 0) throw new Error('A pathway cannot chart the antipode of the fixed planet spiral');
      return { x: 0, y: 0 };
    }
    return { x: radius * angle * n.x / s, y: radius * angle * n.y / s };
  };
  const sphere = (p: Point): Vector3 => {
    const d = Math.hypot(p.x, p.y), angle = d / radius;
    return d < 1e-10 ? new Vector3(0, 0, 1)
      : new Vector3(Math.sin(angle) * p.x / d, Math.sin(angle) * p.y / d, Math.cos(angle));
  };
  const grounds = new Map<string, Ground>();
  const owners = new Map<string, string>();
  for (const island of scene.islands) {
    const spot = spots.get(island.story);
    if (!spot) throw new Error(`No planet spot for story ${island.story}`);
    const prepared = prepareGround(island);
    const transform = plateTransform(spot, radius), at = new Vector3(...transform.position);
    const g: Ground = { ...prepared, id: island.story, transform, at, chartRings: [], centre: chart(at), r: 0 };
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
  const nodes = [...grounds.values()].map(g => ({ id: g.id, ...g.centre, r: g.r }));
  const crossKey = JSON.stringify([nodes, pairs, maxWidth]);
  const network = crossRoutes?.key === crossKey ? crossRoutes.network
    : route(nodes, pairs, 'globe-pathways-real-seed', { cellSize: 2, clearance: maxWidth / 2 + 1, falloff: maxWidth, meanderAmp: 0.4 });
  crossRoutes = { key: crossKey, network };
  requireNetwork(network, 'between islands', true);
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
      const dock = { id: `dock:${key}`, story, local: snap.local, point: onGround(g, snap.local), links: new Set<string>() };
      docks.set(key, dock);
      return dock;
    };
    pairDocks.set(keyOf(edge), { source: dockAt(edge.from, true), target: dockAt(edge.to, false) });
  }
  for (const segment of network.segments) {
    const points = spline(segment);
    const ends = [docks.get(`${segment.id}:0`), docks.get(`${segment.id}:${segment.points.length - 1}`)];
    if (ends[0]) points[0] = chart(ends[0].point);
    if (ends[1]) points[points.length - 1] = chart(ends[1].point);
    const walk = [0];
    for (let i = 1; i < points.length; i++) walk.push(walk[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const length = walk.at(-1)!;
    const world = points.map((point, i) => {
      const from = ends[0] ? Math.max(0, 1 - walk[i]! / 8) : 0;
      const to = ends[1] ? Math.max(0, 1 - (length - walk[i]!) / 8) : 0;
      const blend = Math.max(from, to);
      const rise = Math.max((ends[0]?.point.length() ?? radius) - radius, 0) * from
        + Math.max((ends[1]?.point.length() ?? radius) - radius, 0) * to;
      return sphere(point).multiplyScalar(radius + rise + 1.02 * (1 - blend));
    });
    if (ends[0]) world[0] = ends[0].point.clone();
    if (ends[1]) world[world.length - 1] = ends[1].point.clone();
    plan.segments.push({ id: `cross:${segment.id}`, points: alongTheGlobe(world), width: 0, links: [] });
  }

  const localEdges = new Map<string, Map<string, TrailEdgeOut>>();
  for (const g of grounds.values()) {
    const endpoints = [...g.parcels].map(([id, p]) => ({ id, x: p.x, y: p.z, r: 0.2 }));
    const input: TrailEdgeIn[] = links.filter(link => link.source === g.id && link.target === g.id);
    for (const link of cross.filter(link => link.source === g.id || link.target === g.id)) {
      const pair = pairDocks.get(keyOf({ from: link.source, to: link.target }));
      if (!pair) throw new Error(`Missing cross-island route for ${displayKey(link)}`);
      const dock = link.source === g.id ? pair.source : pair.target;
      dock.links.add(displayKey(link));
      if (!endpoints.some(p => p.id === dock.id)) endpoints.push({ id: dock.id, x: dock.local.x, y: dock.local.z, r: 0 });
      input.push({ from: link.source === g.id ? link.from : link.to, to: dock.id });
    }
    const localKey = JSON.stringify([g.id, endpoints, input]), kept = localRoutes.get(g.descriptors);
    const local = kept?.key === localKey ? kept.network : route(endpoints, input, `island:${g.id}`, { cellSize: 1, clearance: 0.3, falloff: 1,
      falloffCost: 2, meanderAmp: 0.1, meanderWavelength: 5, reclusterOnApproach: false,
      dockMergeGap: 0, dockMergeSpan: 0, junctionWeld: 0 });
    localRoutes.set(g.descriptors, { key: localKey, network: local });
    requireNetwork(local, `on island ${g.id}`);
    const rings = g.rings.map(ring => ring.map(local => ({ x: local.x, y: local.z, local })));
    const paths: CoastPoint[][] = [];
    const prefix = `island:${g.id}:`;
    for (const segment of local.segments) {
      const path = spline(segment).map(p => inside(p, rings) ? { x: p.x, z: p.y } : nearest(p, rings).local);
      paths.push(path);
      plan.segments.push({ id: prefix + segment.id, island: g.id, points: path.map(p => onGround(g, p)), width: 0, links: [] });
    }
    // A status change on another island must not rebuild this island's ground texture.
    // Routing can run again while the unchanged local wear keeps its previous identity.
    const pathKey = JSON.stringify(paths), old = pathwayPlates.get(g.descriptors);
    const plate = old?.key === pathKey ? old.plate
      : { descriptors: g.descriptors, paths: new Map([[g.id, paths]]), coast: g.rings };
    if (plate !== old?.plate) pathwayPlates.set(g.descriptors, { key: pathKey, plate });
    plan.plates.set(g.id, plate);
    localEdges.set(g.id, new Map(local.edges.map(edge => [keyOf(edge), { ...edge, segments: refPrefix(prefix, edge) }])));
  }
  const localChain = (story: string, from: string, to: string) => {
    const edge = localEdges.get(story)?.get(keyOf({ from, to }));
    if (!edge?.segments.length) throw new Error(`Missing pathway on ${story}: ${from}->${to}`);
    return edge.segments;
  };
  for (const link of links) {
    let chain: TrailEdgeOut['segments'];
    if (link.source === link.target) chain = localChain(link.source, link.from, link.to);
    else {
      const pairKey = keyOf({ from: link.source, to: link.target });
      const pair = pairDocks.get(pairKey)!, edge = crossEdges.get(pairKey)!;
      chain = [...localChain(link.source, link.from, pair.source.id), ...refPrefix('cross:', edge),
        ...reverseChain(localChain(link.target, link.to, pair.target.id))];
    }
    plan.edges.push({ from: link.from, to: link.to, segments: chain });
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
  return plan;
}

/** A routing failure is visible without taking any island (especially a failing one) off the page. */
export function planetPathwayDrawing(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number): {
  plan: PlanetPathways; issue: string | undefined;
} {
  try {
    return { plan: buildPlanetPathways(scene, spots, radius), issue: undefined };
  } catch (error) {
    return {
      plan: buildPlanetPathways({ ...scene, links: [] }, spots, radius),
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}
