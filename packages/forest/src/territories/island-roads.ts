// Capability 3 · Story node render
import { LIBRARY_LAND, ontoCoast, openReach, type Link, type LinkDock } from "./link-layout.js";
import { insideOf, landArea, type Coast, type Point, type TerritoryMap } from "./territories.js";
import { roadNetwork, type BorderSeg, type Net, type NetLink } from "./road-network.js";
import { TERRITORY_WORKER_META } from "./kept-layout.js";
import { RELIEF } from "./island-relief.js";

export type RoadSegment = { readonly pts: readonly Point[]; readonly links: readonly string[]; readonly width: number };
export type RoadGate = { readonly at: Point; readonly along: Point; readonly links: readonly string[]; readonly entrances: readonly string[]; readonly opening: number; readonly between: readonly [string, string] };
export type RoadPass = { readonly at: Point; readonly along: Point; readonly links: readonly string[]; readonly opening: number };
export type RoadPortal = { readonly at: Point; readonly border: Point; readonly along: Point; readonly into: Point; readonly links: readonly string[]; readonly width: number };
export type RoadTunnel = { readonly pts: readonly Point[]; readonly links: readonly string[] };
export type Settlement = { readonly at: Point; readonly roads: number; readonly size: number };
export type IslandRoads = { readonly segments: readonly RoadSegment[]; readonly junctions: readonly { at: Point; width: number }[]; readonly gates: readonly RoadGate[]; readonly passes: readonly RoadPass[]; readonly portals: readonly RoadPortal[]; readonly tunnels: readonly RoadTunnel[]; readonly towns: ReadonlyMap<string, Point>; readonly settlements: ReadonlyMap<string, Settlement> };
export type NameAnchor = { readonly capability: string; readonly title: string; readonly x: number; readonly z: number };

const WIDTHS = [0.5, 0.7, 0.95, 1.3] as const;
const MOUTH = { setback: 1.8, way: 3.2, near: 0.6, least: 1.1, most: 0.2, room: 0.6 } as const;
export const MOUTH_ROOM = MOUTH.room;
const GATE_OPENING = 3;
export const GATE_POSTS_APART = 2;
const PX = 2.6;
const nameBox = (title: string) => ({ w: (title.length * 6.5 + 12) / PX, h: 7 });
const SYMBOL = [3.4, 4.0, 4.7] as const, SYMBOL_EDGE = 1.5, CLEAR = 2.3;
const SYMBOL_CLEAR = 4;
const symbolSize = (roads: number) => SYMBOL[roads >= 6 ? 2 : roads >= 3 ? 1 : 0];
const GATE_CLEAR = 18, UNDER_NAME = 2.5;

const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const times = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });
export const widthOf = (n: number) => WIDTHS[n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0];

export const inTunnelMouth = (roads: Pick<IslandRoads, "portals">, gate: { readonly at: Point }): boolean => roads.portals.some((p) => far(p.border, gate.at) < 1e-6);

let routed = new WeakMap<TerritoryMap, { key: string; roads: IslandRoads }>();

export function islandRoads(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[]): IslandRoads {
  const key = JSON.stringify([links, docks, names]), known = routed.get(map);
  if (known?.key === key) return known.roads;
  const roads = route(map, links, docks, names);
  routed.set(map, { key, roads });
  return roads;
}

export type RoadsAsk = { readonly map: TerritoryMap; readonly links: readonly Link[]; readonly docks: readonly LinkDock[]; readonly names: readonly NameAnchor[]; readonly story?: string };
export type RoadsAnswer = { roads: IslandRoads } | { error: string };
export type IslandRouter = (ask: RoadsAsk, signal: AbortSignal) => Promise<IslandRoads>;

export function knownIslandRoads(ask: RoadsAsk): IslandRoads | undefined {
  const key = JSON.stringify([ask.links, ask.docks, ask.names]), known = routed.get(ask.map);
  if (known?.key === key) return known.roads;
  if (ask.story === undefined || unshelved.get(ask.map) === key) return undefined;
  if (roadShelf === null) roadShelf = roadsShelf();
  const stored = roadShelf?.read(ask.story);
  if (stored?.key === storedKey(ask)) {
    routed.set(ask.map, { key, roads: stored.roads });
    return stored.roads;
  }
  unshelved.set(ask.map, key);
  return undefined;
}

const ROUTING = 1;
const ROADS_KEY = "storytree.roads.";
export interface RoadsShelf { read(story: string): { key: string; roads: IslandRoads } | undefined; write(story: string, key: string, roads: IslandRoads): void }
let roadShelf: RoadsShelf | undefined | null = null;
let unshelved = new WeakMap<TerritoryMap, string>();

export function shelveRoadsOn(next: RoadsShelf | undefined): void {
  roadShelf = next; routed = new WeakMap(); unshelved = new WeakMap();
}

function storedKey(ask: RoadsAsk): string {
  return `routing ${ROUTING} ${hashOf(JSON.stringify([ask.map, ask.links, ask.docks, ask.names]))}`;
}

function hashOf(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function roadsShelf(storage: Pick<Storage, "getItem" | "setItem"> | undefined = pageStorage()): RoadsShelf | undefined {
  if (storage === undefined) return undefined;
  return {
    read(story) {
      try {
        const kept = JSON.parse(storage.getItem(ROADS_KEY + story) ?? "null") as { key?: unknown; roads?: Record<string, unknown> } | null;
        const roads = kept?.roads;
        if (typeof kept?.key !== "string" || roads === undefined || roads === null) return undefined;
        const lists = ["segments", "junctions", "gates", "passes", "portals", "tunnels", "towns", "settlements"] as const;
        if (!lists.every((part) => Array.isArray(roads[part]))) return undefined;
        return { key: kept.key, roads: { ...roads, towns: new Map(roads.towns as [string, Point][]), settlements: new Map(roads.settlements as [string, Settlement][]) } as unknown as IslandRoads };
      } catch { return undefined; }
    },
    write(story, key, roads) {
      try {
        storage.setItem(ROADS_KEY + story, JSON.stringify({ key, roads: { ...roads, towns: [...roads.towns], settlements: [...roads.settlements] } }));
      } catch {}
    },
  };
}

function pageStorage(): Storage | undefined {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
}

export function answerRoads(ask: RoadsAsk): RoadsAnswer {
  try {
    return { roads: route(ask.map, ask.links, ask.docks, ask.names) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const listeners = new Set<() => void>();
let version = 0;
export function subscribeRoads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const roadsVersion = (): number => version;

export const ROUTING_AT_ONCE = 2;
let routing = 0;
const waitingToRoute: (() => void)[] = [];
const routingFor = new Map<string, number>();
const routingListeners = new Set<() => void>();
let routingAt = 0;
export function islandsRouting(): ReadonlySet<string> {
  return new Set(routingFor.keys());
}
export function subscribeRouting(listener: () => void): () => void {
  routingListeners.add(listener);
  return () => { routingListeners.delete(listener); };
}
export const routingVersion = (): number => routingAt;
function counted(story: string, by: 1 | -1): void {
  const was = routingFor.get(story) ?? 0, now = was + by;
  if (now > 0) routingFor.set(story, now); else routingFor.delete(story);
  if ((was > 0) === (now > 0)) return;
  routingAt++;
  for (const listener of routingListeners) listener();
}
function inTurn(route: () => Promise<unknown>, signal: AbortSignal, story: string | undefined): void {
  let pending = story !== undefined && !signal.aborted;
  const settled = () => { if (!pending) return; pending = false; signal.removeEventListener("abort", settled); counted(story!, -1); };
  if (pending) { counted(story!, 1); signal.addEventListener("abort", settled); }
  const start = () => {
    if (signal.aborted) { settled(); next(); return; }
    routing++;
    let ended = false;
    const end = () => { if (ended) return; ended = true; routing--; signal.removeEventListener("abort", end); settled(); next(); };
    signal.addEventListener("abort", end);
    route().then(end, end);
  };
  if (routing < ROUTING_AT_ONCE) start(); else waitingToRoute.push(start);
}
function next(): void {
  if (routing < ROUTING_AT_ONCE) waitingToRoute.shift()?.();
}

export function islandRoadsWhenRouted(ask: RoadsAsk, router: IslandRouter, signal: AbortSignal): IslandRoads | undefined {
  const known = knownIslandRoads(ask);
  if (known !== undefined) return known;
  inTurn(() => router(ask, signal).then((roads) => {
    if (signal.aborted) return;
    routed.set(ask.map, { key: JSON.stringify([ask.links, ask.docks, ask.names]), roads });
    if (ask.story !== undefined) {
      if (roadShelf === null) roadShelf = roadsShelf();
      roadShelf?.write(ask.story, storedKey(ask), roads);
    }
    version++;
    for (const listener of listeners) listener();
  }, (error: unknown) => {
    if (!signal.aborted) console.error("forest territories: routing the island's roads failed", error);
  }), signal, ask.story);
  return undefined;
}

export const routeIslandOnThePage: IslandRouter = async (ask, signal) => {
  await new Promise<void>((resolve) => (globalThis.requestAnimationFrame ?? setTimeout)(() => setTimeout(resolve, 0)));
  if (signal.aborted) throw signal.reason;
  return islandRoads(ask.map, ask.links, ask.docks, ask.names);
};

export interface RoadsWorker {
  postMessage(message: { roads: RoadsAsk }): void;
  terminate(): void;
  onmessage: ((event: { data: RoadsAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

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

export function pageIslandRouter(page: Pick<Document, "querySelector"> | undefined = (globalThis as { document?: Document }).document): IslandRouter {
  const script = page?.querySelector(`meta[name="${TERRITORY_WORKER_META}"]`)?.getAttribute("content");
  return script ? routeIslandInWorker(() => new Worker(script) as unknown as RoadsWorker) : routeIslandOnThePage;
}

export type RoadMeasures = { readonly overThird: number; readonly overThirdBorders: number; readonly roadDrawn: number; readonly neighbours: number; readonly unrouted: number; readonly tunnels: number };

export function roadMeasures(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[]): RoadMeasures {
  let measures: Omit<RoadMeasures, "tunnels"> = { overThird: 0, overThirdBorders: 0, roadDrawn: 0, neighbours: 0, unrouted: 0 };
  const drawn = route(map, links, docks, names, (net, netLinks, tAt, borders) => {
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
  return { ...measures, tunnels: drawn.tunnels.length };
}

function route(map: TerritoryMap, links: readonly Link[], docks: readonly LinkDock[], names: readonly NameAnchor[],
  heard?: (net: Net, links: readonly NetLink[], tAt: (p: Point) => string | undefined, borders: readonly BorderSeg[]) => void): IslandRoads {
  const empty: IslandRoads = { segments: [], junctions: [], gates: [], passes: [], portals: [], tunnels: [], towns: new Map(), settlements: new Map() };
  const drawnCoast = map.coast;
  if (drawnCoast === undefined) return empty;
  const S = Math.sqrt(landArea(drawnCoast) / LIBRARY_LAND);
  if (!(S > 0)) return empty;
  const coast: Coast = drawnCoast.map((ring) => ring.map((p) => times(p, 1 / S)));
  const sites = map.cells.map((cell) => times(cell.site, 1 / S));
  if (sites.length === 0) return empty;
  const ownerOf = (territory: number) => (territory < 0 ? "open" : map.territories[territory]?.capability ?? "");
  const nearest = nearestOf(sites), land = landOf(coast);
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
  const clearOfNames = (p: Point, half: number) => !underName(p, 7) && !boxes.some((b) => Math.abs(p.x - b.at.x) < b.w / 2 + half + SYMBOL_CLEAR / PX && Math.abs(p.z - b.at.z) < b.h / 2 + half + SYMBOL_CLEAR / PX);

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
  heard?.(net, netLinks, tAt, borders);

  const byKey = new Map(netLinks.map((l) => [l.key, l]));
  const under = (t: string | undefined, keys: readonly string[]) => t !== undefined && t !== "open" && keys.every((k) => { const l = byKey.get(k)!; return t !== l.fromT && t !== l.toT; });
  type Crossing = { p: Point; along: Point; pair: readonly [string, string]; step: number };
  const crossings = (pts: readonly Point[]) => {
    const out: Crossing[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const found: Crossing[] = [];
      for (const s of borders) {
        const x = cross(pts[i]!, pts[i + 1]!, s.a, s.b);
        if (x && ![...out, ...found].some((o) => far(o.p, x) < 0.3)) { const l = far(s.a, s.b) || 1; found.push({ p: x, along: { x: (s.b.x - s.a.x) / l, z: (s.b.z - s.a.z) / l }, pair: s.pair, step: i }); }
      }
      out.push(...found.sort((a, b) => far(pts[i]!, a.p) - far(pts[i]!, b.p)));
    }
    return out;
  };
  const rampOut = (x: Crossing): Point | undefined => {
    const n = { x: -x.along.z, z: x.along.x }, a = tAt({ x: x.p.x + n.x * 0.8, z: x.p.z + n.z * 0.8 }), b = tAt({ x: x.p.x - n.x * 0.8, z: x.p.z - n.z * 0.8 });
    if (a === "open" && b !== undefined && b !== "open") return n;
    if (b === "open" && a !== undefined && a !== "open") return { x: -n.x, z: -n.z };
    return undefined;
  };
  const ledOut = (pts: readonly Point[]): Point[] => {
    let line = [...pts];
    const done: Point[] = [], next = () => crossings(line).find((c) => !done.some((d) => far(d, c.p) < 1e-6) && rampOut(c));
    for (let x = next(); x !== undefined; x = next()) {
      done.push(x.p);
      line = leadOut(line, x.step, x.p, rampOut(x)!);
    }
    return line;
  };
  const cut = net.segments.map((raw) => {
    const s = { ...raw, pts: ledOut(raw.pts) };
    const xs = crossings(s.pts), pieces: Point[][] = [[s.pts[0]!]];
    let k = 0;
    for (let i = 0; i + 1 < s.pts.length; i++) {
      for (; k < xs.length && xs[k]!.step === i; k++) { pieces.at(-1)!.push(xs[k]!.p); pieces.push([xs[k]!.p]); }
      pieces.at(-1)!.push(s.pts[i + 1]!);
    }
    const hidden = pieces.map((piece) => under(tAt(halfway(piece)), s.links));
    return { s, xs, pieces, hidden };
  });
  const ends = cut.flatMap((c, j) => [{ at: c.s.pts[0]!, j, k: 0 }, { at: c.s.pts.at(-1)!, j, k: c.pieces.length - 1 }]);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of ends) if (cut[e.j]!.hidden[e.k] && ends.some((o) => far(o.at, e.at) < 1e-6 && !cut[o.j]!.hidden[o.k])) { cut[e.j]!.hidden[e.k] = false; changed = true; }
  }
  const entering = new Map<Crossing, string[]>(), all = cut.flatMap((c) => c.xs);
  for (const l of netLinks) {
    const way = crossings(net.ways.get(l.key) ?? []);
    const own = l.kind === "out" ? way.find((c) => c.pair.includes(l.fromT)) : [...way].reverse().find((c) => c.pair.includes(l.toT));
    if (!own) continue;
    const x = all.reduce<Crossing | undefined>((b, c) => (far(c.p, own.p) < (b ? far(b.p, own.p) : 1) ? c : b), undefined);
    if (x) entering.set(x, [...entering.get(x) ?? [], l.key]);
  }
  const onOpen = (piece: readonly Point[]) => tAt(halfway(piece)) === "open";
  const opening = (links: readonly string[]) => Math.max(GATE_OPENING, widthOf(links.length) + 2) * S;
  const segments: RoadSegment[] = [], gates: RoadGate[] = [], passes: RoadPass[] = [], portals: RoadPortal[] = [], tunnels: RoadTunnel[] = [];
  for (const { s, xs, pieces, hidden } of cut) {
    const width = widthOf(s.links.length) * S;
    if (!hidden.some(Boolean)) segments.push({ pts: s.pts.map((p) => times(p, S)), links: s.links, width });
    const on = xs.map((_, i) => (hidden[i] === hidden[i + 1] ? -1 : hidden[i] ? (onOpen(pieces[i + 1]!) ? i : i + 1) : (onOpen(pieces[i]!) ? i + 1 : i)));
    const mouths: (Point | undefined)[] = xs.map(() => undefined);
    if (hidden.some(Boolean)) {
      const runs: { pts: Point[]; hidden: boolean }[] = [];
      const add = (pts: readonly Point[], under: boolean) => {
        const last = runs.at(-1);
        if (last && last.hidden === under) last.pts.push(...pts.slice(1)); else runs.push({ pts: [...pts], hidden: under });
      };
      pieces.forEach((piece, i) => {
        const atStart = i > 0 && on[i - 1] === i, atEnd = i < xs.length && on[i] === i, m = (atStart ? 1 : 0) + (atEnd ? 1 : 0), long = lengthOf(piece);
        const back = Math.max(hidden[i] ? Math.min(MOUTH.setback, (long - MOUTH.way) / Math.max(1, m)) : Math.min(MOUTH.setback, long * MOUTH.near / Math.max(1, m)), Math.min(MOUTH.least, long * MOUTH.most));
        const [head, rest] = atStart ? splitAt(piece, back) : [[piece[0]!], piece];
        const [middle, tail] = atEnd ? splitAt(rest, lengthOf(rest) - back) : [rest, [rest.at(-1)!]];
        if (atStart) { add(head, hidden[i - 1]!); mouths[i - 1] = head.at(-1)!; }
        add(middle, hidden[i]!);
        if (atEnd) { add(tail, hidden[i + 1]!); mouths[i] = tail[0]!; }
      });
      for (const r of runs) {
        if (r.hidden) tunnels.push({ pts: r.pts.map((p) => times(p, S)), links: s.links });
        else if (r.pts.length > 1) segments.push({ pts: r.pts.map((p) => times(p, S)), links: s.links, width });
      }
    }
    xs.forEach((x, i) => {
      const at = times(x.p, S), gated = entering.get(x);
      if (gated !== undefined) gates.push({ at, along: x.along, links: s.links, entrances: gated.sort(), opening: opening(s.links), between: [...x.pair].sort() as [string, string] });
      if (on[i]! >= 0) {
        const mouth = mouths[i]!, d = far(mouth, x.p), away = hidden[on[i]!] ? 1 : -1;
        const into = d > 1e-9 ? times({ x: mouth.x - x.p.x, z: mouth.z - x.p.z }, away / d) : { x: -x.along.z, z: x.along.x };
        portals.push({ at: times(mouth, S), border: at, along: { x: -into.z, z: into.x }, into, links: s.links, width: width + MOUTH.room * S });
      }
      if (gated === undefined && !(hidden[i] && hidden[i + 1])) passes.push({ at, along: x.along, links: s.links, opening: opening(s.links) });
    });
  }
  const endsAt = (at: Point) => ends.filter((e) => far(e.at, at) < 1e-6);
  return {
    segments,
    junctions: net.junctions.filter((at) => endsAt(at).some((e) => !cut[e.j]!.hidden[e.k])).map((at) => ({ at: times(at, S), width: Math.max(...endsAt(at).map((e) => widthOf(cut[e.j]!.s.links.length)), WIDTHS[0]) * S })),
    gates, passes, portals, tunnels,
    towns: scaled(towns, S),
    settlements,
  };
}

function leadOut(pts: readonly Point[], step: number, x: Point, out: Point): Point[] {
  const forward = (pts[step + 1]!.x - x.x) * out.x + (pts[step + 1]!.z - x.z) * out.z >= 0;
  const line = forward ? pts : [...pts].reverse(), from = forward ? step : pts.length - 2 - step, D = RELIEF.ramp.depth;
  const w = (p: Point) => (p.x - x.x) * out.x + (p.z - x.z) * out.z, foot = { x: x.x + out.x * D, z: x.z + out.z * D };
  const curve = (q: Point, onward: Point): Point[] => {
    const c = Math.min(D * 0.5, far(foot, q) / 2), p1 = { x: foot.x + out.x * c, z: foot.z + out.z * c }, p2 = { x: q.x - onward.x * c, z: q.z - onward.z * c };
    return [1, 2, 3, 4, 5, 6, 7].map((k) => {
      const t = k / 8, [a, b, d, e] = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
      return { x: a * foot.x + b * p1.x + d * p2.x + e * q.x, z: a * foot.z + b * p1.z + d * p2.z + e * q.z };
    });
  };
  let best: { rest: Point[]; turn: Point[]; off: number } | undefined, walked = 0;
  for (let k = from + 1; k < line.length && walked <= 4 * D; k++) {
    const a = k === from + 1 ? x : line[k - 1]!, b = line[k]!, l = far(a, b);
    walked += l;
    if (w(b) < 1.5 * D) continue;
    const t = w(a) < 1.5 * D ? (1.5 * D - w(a)) / (w(b) - w(a)) : 1, q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const rest = far(q, b) > 1e-6 ? [q, ...line.slice(k)] : line.slice(k), next = rest[1];
    const onward = next === undefined ? out : unitOf({ x: next.x - q.x, z: next.z - q.z }), toward = unitOf({ x: q.x - foot.x, z: q.z - foot.z });
    const off = 1 - (toward.x * out.x + toward.z * out.z);
    if (off < (best?.off ?? Infinity)) best = { rest, turn: curve(q, onward), off };
  }
  const led = [...line.slice(0, from + 1), x, foot, ...(best?.turn ?? []), ...(best?.rest ?? [line.at(-1)!])];
  return forward ? led : led.reverse();
}

const unitOf = (p: Point): Point => { const l = Math.hypot(p.x, p.z) || 1; return { x: p.x / l, z: p.z / l }; };

const lengthOf = (pts: readonly Point[]) => pts.reduce((s, p, i) => (i ? s + far(pts[i - 1]!, p) : 0), 0);

function splitAt(pts: readonly Point[], d: number): [Point[], Point[]] {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = far(a, b);
    if (l >= left && l > 0) { const q = { x: a.x + (b.x - a.x) * left / l, z: a.z + (b.z - a.z) * left / l }; return [[...pts.slice(0, i), q], [q, ...pts.slice(i)]]; }
    left -= l;
  }
  return [[...pts], [pts.at(-1)!]];
}

function halfway(pts: readonly Point[]): Point {
  const total = pts.reduce((s, p, i) => (i ? s + far(pts[i - 1]!, p) : 0), 0);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = far(pts[i - 1]!, pts[i]!);
    if (d >= left && d > 0) return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * left / d, z: pts[i - 1]!.z + (pts[i]!.z - pts[i - 1]!.z) * left / d };
    left -= d;
  }
  return pts[0]!;
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

function nearestOf(sites: readonly Point[]): (p: Point) => number {
  const size = 6, buckets = new Map<string, number[]>();
  const at = (v: number) => Math.floor(v / size);
  sites.forEach((s, i) => { const k = `${at(s.x)},${at(s.z)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i); });
  const reach = Math.ceil(Math.max(...sites.map((s) => Math.max(Math.abs(s.x), Math.abs(s.z)))) / size) * 2 + 2;
  return (p) => {
    const cx = at(p.x), cz = at(p.z);
    let best = 0, d = Infinity;
    for (let r = 0; r <= reach; r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        for (const i of buckets.get(`${x},${z}`) ?? []) { const s = sites[i]!, dd = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (dd < d) { d = dd; best = i; } }
      }
      if (d < (r * size) ** 2) break;
    }
    return best;
  };
}

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
