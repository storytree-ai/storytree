/**
 * Capability 3 · Story node render (the forest story): each island's roads and gates (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2
 * step 3), from its territories as laid out by its links and the docks its sea lanes come ashore at, ported from the
 * capability tree mock's page (docs/design/capability-tree-3d/q-all-islands/tools/overlay.ts).
 *
 * - Laid out at The library's size, as the territories are, and given back at the island's own, widths and posts too,
 *   so every mark stands as large on the page as The library's.
 * - The links: each one between two of the island's capabilities, between their settlements; and per dock and
 *   capability, one arrival carrying every lane in to it there and one way out carrying every lane out.
 * - Each road ends at its territory's settlement: a clear spot beside its name toward the roads it meets, its whole
 *   symbol (3.4, 4.0 or 4.7 across by the roads meeting there) kept off every name and back from every border and the coast
 *   (3.79, polish round 1).
 * - A gate wherever a road crosses a border, one for the links a shared road carries through it; each link's own
 *   entrance is the gate where it last enters the territory it calls (the way out: where it first leaves its own).
 */
import { LIBRARY_LAND, ontoCoast, openReach, type Link, type LinkDock } from "./link-layout.js";
import { landArea, type Coast, type Point, type TerritoryMap } from "./territories.js";
import { roadNetwork, type BorderSeg, type Net, type NetLink } from "./road-network.js";
import { insideOf } from "../view/territory-land.js";
import { TERRITORY_WORKER_META } from "./kept-layout.js";

/** A road segment: its way, the links it carries, and its width by how many (1, 2-3, 4-7, 8 or more). */
export type RoadSegment = { readonly pts: readonly Point[]; readonly links: readonly string[]; readonly width: number };
/** A gate: where a road crosses a border, the border's direction there, the links through it, the links that enter by it
 * (whose entrance it is, 3.81), and the opening cut in it. */
export type RoadGate = { readonly at: Point; readonly along: Point; readonly links: readonly string[]; readonly entrance: boolean; readonly entrances: readonly string[]; readonly opening: number };
/** A settlement: where it stands, how many roads meet there, and its symbol's size across. */
export type Settlement = { readonly at: Point; readonly roads: number; readonly size: number };
export type IslandRoads = { readonly segments: readonly RoadSegment[]; readonly junctions: readonly { at: Point; width: number }[]; readonly gates: readonly RoadGate[]; readonly towns: ReadonlyMap<string, Point>; readonly settlements: ReadonlyMap<string, Settlement> };
/** A capability's name on the island, where the map writes it. */
export type NameAnchor = { readonly capability: string; readonly title: string; readonly x: number; readonly z: number };

/** Round 11's `sand-faint` widths, by the links a road carries: 1, 2-3, 4-7, 8 or more. */
const WIDTHS = [0.5, 0.7, 0.95, 1.3] as const;
/** The least gate opening (its posts stand on the relief, island-relief.ts). */
const GATE_OPENING = 3;
/** The mock measured names on the page at about 2.6 pixels per ground unit: a name's box, and its padding in pixels. */
const PX = 2.6;
const nameBox = (title: string) => ({ w: (title.length * 6.5 + 12) / PX, h: 7 });
/** A settlement's symbol across, by how many roads it meets (1-2, 3-5, 6 or more), and how far its edge keeps from a border. */
const SYMBOL = [3.4, 4.0, 4.7] as const, SYMBOL_EDGE = 1.5, CLEAR = 2.3;
/** How far, in pixels, every corner of a settlement's symbol keeps from a name (polish round 1's SYMBOL_CLEAR). */
const SYMBOL_CLEAR = 4;
const symbolSize = (roads: number) => SYMBOL[roads >= 6 ? 2 : roads >= 3 ? 1 : 0];
/** What a gate under a name or beside a settlement costs more (polish round 3), and a road under a name. */
const GATE_CLEAR = 18, UNDER_NAME = 2.5;

const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const times = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });
export const widthOf = (n: number) => WIDTHS[n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0];

const routed = new WeakMap<TerritoryMap, { key: string; roads: IslandRoads }>();

/** The roads and gates of `map` (the island as drawn, laid out by `links` and `docks`), its names at `names`; routed
 * once for the same map, links, docks and names, whoever asks. */
export function islandRoads(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[]): IslandRoads {
  const key = JSON.stringify([links, docks, names]), known = routed.get(map);
  if (known?.key === key) return known.roads;
  const roads = route(map, links, docks, names);
  routed.set(map, { key, roads });
  return roads;
}

/** What routing an island's roads is asked: the island as drawn, its links, its docks and its names. */
export type RoadsAsk = { readonly map: TerritoryMap; readonly links: readonly Link[]; readonly docks: readonly LinkDock[]; readonly names: readonly NameAnchor[] };
/** What the worker posts back for a `{ roads }` ask: the roads, or why routing failed. */
export type RoadsAnswer = { roads: IslandRoads } | { error: string };
/** Routes an island's roads somewhere, answering what `islandRoads` would; an aborted signal means the island was overtaken. */
export type IslandRouter = (ask: RoadsAsk, signal: AbortSignal) => Promise<IslandRoads>;

/** The roads already routed for the island `ask` names, if any, routing nothing. */
export function knownIslandRoads(ask: RoadsAsk): IslandRoads | undefined {
  const known = routed.get(ask.map);
  return known?.key === JSON.stringify([ask.links, ask.docks, ask.names]) ? known.roads : undefined;
}

/** Routes one island's roads, as the page would: what the worker answers a `{ roads }` ask with. */
export function answerRoads(ask: RoadsAsk): RoadsAnswer {
  try {
    return { roads: route(ask.map, ask.links, ask.docks, ask.names) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const listeners = new Set<() => void>();
let version = 0;
/** Hears every island's roads that arrive from now on (React's useSyncExternalStore, with `roadsVersion`). */
export function subscribeRoads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Changes whenever an island's roads arrive. */
export const roadsVersion = (): number => version;

/** How many islands' roads route at once: every island is laid out (ADR-1253 D2), and the rest wait their turn. */
export const ROUTING_AT_ONCE = 2;
let routing = 0;
const waitingToRoute: (() => void)[] = [];
/** Runs `route` once fewer than ROUTING_AT_ONCE routings are in flight; it is passed over if `signal` aborts first. */
function inTurn(route: () => Promise<unknown>, signal: AbortSignal): void {
  const start = () => {
    if (signal.aborted) { next(); return; }
    routing++;
    let ended = false;
    const end = () => { if (ended) return; ended = true; routing--; signal.removeEventListener("abort", end); next(); };
    signal.addEventListener("abort", end);
    route().then(end, end);
  };
  if (routing < ROUTING_AT_ONCE) start(); else waitingToRoute.push(start);
}
function next(): void {
  if (routing < ROUTING_AT_ONCE) waitingToRoute.shift()?.();
}

/**
 * An island's roads (3.82): those already routed for it at once, or undefined while `router` routes them off the page,
 * so its territories are drawn without waiting. A few islands route at a time (ROUTING_AT_ONCE), the rest in the order
 * asked. When they arrive they are kept for the island as laid out (`knownIslandRoads` has them) and every listener
 * hears it; an island overtaken first (`signal` aborted) keeps nothing, and one overtaken while it waits is not routed.
 */
export function islandRoadsWhenRouted(ask: RoadsAsk, router: IslandRouter, signal: AbortSignal): IslandRoads | undefined {
  const known = knownIslandRoads(ask);
  if (known !== undefined) return known;
  inTurn(() => router(ask, signal).then((roads) => {
    if (signal.aborted) return;
    routed.set(ask.map, { key: JSON.stringify([ask.links, ask.docks, ask.names]), roads });
    version++;
    for (const listener of listeners) listener();
  }, (error: unknown) => {
    if (!signal.aborted) console.error("forest territories: routing the island's roads failed", error);
  }), signal);
  return undefined;
}

/** Routes on the page itself, once the territories have had a frame to be drawn: for a page that offers no worker. */
export const routeIslandOnThePage: IslandRouter = async (ask, signal) => {
  await new Promise<void>((resolve) => (globalThis.requestAnimationFrame ?? setTimeout)(() => setTimeout(resolve, 0)));
  if (signal.aborted) throw signal.reason;
  return islandRoads(ask.map, ask.links, ask.docks, ask.names);
};

/** The part of a Worker the router uses. */
export interface RoadsWorker {
  postMessage(message: { roads: RoadsAsk }): void;
  terminate(): void;
  onmessage: ((event: { data: RoadsAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Routes in a fresh worker from `start`, ended when it answers or is overtaken. A worker that cannot start or fails to
 * load leaves the routing to `fallback`, and is logged; one that answers an error fails it. */
export function routeIslandInWorker(start: () => RoadsWorker, fallback: IslandRouter = routeIslandOnThePage): IslandRouter {
  return (ask, signal) => {
    let worker: RoadsWorker;
    try { worker = start(); } catch (error) {
      console.error("forest territories: the territory worker could not start; routing the island's roads on the page", error);
      return fallback(ask, signal);
    }
    return new Promise<IslandRoads>((resolve, reject) => {
      const end = () => { worker.terminate(); signal.removeEventListener("abort", overtaken); };
      const overtaken = () => { end(); reject(signal.reason); };
      signal.addEventListener("abort", overtaken);
      worker.onmessage = ({ data }) => {
        end();
        if ("roads" in data) resolve(data.roads);
        else reject(new Error(data.error));
      };
      worker.onerror = (event) => {
        console.error("forest territories: the territory worker failed to load; routing the island's roads on the page", event);
        end();
        fallback(ask, signal).then(resolve, reject);
      };
      worker.postMessage({ roads: ask });
    });
  };
}

/** The router a page offers: the territory worker it names (TERRITORY_WORKER_META), else routing on the page. */
export function pageIslandRouter(page: Pick<Document, "querySelector"> | undefined = (globalThis as { document?: Document }).document): IslandRouter {
  const script = page?.querySelector(`meta[name="${TERRITORY_WORKER_META}"]`)?.getAttribute("content");
  return script ? routeIslandInWorker(() => new Worker(script) as unknown as RoadsWorker) : routeIslandOnThePage;
}

/** What the territory search scores an arrangement by (3.80), as the mock's tool measured its network, in The library's
 * units: the inside links that pass through a third territory and the borders those cross, the length of road drawn,
 * the inside links between neighbours, and the links no road reaches. */
export type RoadMeasures = { readonly overThird: number; readonly overThirdBorders: number; readonly roadDrawn: number; readonly neighbours: number; readonly unrouted: number };

/** The measures of the network `islandRoads` would route over `map`, routed once and not drawn. */
export function roadMeasures(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[]): RoadMeasures {
  let measures: RoadMeasures = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0 };
  route(map, links, docks, names, (net, netLinks, tAt, borders) => {
    const pairs = new Set(borders.map((b) => [...b.pair].sort().join("|")));
    const length = (pts: readonly Point[]) => pts.reduce((s, p, i) => (i ? s + far(pts[i - 1]!, p) : 0), 0);
    let overThird = 0, overThirdBorders = 0, neighbours = 0;
    for (const l of netLinks) {
      if (l.kind !== "inside") continue;
      const way = net.ways.get(l.key) ?? [], seq: string[] = [];
      for (let i = 0; i + 1 < way.length; i++) { const t = tAt(way[i]!); if (t !== undefined && seq.at(-1) !== t) seq.push(t); }
      if (seq.some((t) => t !== l.fromT && t !== l.toT && t !== "open")) { overThird++; overThirdBorders += seq.length - 1; }
      if (pairs.has([l.fromT, l.toT].sort().join("|"))) neighbours++;
    }
    measures = { overThird, overThirdBorders, roadDrawn: net.segments.reduce((s, x) => s + length(x.pts), 0), neighbours, unrouted: net.unrouted.length };
  });
  return measures;
}

function route(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[],
  heard?: (net: Net, links: readonly NetLink[], tAt: (p: Point) => string | undefined, borders: readonly BorderSeg[]) => void): IslandRoads {
  const empty: IslandRoads = { segments: [], junctions: [], gates: [], towns: new Map(), settlements: new Map() };
  const drawnCoast = map.coast;
  if (drawnCoast === undefined) return empty;
  const S = Math.sqrt(landArea(drawnCoast) / LIBRARY_LAND);
  if (!(S > 0)) return empty;
  const coast: Coast = drawnCoast.map((ring) => ring.map((p) => times(p, 1 / S)));
  const sites = map.cells.map((cell) => times(cell.site, 1 / S));
  if (sites.length === 0) return empty;
  const ownerOf = (territory: number) => (territory < 0 ? "open" : map.territories[territory]?.capability ?? "");
  const nearest = nearestOf(sites), land = landOf(coast);
  /** The territory under a point: the nearest cell site's (the cells are Voronoi), "open" on open land, undefined off the coast. */
  const tAt = (p: Point): string | undefined => (land(p) ? ownerOf(map.cells[nearest(p)]!.territory) : undefined);
  const coastEdges = coast.flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]!] as const));
  const toCoast = nearEdges(coastEdges);
  const borders: BorderSeg[] = map.borders.flatMap((b) => {
    const pair = [ownerOf(map.cells[b.between[0]]!.territory), ownerOf(map.cells[b.between[1]]!.territory)] as const;
    return insideOf(times(b.from, 1 / S), times(b.to, 1 / S), coast).map(({ from, to }) => ({ a: from, b: to, pair }));
  });
  const edges = [...borders.map((s) => [s.a, s.b] as const), ...coastEdges];
  const clearance = (p: Point) => Math.min(...edges.map(([a, b]) => toSegment(p, a, b)));

  const here = new Set(map.territories.flatMap((t) => (t.capability === undefined ? [] : [t.capability])));
  const boxes = names.filter((n) => here.has(n.capability)).map((n) => ({ ...nameBox(n.title), at: times(n, 1 / S), capability: n.capability }));
  const anchor = new Map(boxes.map((b) => [b.capability, b.at]));
  const underName = (p: Point, pad: number) => boxes.some((b) => Math.abs(p.x - b.at.x) < b.w / 2 + pad / PX && Math.abs(p.z - b.at.z) < b.h / 2 + pad / PX);
  /** Whether a symbol `half` across each way at `p` keeps clear of every name: its middle, and its box by SYMBOL_CLEAR. */
  const clearOfNames = (p: Point, half: number) => !underName(p, 7) && !boxes.some((b) => Math.abs(p.x - b.at.x) < b.w / 2 + half + SYMBOL_CLEAR / PX && Math.abs(p.z - b.at.z) < b.h / 2 + half + SYMBOL_CLEAR / PX);

  // The links: inside the island, and per dock and capability one arrival and one way out.
  const inside = links.filter((l) => here.has(l.from) && here.has(l.to) && l.from !== l.to);
  const ashore = docks.map((dock) => ({ at: ontoCoast(times(dock.local, 1 / S), coast), lanes: dock.links.map((key) => key.split("->") as [string, string]).filter(([a, b]) => here.has(a) !== here.has(b)) }));
  const landings: { key: string; kind: "arrival" | "out"; dock: Point; capability: string; links: number }[] = [];
  ashore.forEach(({ at, lanes }, k) => {
    const count = (kind: "arrival" | "out") => {
      const per = new Map<string, number>();
      for (const [from, to] of lanes) { const mine = kind === "arrival" ? to : from; if ((kind === "arrival") === here.has(to)) per.set(mine, (per.get(mine) ?? 0) + 1); }
      return per;
    };
    for (const [capability, n] of count("arrival")) landings.push({ key: `arrive:${k}->${capability}`, kind: "arrival", dock: at, capability, links: n });
    for (const [capability, n] of count("out")) landings.push({ key: `${capability}->leave:${k}`, kind: "out", dock: at, capability, links: n });
  });

  // Each territory's settlement, toward the middle of what its roads reach: its partners' names and its docks.
  const spot = (territory: string, toward: Point, half: number): Point => {
    const name = anchor.get(territory) ?? { x: 0, z: 0 }, want = { x: toward.x - name.x, z: toward.z - name.z };
    let best: Point | undefined, score = Infinity;
    for (let a = 0; a < 360; a += 6) {
      const u = { x: Math.cos(a * Math.PI / 180), z: Math.sin(a * Math.PI / 180) };
      let r = 1.5;
      while (r < 30 && underName({ x: name.x + u.x * r, z: name.z + u.z * r }, 6)) r += 0.5;
      for (const extra of [0.8, 1.8, 3, 4.5]) {
        const p = { x: name.x + u.x * (r + extra), z: name.z + u.z * (r + extra) };
        if (tAt(p) !== territory || clearance(p) < Math.max(CLEAR, half * Math.SQRT2 + SYMBOL_EDGE) || !clearOfNames(p, half)) continue;
        const s = angle(u, want) * 6 + far(p, name) * 0.35;
        if (s < score) { score = s; best = p; }
        break;
      }
    }
    return best ?? name;
  };
  const towns = new Map<string, Point>(), meeting = new Map<string, number>();
  for (const id of here) {
    const toward = [...inside.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : [])).map((p) => anchor.get(p) ?? { x: 0, z: 0 }), ...landings.filter((l) => l.capability === id).map((l) => l.dock)];
    if (!toward.length || !anchor.has(id)) continue;
    const n = toward.length, half = symbolSize(n) / 2;
    meeting.set(id, n);
    towns.set(id, spot(id, { x: toward.reduce((s, p) => s + p.x, 0) / n, z: toward.reduce((s, p) => s + p.z, 0) / n }, half));
  }

  const netLinks: NetLink[] = [
    ...inside.filter((l) => towns.has(l.from) && towns.has(l.to)).map((l): NetLink => ({ key: `${l.from}->${l.to}`, kind: "inside", from: towns.get(l.from)!, to: towns.get(l.to)!, fromT: l.from, toT: l.to, links: 1 })),
    ...landings.filter((l) => towns.has(l.capability)).map((l): NetLink => l.kind === "arrival"
      ? { key: l.key, kind: "arrival", from: l.dock, to: towns.get(l.capability)!, fromT: "sea", toT: l.capability, links: l.links }
      : { key: l.key, kind: "out", from: towns.get(l.capability)!, to: l.dock, fromT: l.capability, toT: "sea", links: l.links }),
  ];
  const settlements = new Map([...towns].map(([id, at]) => [id, { at: times(at, S), roads: meeting.get(id)!, size: symbolSize(meeting.get(id)!) * S }]));
  if (netLinks.length === 0) return { ...empty, towns: scaled(towns, S), settlements };
  const loads = ashore.map(({ lanes }) => lanes.length);
  const ring = (p: Point) => [p, ...Array.from({ length: 8 }, (_, k) => ({ x: p.x + 3.2 * Math.cos(k * Math.PI / 4), z: p.z + 3.2 * Math.sin(k * Math.PI / 4) }))];
  const net = roadNetwork({
    tAt, toCoast, borders, links: netLinks, band: 0, radius: map.radius / S,
    mouths: ashore.flatMap(({ at }, k) => (loads[k]! > 0 ? [{ at, reach: openReach(loads[k]!) }] : [])),
    towns: [...towns].map(([territory, at]) => ({ territory, at })),
    extra: (p) => (underName(p, 2) ? UNDER_NAME : 0),
    gateExtra: (p) => (ring(p).some((q) => underName(q, 3)) || [...towns.values()].some((t) => far(t, p) < 5.5) ? GATE_CLEAR : 0),
  });
  if (heard !== undefined) { heard(net, netLinks, tAt, borders); return empty; }

  // Gates: every border a segment crosses, and each link's own entrance among them.
  const crossings = (pts: readonly Point[]) => {
    const out: { p: Point; along: Point; pair: readonly [string, string] }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const found: typeof out = [];
      for (const s of borders) {
        const x = cross(pts[i]!, pts[i + 1]!, s.a, s.b);
        if (x && ![...out, ...found].some((o) => far(o.p, x) < 0.3)) { const l = far(s.a, s.b) || 1; found.push({ p: x, along: { x: (s.b.x - s.a.x) / l, z: (s.b.z - s.a.z) / l }, pair: s.pair }); }
      }
      out.push(...found.sort((a, b) => far(pts[i]!, a.p) - far(pts[i]!, b.p)));
    }
    return out;
  };
  const gates = net.segments.flatMap((s) => crossings(s.pts).map((c) => ({ at: c.p, along: c.along, links: s.links, entrances: [] as string[] })));
  for (const l of netLinks) {
    const way = crossings(net.ways.get(l.key) ?? []);
    const entering = l.kind === "out" ? way.find((c) => c.pair.includes(l.fromT)) : [...way].reverse().find((c) => c.pair.includes(l.toT));
    if (!entering) continue;
    const g = gates.reduce<(typeof gates)[number] | undefined>((b, x) => (far(x.at, entering.p) < (b ? far(b.at, entering.p) : 1) ? x : b), undefined);
    if (g) g.entrances.push(l.key);
  }
  return {
    segments: net.segments.map((s) => ({ pts: s.pts.map((p) => times(p, S)), links: s.links, width: widthOf(s.links.length) * S })),
    junctions: net.junctions.map((at) => ({ at: times(at, S), width: Math.max(...net.segments.filter((s) => s.pts.some((p) => far(p, at) < 1e-6)).map((s) => widthOf(s.links.length)), WIDTHS[0]) * S })),
    gates: gates.map((g) => ({ at: times(g.at, S), along: g.along, links: g.links, entrance: g.entrances.length > 0, entrances: g.entrances,
      opening: Math.max(GATE_OPENING, widthOf(g.links.length) + 2) * S })),
    towns: scaled(towns, S),
    settlements,
  };
}

const scaled = (towns: ReadonlyMap<string, Point>, S: number) => new Map([...towns].map(([id, p]) => [id, times(p, S)]));

function angle(a: Point, b: Point): number {
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / ((Math.hypot(a.x, a.z) || 1) * (Math.hypot(b.x, b.z) || 1)))));
}

function cross(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * r.x, z: a.z + t * r.z } : undefined;
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

/** Whether a point is on the land `coast` encloses, each row's crossings of the coast found once. */
function landOf(coast: Coast): (p: Point) => boolean {
  const rows = new Map<number, number[]>();
  return (p) => {
    let xs = rows.get(p.z);
    if (xs === undefined) {
      xs = [];
      for (const ring of coast) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, b = ring[j]!;
        if ((a.z > p.z) !== (b.z > p.z)) xs.push(((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x);
      }
      rows.set(p.z, xs);
    }
    let inside = false;
    for (const x of xs) if (p.x < x) inside = !inside;
    return inside;
  };
}

/** The index of the point of `sites` nearest a point, by a grid of buckets searched outward. */
function nearestOf(sites: readonly Point[]): (p: Point) => number {
  const size = 6, buckets = new Map<string, number[]>();
  const at = (v: number) => Math.floor(v / size);
  sites.forEach((s, i) => { const k = `${at(s.x)},${at(s.z)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i); });
  const reach = Math.ceil(Math.max(...sites.map((s) => Math.max(Math.abs(s.x), Math.abs(s.z)))) / size) * 2 + 2;
  return (p) => {
    const cx = at(p.x), cz = at(p.z);
    let best = 0, d = Infinity;
    for (let r = 0; r <= reach; r++) {
      // Every site within r buckets is searched; one nearer than the ring beyond them cannot be bettered.
      for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        for (const i of buckets.get(`${x},${z}`) ?? []) { const s = sites[i]!, dd = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (dd < d) { d = dd; best = i; } }
      }
      if (d < (r * size) ** 2) break;
    }
    return best;
  };
}

/** How far a point is from the nearest of `edges`, exactly within a few units of one; further off, a lower bound. */
function nearEdges(edges: readonly (readonly [Point, Point])[]): (p: Point) => number {
  const size = 4, buckets = new Map<string, number[]>();
  const at = (v: number) => Math.floor(v / size);
  edges.forEach(([a, b], i) => {
    for (let x = at(Math.min(a.x, b.x)); x <= at(Math.max(a.x, b.x)); x++) for (let z = at(Math.min(a.z, b.z)); z <= at(Math.max(a.z, b.z)); z++) {
      const k = `${x},${z}`;
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i);
    }
  });
  return (p) => {
    let d = size;
    for (let x = at(p.x) - 1; x <= at(p.x) + 1; x++) for (let z = at(p.z) - 1; z <= at(p.z) + 1; z++) {
      for (const i of buckets.get(`${x},${z}`) ?? []) d = Math.min(d, toSegment(p, edges[i]![0], edges[i]![1]));
    }
    return d;
  };
}
