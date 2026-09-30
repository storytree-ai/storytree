/**
 * Capability 3 · Story node render (the forest story): each capability's territory on its story's
 * island (ADR-0804 D2, D3), in the island's own flat coordinates, its middle at (0, 0).
 *
 * - The island is cut into near-equal cells: one per seed of a sunflower spiral, each cell the land
 *   nearer its seed than any other (a Voronoi cell), clipped to the island's round coast.
 * - Each territory is given cells in proportion to its lines of code (at least one), so its area
 *   follows its lines. Unclaimed code is a territory of its own, with no capability.
 * - The cells are shared out by halving: the territories are split into two groups of near-equal
 *   weight, the cells along the longer axis in the same proportion, and each half again, so every
 *   territory is one connected run of cells.
 * - A border is the edge two cells of different territories share.
 */

export type Point = { readonly x: number; readonly z: number };

/** What a territory stands for: a capability's code, or Unclaimed code (no capability). */
export type TerritoryShare = { readonly capability?: string; readonly lines: number };

export type Territory = TerritoryShare;

export type Cell = {
  readonly index: number;
  /** The seed the cell is nearest to. */
  readonly site: Point;
  /** The cell's outline, counter-clockwise. */
  readonly polygon: readonly Point[];
  /** The cells it shares an edge with. */
  readonly neighbours: readonly number[];
  /** Its territory, by position in `territories`. */
  readonly territory: number;
};

export type Border = { readonly from: Point; readonly to: Point; readonly between: readonly [number, number] };

export type TerritoryMap = {
  readonly radius: number;
  readonly territories: readonly Territory[];
  readonly cells: readonly Cell[];
  readonly borders: readonly Border[];
};

/** Enough cells that a territory's area follows its lines closely, at most a few hundred to cut. */
const CELLS = 120;
/** The round coast, as a polygon of this many sides. */
const COAST_SIDES = 64;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** An edge of a cell's outline, with the cell across it (-1 on the coast). */
type Edge = { from: Point; to: Point; across: number };

/** The island of `radius` cut into territories, one per share in the order given (empty shares, no lines, get no land). */
export function territories(shares: readonly TerritoryShare[], radius: number, cellCount = CELLS): TerritoryMap {
  const held = shares.filter((share) => share.lines > 0);
  const count = Math.max(cellCount, held.length);
  const sites = Array.from({ length: count }, (_, at): Point => {
    const r = radius * Math.sqrt((at + 0.5) / count);
    return { x: r * Math.cos(at * GOLDEN_ANGLE), z: r * Math.sin(at * GOLDEN_ANGLE) };
  });
  const outlines = sites.map((site, at) => voronoiCell(sites, at, radius));
  const touching = outlines.map(() => new Set<number>());
  outlines.forEach((edges, at) => { for (const edge of edges) if (edge.across >= 0) { touching[at]!.add(edge.across); touching[edge.across]!.add(at); } });
  const neighbours = touching.map((set) => [...set].sort((a, b) => a - b));

  const owner = new Array<number>(count).fill(0);
  const counts = apportion(held.map((share) => share.lines), count);
  share(sites.map((_, at) => at), held.map((_, at) => at), counts, sites, neighbours, owner);

  const cells = sites.map((site, at): Cell => ({ index: at, site, polygon: outlines[at]!.map((edge) => edge.from), neighbours: neighbours[at]!, territory: owner[at]! }));
  const borders = outlines.flatMap((edges, at) =>
    edges.filter((edge) => edge.across > at && owner[edge.across] !== owner[at]).map((edge): Border => ({ from: edge.from, to: edge.to, between: [at, edge.across] })));
  return { radius, territories: held, cells, borders };
}

/** The territory under the point (x, z) of the island, or undefined off its coast. */
export function territoryAt(map: TerritoryMap, x: number, z: number): Territory | undefined {
  if (Math.hypot(x, z) > map.radius || map.cells.length === 0) return undefined;
  let nearest = map.cells[0]!;
  for (const cell of map.cells) if (Math.hypot(x - cell.site.x, z - cell.site.z) < Math.hypot(x - nearest.site.x, z - nearest.site.z)) nearest = cell;
  return map.territories[nearest.territory];
}

/** `total` cells shared in proportion to `weights`, each at least one, by largest remainder. */
function apportion(weights: readonly number[], total: number): number[] {
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

/**
 * Share `cells` among `owners` (their cell counts in `counts`) by halving: the first group grows from the
 * cell furthest along the longer axis, always taking the neighbouring cell least far along, so each half
 * is one connected run.
 */
function share(cells: readonly number[], owners: readonly number[], counts: readonly number[], sites: readonly Point[], neighbours: readonly (readonly number[])[], owner: number[]): void {
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
  }
  // A pocket the growth cut off from the rest of the land joins the grown half, while the rest keeps a cell for each of its owners.
  let rest = cells.filter((cell) => !grown.has(cell));
  const [main, ...pockets] = pieces(rest, neighbours).sort((a, b) => b.length - a.length);
  if (pockets.length > 0 && main!.length >= second.length) {
    for (const cell of pockets.flat()) grown.add(cell);
    rest = main!;
  }
  share([...grown], first, counts, sites, neighbours, owner);
  share(rest, second, counts, sites, neighbours, owner);
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

/** A surveyed file as the circles need it: absent `capability` is Unclaimed code. */
export type CircleFile = { readonly path: string; readonly lines: number; readonly capability?: string };

/** A file's flat circle on the island, its middle and radius in the island's own coordinates. */
export type FileCircle = { readonly path: string; readonly lines: number; readonly capability?: string; readonly x: number; readonly z: number; readonly radius: number };

/** How much of the island the circles cover at most, so the land shows between them. */
const CIRCLE_COVER = 0.45;
/** Candidate spots per cell to choose circle middles from. */
const SPOTS_PER_CELL = 8;

/**
 * Each file's flat circle (ADR-0804 D3), in the order given: its middle on its capability's territory,
 * spread out within it (the longest file nearest the territory's middle), and its diameter growing with
 * its lines (1.3 + 0.24·√lines, the owner's mock), scaled on each island so the circles cover no more
 * than CIRCLE_COVER of it. A file whose capability has no territory gets no circle.
 */
export function fileCircles(map: TerritoryMap, files: readonly CircleFile[]): FileCircle[] {
  const count = map.cells.length * SPOTS_PER_CELL;
  const spots = Array.from({ length: count }, (_, at): Point => {
    const r = map.radius * Math.sqrt((at + 0.5) / count);
    return { x: r * Math.cos(at * GOLDEN_ANGLE), z: r * Math.sin(at * GOLDEN_ANGLE) };
  });
  const territoryOf = (p: Point) => territoryAt(map, p.x, p.z);
  const diameter = (lines: number) => 1.3 + 0.24 * Math.sqrt(Math.max(0, lines));
  const cover = files.reduce((sum, file) => sum + (Math.PI * diameter(file.lines) ** 2) / 4, 0);
  const scale = cover === 0 ? 1 : Math.min(1, Math.sqrt((CIRCLE_COVER * Math.PI * map.radius ** 2) / cover));
  const placed = new Map<string, Point>();
  map.territories.forEach((territory) => {
    const mine = files.filter((file) => file.capability === territory.capability).sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
    const free = spots.filter((spot) => territoryOf(spot) === territory);
    if (mine.length === 0 || free.length === 0) return;
    const middle = { x: free.reduce((sum, p) => sum + p.x, 0) / free.length, z: free.reduce((sum, p) => sum + p.z, 0) / free.length };
    // Farthest-point sampling from the spot nearest the middle: each next spot is the one furthest from those taken.
    const taken: Point[] = [free.reduce((best, p) => (Math.hypot(p.x - middle.x, p.z - middle.z) < Math.hypot(best.x - middle.x, best.z - middle.z) ? p : best))];
    const gap = free.map((p) => Math.hypot(p.x - taken[0]!.x, p.z - taken[0]!.z));
    while (taken.length < Math.min(mine.length, free.length)) {
      let far = 0;
      gap.forEach((value, at) => { if (value > gap[far]!) far = at; });
      const next = free[far]!;
      taken.push(next);
      free.forEach((p, at) => { gap[at] = Math.min(gap[at]!, Math.hypot(p.x - next.x, p.z - next.z)); });
    }
    mine.forEach((file, at) => placed.set(file.path, taken[at % taken.length]!));
  });
  return files.flatMap((file) => {
    const at = placed.get(file.path);
    if (at === undefined) return [];
    const circle = { path: file.path, lines: file.lines, x: at.x, z: at.z, radius: (diameter(file.lines) * scale) / 2 };
    return [file.capability === undefined ? circle : { ...circle, capability: file.capability }];
  });
}
