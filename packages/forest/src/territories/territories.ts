// Capability 3 · Story node render

export type Point = { readonly x: number; readonly z: number };

export type TerritoryShare = { readonly capability?: string; readonly title?: string; readonly description?: string; readonly lines: number };

export type Territory = TerritoryShare;

export type Cell = {
  readonly index: number;
  readonly site: Point;
  readonly polygon: readonly Point[];
  readonly neighbours: readonly number[];
  readonly touching: readonly number[];
  readonly territory: number;
};

export type Border = { readonly from: Point; readonly to: Point; readonly between: readonly [number, number] };

export type Coast = readonly (readonly Point[])[];

export type TerritoryMap = {
  readonly radius: number;
  readonly coast?: Coast;
  readonly territories: readonly Territory[];
  readonly cells: readonly Cell[];
  readonly borders: readonly Border[];
};

const CELLS = 120;
export const MIN_SHARE = 5 / 246;
const COAST_SIDES = 64;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const JOIN = 0.05;

type Edge = { from: Point; to: Point; across: number };

export function territories(shares: readonly TerritoryShare[], outline: number | Coast, cellCount = CELLS): TerritoryMap {
  return finished(territoriesInSteps(shares, outline, cellCount));
}

const CELLS_A_STEP = 32;

export function* territoriesInSteps(shares: readonly TerritoryShare[], outline: number | Coast, cellCount = CELLS): Generator<void, TerritoryMap, void> {
  const held = shares.filter((share) => share.lines > 0);
  const coast = typeof outline === "number" ? undefined : outline.filter((ring) => ring.length >= 3);
  const radius = coast === undefined ? (outline as number) : Math.max(0, ...coast.flat().map(({ x, z }) => Math.hypot(x, z)));
  const wanted = Math.max(cellCount, held.length);
  const land = coast === undefined ? Math.PI * radius ** 2 : landArea(coast);
  const spread = land > 0 ? Math.ceil((wanted * Math.PI * radius ** 2) / land) : wanted;
  const sites = sunflower(spread, radius).filter((site) => coast === undefined || onLand(site, coast));
  const count = sites.length;
  const outlines: Edge[][] = [];
  for (let at = 0; at < count; at++) {
    outlines.push(voronoiCell(sites, at, radius));
    if ((at + 1) % CELLS_A_STEP === 0) yield;
  }
  const side = Math.sqrt(land / Math.max(1, count));
  const ashore = (edge: Edge) => coast === undefined || insideOf(edge.from, edge.to, coast).reduce((sum, { from, to }) => sum + Math.hypot(to.x - from.x, to.z - from.z), 0) >= JOIN * side;
  const [touching, joined] = [outlines.map(() => new Set<number>()), outlines.map(() => new Set<number>())];
  outlines.forEach((edges, at) => {
    for (const edge of edges) if (edge.across > at) {
      touching[at]!.add(edge.across); touching[edge.across]!.add(at);
      if (ashore(edge)) { joined[at]!.add(edge.across); joined[edge.across]!.add(at); }
    }
  });
  const sorted = (sets: Set<number>[]) => sets.map((set) => [...set].sort((a, b) => a - b));
  const [neighbours, touches] = [sorted(joined), sorted(touching)];

  const owner = new Array<number>(count).fill(0);
  const counts = atLeast(apportion(held.map((share) => share.lines), count), Math.max(1, Math.min(Math.floor(count / Math.max(1, held.length)), Math.round(MIN_SHARE * count))));
  yield* share(sites.map((_, at) => at), held.map((_, at) => at), counts, sites, neighbours, owner);

  const cells = sites.map((site, at): Cell => ({ index: at, site, polygon: outlines[at]!.map((edge) => edge.from), neighbours: neighbours[at]!, touching: touches[at]!, territory: owner[at]! }));
  const borders = outlines.flatMap((edges, at) =>
    edges.filter((edge) => edge.across > at && owner[edge.across] !== owner[at]).map((edge): Border => ({ from: edge.from, to: edge.to, between: [at, edge.across] })));
  return coast === undefined ? { radius, territories: held, cells, borders } : { radius, coast, territories: held, cells, borders };
}

export function finished<T>(steps: Generator<void, T, void>): T {
  for (;;) { const at = steps.next(); if (at.done) return at.value; }
}

const cuts = new WeakMap<readonly TerritoryShare[], { coast: Coast; map: TerritoryMap }>();

export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  return finished(islandTerritoriesInSteps(shares, coast));
}

export function* islandTerritoriesInSteps(shares: readonly TerritoryShare[], coast: Coast): Generator<void, TerritoryMap, void> {
  const known = cuts.get(shares);
  if (known?.coast === coast) return known.map;
  const map = yield* territoriesInSteps(shares, coast);
  cuts.set(shares, { coast, map });
  return map;
}

function sunflower(count: number, radius: number): Point[] {
  return Array.from({ length: count }, (_, at): Point => {
    const r = radius * Math.sqrt((at + 0.5) / count);
    return { x: r * Math.cos(at * GOLDEN_ANGLE), z: r * Math.sin(at * GOLDEN_ANGLE) };
  });
}

export function onLand(p: Point, coast: Coast): boolean {
  let inside = false;
  for (const ring of coast) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i]!, ring[j]!];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
  }
  return inside;
}

export function insideOf(from: Point, to: Point, coast: Coast): { from: Point; to: Point }[] {
  const cuts = [0, 1];
  const d = { x: to.x - from.x, z: to.z - from.z };
  for (const ring of coast) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const e = { x: b.x - a.x, z: b.z - a.z };
      const denominator = d.x * e.z - d.z * e.x;
      if (denominator === 0) return;
      const t = ((a.x - from.x) * e.z - (a.z - from.z) * e.x) / denominator;
      const u = ((a.x - from.x) * d.z - (a.z - from.z) * d.x) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    });
  }
  cuts.sort((a, b) => a - b);
  const at = (t: number): Point => ({ x: from.x + t * d.x, z: from.z + t * d.z });
  return cuts.slice(1).flatMap((t, i) => (onLand(at((cuts[i]! + t) / 2), coast) && t > cuts[i]! ? [{ from: at(cuts[i]!), to: at(t) }] : []));
}

export function landArea(coast: Coast): number {
  const area = (ring: readonly Point[]) => Math.abs(ring.reduce((sum, p, at) => { const q = ring[(at + 1) % ring.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
  return coast.reduce((sum, ring) => {
    const depth = coast.filter((other) => other !== ring && onLand(ring[0]!, [other])).length;
    return sum + (depth % 2 === 0 ? area(ring) : -area(ring));
  }, 0);
}

export function territoryAt(map: TerritoryMap, x: number, z: number): Territory | undefined {
  if (map.cells.length === 0 || (map.coast === undefined ? Math.hypot(x, z) > map.radius : !onLand({ x, z }, map.coast))) return undefined;
  let [nearest, best] = [map.cells[0]!, Infinity];
  for (const cell of map.cells) {
    const far = (x - cell.site.x) ** 2 + (z - cell.site.z) ** 2;
    if (far < best) [nearest, best] = [cell, far];
  }
  return map.territories[nearest.territory];
}

export function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map(() => 1);
  let left = total - weights.length;
  const exact = weights.map((weight) => (weight / sum) * total - 1);
  const floors = exact.map((value) => Math.max(0, Math.floor(value)));
  floors.forEach((floor, at) => { const take = Math.min(floor, left); counts[at]! += take; left -= take; });
  const order = exact.map((value, at) => ({ at, rest: value - Math.floor(Math.max(0, value)) })).sort((a, b) => b.rest - a.rest || a.at - b.at);
  for (let at = 0; left > 0; at = (at + 1) % order.length, left--) counts[order[at]!.at]! += 1;
  return counts;
}

export function atLeast(counts: number[], least: number): number[] {
  for (let at = 0; at < counts.length; at++) while (counts[at]! < least) {
    const largest = counts.reduce((best, n, i) => (n > counts[best]! ? i : best), 0);
    counts[largest]! -= 1;
    counts[at]! += 1;
  }
  return counts;
}

function* share(cells: readonly number[], owners: readonly number[], counts: readonly number[], sites: readonly Point[], neighbours: readonly (readonly number[])[], owner: number[]): Generator<void, void, void> {
  if (owners.length === 0) return;
  if (owners.length === 1) { for (const cell of cells) owner[cell] = owners[0]!; return; }
  const weight = (group: readonly number[]) => group.reduce((sum, at) => sum + counts[at]!, 0);
  const whole = weight(owners);
  let cut = 1;
  for (let at = 1; at < owners.length; at++) if (Math.abs(weight(owners.slice(0, at)) * 2 - whole) < Math.abs(weight(owners.slice(0, cut)) * 2 - whole)) cut = at;
  const [first, second] = [owners.slice(0, cut), owners.slice(cut)];
  const xs = cells.map((cell) => sites[cell]!.x);
  const zs = cells.map((cell) => sites[cell]!.z);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const along = (cell: number) => (alongX ? sites[cell]!.x : sites[cell]!.z);
  const here = new Set(cells);
  const start = cells.reduce((best, cell) => (along(cell) < along(best) ? cell : best));
  const grown = new Set([start]);
  const frontier = new Set(neighbours[start]!.filter((n) => here.has(n)));
  const target = Math.max(first.length, Math.min(cells.length - second.length, Math.round((cells.length * weight(first)) / whole)));
  while (grown.size < target && frontier.size > 0) {
    const ranked = [...frontier].sort((a, b) => along(a) - along(b) || a - b);
    const next = ranked.find((cell) => pieces(cells.filter((other) => other !== cell && !grown.has(other)), neighbours).length <= 1) ?? ranked[0]!;
    frontier.delete(next);
    grown.add(next);
    for (const n of neighbours[next]!) if (here.has(n) && !grown.has(n)) frontier.add(n);
    if (grown.size % CELLS_A_STEP === 0) yield;
  }
  let rest = cells.filter((cell) => !grown.has(cell));
  const [main, ...pockets] = pieces(rest, neighbours).sort((a, b) => b.length - a.length);
  if (pockets.length > 0 && main!.length >= second.length) {
    for (const cell of pockets.flat()) grown.add(cell);
    rest = main!;
  }
  yield* share([...grown], first, counts, sites, neighbours, owner);
  yield* share(rest, second, counts, sites, neighbours, owner);
}

function pieces(cells: readonly number[], neighbours: readonly (readonly number[])[]): number[][] {
  const left = new Set(cells);
  const found: number[][] = [];
  for (const seed of cells) {
    if (!left.has(seed)) continue;
    left.delete(seed);
    const piece = [seed];
    for (let at = 0; at < piece.length; at++) for (const n of neighbours[piece[at]!]!) if (left.delete(n)) piece.push(n);
    found.push(piece);
  }
  return found;
}

function voronoiCell(sites: readonly Point[], at: number, radius: number): Edge[] {
  let edges: Edge[] = Array.from({ length: COAST_SIDES }, (_, side) => {
    const angle = (a: number) => ({ x: radius * Math.cos((a / COAST_SIDES) * 2 * Math.PI), z: radius * Math.sin((a / COAST_SIDES) * 2 * Math.PI) });
    return { from: angle(side), to: angle(side + 1), across: -1 };
  });
  const site = sites[at]!;
  sites.forEach((other, index) => {
    if (index === at) return;
    const n = { x: other.x - site.x, z: other.z - site.z };
    const c = (other.x * other.x + other.z * other.z - site.x * site.x - site.z * site.z) / 2;
    edges = clip(edges, n, c, index);
  });
  return edges;
}

function clip(edges: readonly Edge[], n: Point, c: number, across: number): Edge[] {
  const inside = (p: Point) => n.x * p.x + n.z * p.z <= c + 1e-12;
  const cross = (p: Point, q: Point): Point => {
    const t = (c - (n.x * p.x + n.z * p.z)) / (n.x * (q.x - p.x) + n.z * (q.z - p.z));
    return { x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) };
  };
  const kept: Edge[] = [];
  let entry: Point | undefined;
  let exit: Point | undefined;
  let exitAt = -1;
  for (const edge of edges) {
    const [a, b] = [inside(edge.from), inside(edge.to)];
    if (a && b) kept.push(edge);
    else if (a && !b) { exit = cross(edge.from, edge.to); kept.push({ ...edge, to: exit }); exitAt = kept.length; }
    else if (!a && b) { entry = cross(edge.from, edge.to); kept.push({ ...edge, from: entry }); }
  }
  if (entry === undefined || exit === undefined) return kept.length === 0 ? [] : kept;
  kept.splice(exitAt, 0, { from: exit, to: entry, across });
  return kept;
}
