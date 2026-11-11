/**
 * Capability 3 · Story node render (the forest story): each capability's territory on its story's
 * island (ADR-0804 D2, D3), in the island's own flat coordinates, its middle at (0, 0).
 *
 * - The island is cut into near-equal cells: one per seed of a sunflower spiral, each cell the land
 *   nearer its seed than any other (a Voronoi cell), clipped to the island's round coast.
 * - Each territory is given cells in proportion to its lines of code, so its area follows its lines,
 *   but never fewer than round 13's minimum (MIN_SHARE of the cells), taken from the largest.
 *   Unclaimed code is a territory of its own, with no capability.
 * - The cells are shared out by halving: the territories are split into two groups of near-equal
 *   weight, the cells along the longer axis in the same proportion, and each half again, so every
 *   territory is one connected run of cells.
 * - A border is the edge two cells of different territories share.
 * - Cells are neighbours only across an edge with JOIN of a cell's side on the land: two lobes of a coast meet over
 *   a bay, and a territory joined across it would be drawn in two pieces.
 */

export type Point = { readonly x: number; readonly z: number };

/** What a territory stands for: a capability's code, or Unclaimed code (no capability). */
export type TerritoryShare = { readonly capability?: string; readonly title?: string; readonly description?: string; readonly lines: number };

export type Territory = TerritoryShare;

export type Cell = {
  readonly index: number;
  /** The seed the cell is nearest to. */
  readonly site: Point;
  /** The cell's outline, counter-clockwise. */
  readonly polygon: readonly Point[];
  /** The cells it shares an edge with on the land, so a territory joined through them is drawn in one piece. */
  readonly neighbours: readonly number[];
  /** Every cell it shares an edge with, on the land or over the sea, so a short stretch of land between two still gets its border. */
  readonly touching: readonly number[];
  /** Its territory, by position in `territories`. */
  readonly territory: number;
};

export type Border = { readonly from: Point; readonly to: Point; readonly between: readonly [number, number] };

/** An island's coast: its loops (a loop inside a loop is a lake). */
export type Coast = readonly (readonly Point[])[];

export type TerritoryMap = {
  /** How far the land reaches from the island's middle. */
  readonly radius: number;
  /** The coast the land was cut to, if it is not the round island of `radius`. */
  readonly coast?: Coast;
  readonly territories: readonly Territory[];
  readonly cells: readonly Cell[];
  readonly borders: readonly Border[];
};

/** Enough cells that a territory's area follows its lines closely, at most a few hundred to cut. */
const CELLS = 120;
/** Round 13's minimum territory, as a share of the cells: 5 of the 246 The library's look was tuned on. */
export const MIN_SHARE = 5 / 246;
/** The round coast, as a polygon of this many sides. */
const COAST_SIDES = 64;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** How much of a cell's side (the root of its mean area) must lie on the land for the cells across it to be neighbours. */
const JOIN = 0.05;

/** An edge of a cell's outline, with the cell across it (-1 on the coast). */
type Edge = { from: Point; to: Point; across: number };

/**
 * The island cut into territories, one per share in the order given (empty shares, no lines, get no
 * land). The island is the round one of radius `outline`, or the land inside the coast `outline`: then
 * the seeds are spread over the disc the coast reaches, and only those on the land are kept.
 */
export function territories(shares: readonly TerritoryShare[], outline: number | Coast, cellCount = CELLS): TerritoryMap {
  return finished(territoriesInSteps(shares, outline, cellCount));
}

/** How many cells' outlines a step of {@link territoriesInSteps} cuts, and how many cells a step of sharing hands out. */
const CELLS_A_STEP = 32;

/** {@link territories}, a step at a time (3.87): each `yield` ends a step of the cut, so a fine one can be spread over tasks. */
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

/** What `steps` returns, all its steps taken at once. */
export function finished<T>(steps: Generator<void, T, void>): T {
  for (;;) { const at = steps.next(); if (at.done) return at.value; }
}

/** Each island's cut, by its shares and coast, so its drawing, its nameplates and its lit lanes cut it once. */
const cuts = new WeakMap<readonly TerritoryShare[], { coast: Coast; map: TerritoryMap }>();

/** {@link territories} of an island's `shares` cut to its `coast`, once for the pair whoever asks. */
export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  return finished(islandTerritoriesInSteps(shares, coast));
}

/** {@link islandTerritories}, a step at a time (3.87). */
export function* islandTerritoriesInSteps(shares: readonly TerritoryShare[], coast: Coast): Generator<void, TerritoryMap, void> {
  const known = cuts.get(shares);
  if (known?.coast === coast) return known.map;
  const map = yield* territoriesInSteps(shares, coast);
  cuts.set(shares, { coast, map });
  return map;
}

/** `count` seeds spread evenly over the disc of `radius`, like a sunflower's. */
function sunflower(count: number, radius: number): Point[] {
  return Array.from({ length: count }, (_, at): Point => {
    const r = radius * Math.sqrt((at + 0.5) / count);
    return { x: r * Math.cos(at * GOLDEN_ANGLE), z: r * Math.sin(at * GOLDEN_ANGLE) };
  });
}

/** Whether `p` is on the land inside the coast's loops (a loop inside a loop is a lake). */
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

/** The pieces of the segment from `from` to `to` that lie on the land. */
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

/** The land's area: its outer loops less its lakes. */
export function landArea(coast: Coast): number {
  const area = (ring: readonly Point[]) => Math.abs(ring.reduce((sum, p, at) => { const q = ring[(at + 1) % ring.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
  return coast.reduce((sum, ring) => {
    const depth = coast.filter((other) => other !== ring && onLand(ring[0]!, [other])).length;
    return sum + (depth % 2 === 0 ? area(ring) : -area(ring));
  }, 0);
}

/** The territory under the point (x, z) of the island, or undefined off its coast. */
export function territoryAt(map: TerritoryMap, x: number, z: number): Territory | undefined {
  if (map.cells.length === 0 || (map.coast === undefined ? Math.hypot(x, z) > map.radius : !onLand({ x, z }, map.coast))) return undefined;
  let [nearest, best] = [map.cells[0]!, Infinity];
  for (const cell of map.cells) {
    const far = (x - cell.site.x) ** 2 + (z - cell.site.z) ** 2;
    if (far < best) [nearest, best] = [cell, far];
  }
  return map.territories[nearest.territory];
}

/** `total` cells shared in proportion to `weights`, each at least one, by largest remainder. */
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

/** `counts` with every one raised to `least`, a cell at a time from the largest. */
export function atLeast(counts: number[], least: number): number[] {
  for (let at = 0; at < counts.length; at++) while (counts[at]! < least) {
    const largest = counts.reduce((best, n, i) => (n > counts[best]! ? i : best), 0);
    counts[largest]! -= 1;
    counts[at]! += 1;
  }
  return counts;
}

/**
 * Share `cells` among `owners` (their cell counts in `counts`) by halving: the first group grows from the
 * cell furthest along the longer axis, always taking the neighbouring cell least far along, so each half
 * is one connected run.
 */
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
    // The cell least far along whose taking leaves the rest in one piece, else the least far along.
    const ranked = [...frontier].sort((a, b) => along(a) - along(b) || a - b);
    const next = ranked.find((cell) => pieces(cells.filter((other) => other !== cell && !grown.has(other)), neighbours).length <= 1) ?? ranked[0]!;
    frontier.delete(next);
    grown.add(next);
    for (const n of neighbours[next]!) if (here.has(n) && !grown.has(n)) frontier.add(n);
    if (grown.size % CELLS_A_STEP === 0) yield;
  }
  // A pocket the growth cut off from the rest of the land joins the grown half, while the rest keeps a cell for each of its owners.
  let rest = cells.filter((cell) => !grown.has(cell));
  const [main, ...pockets] = pieces(rest, neighbours).sort((a, b) => b.length - a.length);
  if (pockets.length > 0 && main!.length >= second.length) {
    for (const cell of pockets.flat()) grown.add(cell);
    rest = main!;
  }
  yield* share([...grown], first, counts, sites, neighbours, owner);
  yield* share(rest, second, counts, sites, neighbours, owner);
}

/** `cells` in their connected pieces, across shared edges. */
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

/** The cell of `sites[at]`: the round coast cut by the half-plane nearer it than each other seed. */
function voronoiCell(sites: readonly Point[], at: number, radius: number): Edge[] {
  let edges: Edge[] = Array.from({ length: COAST_SIDES }, (_, side) => {
    const angle = (a: number) => ({ x: radius * Math.cos((a / COAST_SIDES) * 2 * Math.PI), z: radius * Math.sin((a / COAST_SIDES) * 2 * Math.PI) });
    return { from: angle(side), to: angle(side + 1), across: -1 };
  });
  const site = sites[at]!;
  sites.forEach((other, index) => {
    if (index === at) return;
    // Keep the side of the perpendicular bisector nearer `site`: n·p <= c.
    const n = { x: other.x - site.x, z: other.z - site.z };
    const c = (other.x * other.x + other.z * other.z - site.x * site.x - site.z * site.z) / 2;
    edges = clip(edges, n, c, index);
  });
  return edges;
}

/** A closed outline cut to the half-plane n·p <= c; the new edge along the cut is `across` the cell there. */
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
