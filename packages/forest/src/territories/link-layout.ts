/**
 * Capability 3 · Story node render (the forest story): each island's territories laid out by their links
 * (ADR-1236 D1, rollout 2 step 2), ported from the capability tree mock's layout rules
 * (docs/design/capability-tree-3d/q-all-islands/tools/layout.ts); its search is territory-search.ts's (step 2b).
 *
 * - The island is scaled to The library's size, the size every round of the look was tuned at, cut by the map's own
 *   cutter run finer (CUT cells), and drawn back at its own size, so its marks stand as large as The library's.
 * - Open land, held by no territory, lies round each dock the map lands sea lanes at: its reach grows with the lanes the
 *   dock carries, from KEYS_OPEN for one to MOUTH for 64 or more. Land the open land cuts off from the rest is open too.
 * - A capability a lane lands at (an interface) grows from the frontier cell nearest the dock carrying most of its
 *   lanes; one linked only at home (an internal) grows inland, near the territories it links to. A territory with a
 *   kept seed (3.80) grows from the free cell of its kind nearest it instead.
 * - Each territory grows to its share of the land left, by its lines, never under round 13's minimum, then the sizes
 *   are balanced cell by cell along neighbours, every territory kept in one piece.
 * An arrangement that cannot be grown even after moving its seeds leaves the island on the map's own cut.
 */
import { keptArrangement } from "./kept-layout.js";
import { apportion, atLeast, finished, islandTerritoriesInSteps, landArea, MIN_SHARE, territoriesInSteps, type Border, type Cell, type Coast, type Point, type TerritoryMap, type TerritoryShare } from "./territories.js";

/** The library's land in ground units², the size the look was tuned at. */
export const LIBRARY_LAND = 24105;
/** How finely the island is cut: about twice the map's own, so territories can shrink and still follow their lines. */
const CUT = 260;
/** The open land's reach round a dock carrying one lane, and one carrying 64 or more, in The library's units. */
const KEYS_OPEN = 11, MOUTH = 25;
/** How far inside the coast an interface's seed may lie. */
const FRONT = 9;
/** How many seed moves to try before an arrangement that will not grow gives way to the map's own cut. */
const TRIES = 50;

/** Where sea lanes come ashore, in the island's own coordinates, with the links (`from->to`) they carry. */
export type LinkDock = { readonly local: Point; readonly links: readonly string[] };
/** A capability dependency, `from` building on `to`. */
export type Link = { readonly from: string; readonly to: string };

/** The island's id for its Unclaimed code, which has no capability. */
export const UNCLAIMED = "";
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const times = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });

/** Where each territory grows from, in The library's units, by its capability (UNCLAIMED for the Unclaimed code): points,
 * not cells, so they still mean the same place when the coast grows and the cut moves. */
export type Seeds = Readonly<Record<string, Point>>;

const laid = new WeakMap<readonly TerritoryShare[], { coast: Coast; key: string; kept: Seeds | undefined; map: TerritoryMap }>();

/**
 * The island's territories as the map draws them: laid out by its links when it is given the docks its lanes come
 * ashore at (every island, once the sea's lanes are routed), grown from the arrangement kept for `story` where there is
 * one (3.80), else the map's own cut. Laid out once for the same shares, coast, links, docks and kept arrangement, whoever asks.
 */
export function islandLayout(story: string, shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[] | undefined): TerritoryMap {
  return finished(islandLayoutSteps(story, shares, coast, links, docks));
}

/** {@link islandLayout}, a step at a time (3.87): the fine cut a few cells to a step, then the seeds, then each try at
 * growing the territories, so the map can settle an island across tasks. One already laid out takes no step. */
export function* islandLayoutSteps(story: string, shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[] | undefined): Generator<void, TerritoryMap, void> {
  if (docks === undefined) return yield* islandTerritoriesInSteps(shares, coast);
  const kept = keptArrangement(story)?.seeds;
  const key = JSON.stringify([links, docks]), known = laid.get(shares);
  if (known?.coast === coast && known.key === key && known.kept === kept) return known.map;
  const map = yield* linkLayoutSteps(shares, coast, links, docks, kept);
  laid.set(shares, { coast, key, kept, map });
  return map;
}

/** The island cut to `coast` with its territories laid out by `links` and the `docks` its lanes come ashore at, grown
 * from the `kept` seeds where given (3.80), every other territory placed as the start places it. */
export function linkLayout(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[], kept?: Seeds): TerritoryMap {
  return finished(linkLayoutSteps(shares, coast, links, docks, kept));
}

function* linkLayoutSteps(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[], kept?: Seeds): Generator<void, TerritoryMap, void> {
  const island = yield* prepareIslandSteps(shares, coast, links, docks);
  yield;
  const seeds = island && startSeeds(island, kept);
  const owners = island && seeds && (yield* settleSteps(island, seeds))?.owners;
  return island && owners ? drawnIsland(island, owners) : yield* islandTerritoriesInSteps(shares, coast);
}

/** How far the open land reaches round a dock whose lanes reach `n` links here, in The library's units. */
export function openReach(n: number): number {
  return n <= 0 ? 0 : KEYS_OPEN + (MOUTH - KEYS_OPEN) * Math.min(1, Math.log(n) / Math.log(64));
}

/** An island made ready to lay out: its fine cut at The library's size, its open land, the land each territory may
 * grow on and how much of it each holds. */
export type PreparedIsland = {
  readonly coast: Coast; readonly scale: number; readonly fine: TerritoryMap; readonly ids: readonly string[];
  readonly open: readonly boolean[]; readonly main: readonly number[]; readonly frontier: readonly boolean[];
  readonly counts: readonly number[]; readonly least: number;
  /** Each interface (a territory a lane lands at), by the dock carrying most of its lanes. */
  readonly dockOf: ReadonlyMap<number, number>;
  /** The docks, in The library's units, on its coast. */
  readonly docks: readonly LinkDock[];
  readonly partners: (t: number) => number[];
};

/** The island ready to lay out, or undefined when it cannot be (no land, or fewer cells left than territories). */
export function prepareIsland(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], given: readonly LinkDock[]): PreparedIsland | undefined {
  return finished(prepareIslandSteps(shares, coast, links, given));
}

function* prepareIslandSteps(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], given: readonly LinkDock[]): Generator<void, PreparedIsland | undefined, void> {
  const scale = Math.sqrt(landArea(coast) / LIBRARY_LAND);
  if (!(scale > 0)) return undefined;
  const ground = coast.map((ring) => ring.map((p) => times(p, 1 / scale)));
  const fine = yield* territoriesInSteps(shares, ground, CUT);
  const docks = given.map((dock) => ({ local: ontoCoast(times(dock.local, 1 / scale), ground), links: dock.links }));
  const { cells, territories: held } = fine;
  const ids = held.map((t) => t.capability ?? UNCLAIMED), index = new Map(ids.map((id, at) => [id, at]));
  if (held.length < 2) return undefined;
  const here = (id: string) => id !== UNCLAIMED && index.has(id);
  // Each dock's lanes by the capability here they reach, and how many it carries.
  const lands = docks.map((dock) => {
    const reached = new Map<number, number>();
    for (const link of dock.links) {
      const [from, to] = link.split("->") as [string, string];
      const mine = here(to) && !here(from) ? to : here(from) && !here(to) ? from : undefined;
      if (mine !== undefined) reached.set(index.get(mine)!, (reached.get(index.get(mine)!) ?? 0) + 1);
    }
    return reached;
  });
  const loads = lands.map((reached) => [...reached.values()].reduce((s, n) => s + n, 0));
  const open = cells.map((cell) => docks.some((dock, k) => far(cell.site, dock.local) < openReach(loads[k]!)));
  // Land the open land cuts off from the rest is open land too, so the territories share one piece of land.
  const pieces = piecesOf(cells.map((_, c) => c).filter((c) => !open[c]), cells);
  if (pieces.length === 0) return undefined;
  const main = pieces.reduce((a, b) => (b.length > a.length ? b : a));
  for (const piece of pieces) if (piece !== main) for (const c of piece) open[c] = true;
  const owned = main.length;
  if (owned < held.length) return undefined;

  // Each territory's cells: its lines' share of the land left, never under round 13's minimum.
  const least = Math.max(1, Math.min(Math.floor(owned / held.length), Math.round(MIN_SHARE * owned)));
  const counts = atLeast(apportion(held.map((t) => t.lines), owned), least);

  const toCoast = (p: Point) => Math.min(...ground.flatMap((ring) => ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length]!))));
  const frontier = cells.map((cell, c) => !open[c] && (cell.neighbours.some((n) => open[n]) || toCoast(cell.site) < FRONT));
  // Interfaces: each territory a lane lands at, by the dock carrying most of its lanes.
  const dockOf = new Map<number, number>();
  lands.forEach((reached, k) => reached.forEach((n, t) => { const best = dockOf.get(t); if (best === undefined || n > lands[best]!.get(t)!) dockOf.set(t, k); }));
  const own = links.filter((l) => here(l.from) && here(l.to) && l.from !== l.to).map((l) => [index.get(l.from)!, index.get(l.to)!] as const);
  const partners = (t: number) => own.flatMap(([a, b]) => (a === t ? [b] : b === t ? [a] : []));
  return { coast, scale, fine, ids, open, main, frontier, counts, least, dockOf, docks, partners };
}

/** Each cell's fitness as territory `t`'s seed: an interface's on the frontier, an internal's anywhere held. */
export function seedKind(island: PreparedIsland, t: number): boolean[] {
  if (island.dockOf.has(t)) return [...island.frontier];
  const held = new Set(island.main);
  return island.open.map((o, c) => !o && held.has(c));
}

/**
 * The cell each territory starts growing from: a kept seed's nearest free cell of its kind (3.80); else each interface
 * on the frontier nearest its dock, each internal inland, near the middle of the seeds it links to pulled toward the
 * island's middle, or else as far as it can be from every seed placed.
 */
export function startSeeds(island: PreparedIsland, kept?: Seeds): number[] | undefined {
  const { fine: { cells }, ids, main, frontier, dockOf, docks, partners } = island;
  const N = cells.length, owned = main.length;
  const frontierCells = main.filter((c) => frontier[c]), inlandCells = main.filter((c) => !frontier[c]);
  const seeds = new Array<number>(ids.length).fill(-1), used = new Set<number>();
  ids.forEach((id, t) => {
    const at = kept?.[id];
    if (at === undefined) return;
    const kind = seedKind(island, t), free = main.filter((c) => kind[c] && !used.has(c));
    if (free.length === 0) return;
    const c = free.reduce((b, x) => (far(cells[x]!.site, at) < far(cells[b]!.site, at) ? x : b));
    seeds[t] = c; used.add(c);
  });
  const area = cells.reduce((s, cell) => s + polygonArea(cell.polygon), 0) / N;
  const apart = 0.5 * Math.sqrt(owned / ids.length) * Math.sqrt(area);
  const take = (pool: readonly number[], toward: Point) => {
    const free = pool.filter((c) => !used.has(c)), spaced = free.filter((c) => [...used].every((u) => far(cells[u]!.site, cells[c]!.site) >= apart));
    const choice = spaced.length ? spaced : free;
    if (choice.length === 0) return -1;
    return choice.reduce((b, c) => (far(cells[c]!.site, toward) < far(cells[b]!.site, toward) ? c : b));
  };
  for (const [t, k] of dockOf) if (seeds[t]! < 0) { const c = take(frontierCells.length ? frontierCells : main, docks[k]!.local); seeds[t] = c; used.add(c); }
  const inland = ids.map((_, t) => t).filter((t) => !dockOf.has(t) && seeds[t]! < 0).sort((a, b) => partners(b).length - partners(a).length || a - b);
  for (const t of inland) {
    const placed = partners(t).filter((p) => seeds[p]! >= 0).map((p) => cells[seeds[p]!]!.site);
    const pool = inlandCells.filter((c) => !used.has(c)).length ? inlandCells : main;
    let c: number;
    if (placed.length) c = take(pool, { x: 0.6 * placed.reduce((s, p) => s + p.x, 0) / placed.length, z: 0.6 * placed.reduce((s, p) => s + p.z, 0) / placed.length });
    else {
      const free = pool.filter((x) => !used.has(x)), gap = (x: number) => Math.min(Infinity, ...[...used].map((u) => far(cells[u]!.site, cells[x]!.site)));
      c = free.length ? free.reduce((b, x) => (gap(x) > gap(b) ? x : b)) : -1;
    }
    seeds[t] = c; used.add(c);
  }
  return seeds.some((c) => c < 0) ? undefined : seeds;
}

/** Each cell's territory (its index in the island's territories, -1 for open land) grown from `seeds`, or undefined
 * when none grows, with the seeds it grew from. Seeds that will not grow are moved, a seeded walk so the island repeats: an interface along the
 * frontier, an internal anywhere. */
export function settle(island: PreparedIsland, seeds: readonly number[]): { owners: number[]; seeds: readonly number[] } | undefined {
  return finished(settleSteps(island, seeds));
}

/** {@link settle}, a try at growing to a step (3.87). */
function* settleSteps(island: PreparedIsland, seeds: readonly number[]): Generator<void, { owners: number[]; seeds: readonly number[] } | undefined, void> {
  const { fine: { cells }, ids, main } = island;
  let state = 43;
  const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  let tried = seeds;
  for (let attempt = 0; attempt <= TRIES; attempt++) {
    const grown = grow(tried, island.counts, island.least, island.open, cells);
    if (Array.isArray(grown)) return { owners: grown, seeds: tried };
    // The territory that fell furthest short moves, mostly; sometimes another, so the walk cannot stall on one.
    const next = [...tried], t = grown.short >= 0 && random() < 0.8 ? grown.short : Math.floor(random() * ids.length), taken = new Set(tried);
    const kind = seedKind(island, t);
    const near = (random() < 0.75 ? cells[tried[t]!]!.neighbours.filter((n) => kind[n]) : main.filter((c) => kind[c])).filter((c) => !taken.has(c));
    if (near.length) next[t] = near[Math.floor(random() * near.length)]!;
    tried = next;
    yield;
  }
  return undefined;
}

/** The territories grown from exactly `seeds`, with no walk, or undefined when they do not grow: a step of the search. */
export function grownFrom(island: PreparedIsland, seeds: readonly number[]): number[] | undefined {
  const grown = grow(seeds, island.counts, island.least, island.open, island.fine.cells);
  return Array.isArray(grown) ? grown : undefined;
}

/** The island as the map draws it, each cell held by `owners`' territory, at the island's own size. */
export function drawnIsland(island: PreparedIsland, owners: readonly number[]): TerritoryMap {
  const { fine, scale, coast } = island;
  const cells = fine.cells.map((cell, at): Cell => ({ ...cell, site: times(cell.site, scale), polygon: cell.polygon.map((p) => times(p, scale)), territory: owners[at]! }));
  const borders: Border[] = [];
  fine.cells.forEach((cell, at) => {
    for (const n of cell.touching) if (n > at && owners[n] !== owners[at]) {
      const edge = sharedEdge(cells[at]!, cells[n]!);
      if (edge) borders.push({ from: edge[0], to: edge[1], between: [at, n] });
    }
  });
  return { radius: fine.radius * scale, coast, territories: fine.territories, cells, borders };
}

/** Seed cells as points to keep, in The library's units, by territory id. */
export function seedPoints(island: PreparedIsland, seeds: readonly number[]): Seeds {
  return Object.fromEntries(island.ids.map((id, t) => [id, island.fine.cells[seeds[t]!]!.site]));
}

/** The territories grown from `seeds` to `counts` over the land not `open`, each one connected; when they cannot be,
 * the territory that fell furthest short of its size (-1 for none). */
function grow(seeds: readonly number[], counts: readonly number[], least: number, open: readonly boolean[], cells: readonly Cell[]): number[] | { short: number } {
  const N = cells.length, FREE = -2;
  const owner = cells.map((_, c): number => (open[c] ? -1 : FREE));
  const mine = counts.map(() => [] as number[]);
  for (const [t, c] of seeds.entries()) { if (owner[c] !== FREE) return { short: t }; owner[c] = t; mine[t]!.push(c); }
  let left = owner.filter((o) => o === FREE).length;
  // The territory furthest short of its size takes the free cell beside it nearest its seed.
  while (left > 0) {
    let best = -1, most = -Infinity, cell = -1;
    for (let t = 0; t < counts.length; t++) {
      const need = (counts[t]! - mine[t]!.length) / counts[t]!;
      if (need <= most) continue;
      let near = -1, d = Infinity;
      const seed = cells[seeds[t]!]!.site;
      for (const c of mine[t]!) for (const n of cells[c]!.neighbours) if (owner[n] === FREE) { const dd = far(cells[n]!.site, seed); if (dd < d) { d = dd; near = n; } }
      if (near < 0) continue;
      best = t; most = need; cell = near;
    }
    if (best < 0) break;
    owner[cell] = best; mine[best]!.push(cell); left--;
  }
  // A territory walled in short of its size leaves cells no one grew into: each goes to a territory beside it.
  for (let pass = 0; left > 0 && pass < N; pass++) for (let c = 0; c < N; c++) if (owner[c] === FREE) {
    const by = cells[c]!.neighbours.map((n) => owner[n]!).find((o) => o >= 0);
    if (by !== undefined) { owner[c] = by; left--; }
  }
  if (left > 0) return { short: -1 };
  balance(owner, seeds, counts, cells);
  const sizes = counts.map(() => 0);
  for (const o of owner) if (o >= 0) sizes[o]! += 1;
  // Balanced to within a cell or two of each size (a tenth of a large one), never under the least a territory holds.
  const short = sizes.reduce((worst, n, t) => (n / counts[t]! < sizes[worst]! / counts[worst]! ? t : worst), 0);
  if (sizes.some((n, t) => n < least || Math.abs(n - counts[t]!) > Math.max(2, Math.round(counts[t]! / 10)))) return { short };
  if (counts.some((_, t) => !whole(owner, t, -1, cells))) return { short: -1 };
  return owner;
}

/** Hands cells along neighbouring territories, from one over its size to one under, keeping every giver in one piece:
 * each round finds, for a territory short of its size, the shortest chain of hand-overs that can be made from one with
 * cells to spare, and makes it. */
function balance(owner: number[], seeds: readonly number[], counts: readonly number[], cells: readonly Cell[]): void {
  // The cell `giver` can hand `taker` nearest the taker's seed, keeping the giver whole, if any.
  const handOver = (giver: number, taker: number): number => {
    const seed = cells[seeds[taker]!]!.site;
    const options = owner.flatMap((o, c) => (o === giver && cells[c]!.neighbours.some((n) => owner[n] === taker) ? [c] : []))
      .sort((a, b) => far(cells[a]!.site, seed) - far(cells[b]!.site, seed) || a - b);
    return options.find((c) => whole(owner, giver, c, cells)) ?? -1;
  };
  for (let round = 0; round < cells.length * 4; round++) {
    const have = counts.map(() => 0);
    for (const o of owner) if (o >= 0) have[o]! += 1;
    const next = counts.map(() => new Set<number>());
    cells.forEach((cell, c) => { for (const n of cell.neighbours) if (owner[c]! >= 0 && owner[n]! >= 0 && owner[c] !== owner[n]) next[owner[c]!]!.add(owner[n]!); });
    let moved = false;
    const known = new Map<string, number>(), can = (giver: number, taker: number) => {
      const k = `${giver}>${taker}`;
      if (!known.has(k)) known.set(k, handOver(giver, taker));
      return known.get(k)!;
    };
    for (const under of counts.flatMap((n, t) => (have[t]! < n ? [t] : []))) {
      const back = new Map<number, number>([[under, -1]]), queue = [under];
      let spare = -1;
      while (queue.length && spare < 0) {
        const t = queue.shift()!;
        for (const n of next[t]!) if (!back.has(n) && can(n, t) >= 0) { back.set(n, t); if (have[n]! > counts[n]!) { spare = n; break; } queue.push(n); }
      }
      if (spare < 0) continue;
      for (let giver = spare; back.get(giver)! >= 0; giver = back.get(giver)!) {
        const c = handOver(giver, back.get(giver)!);
        if (c < 0) break;
        owner[c] = back.get(giver)!;
      }
      moved = true;
      break;
    }
    if (!moved) return;
  }
}

/** Whether territory `t`'s cells, less `without`, are one connected piece (and not none). */
function whole(owner: readonly number[], t: number, without: number, cells: readonly Cell[]): boolean {
  let first = -1, size = 0;
  for (let c = 0; c < owner.length; c++) if (owner[c] === t && c !== without) { size++; if (first < 0) first = c; }
  if (first < 0) return false;
  const seen = new Set([first]), queue = [first];
  while (queue.length) { const c = queue.pop()!; for (const n of cells[c]!.neighbours) if (n !== without && owner[n] === t && !seen.has(n)) { seen.add(n); queue.push(n); } }
  return seen.size === size;
}

/** `cells` in their connected pieces. */
function piecesOf(list: readonly number[], cells: readonly Cell[]): number[][] {
  const left = new Set(list), found: number[][] = [];
  for (const start of list) {
    if (!left.delete(start)) continue;
    const piece = [start];
    for (let at = 0; at < piece.length; at++) for (const n of cells[piece[at]!]!.neighbours) if (left.delete(n)) piece.push(n);
    found.push(piece);
  }
  return found;
}

/** The edge two neighbouring cells share: the corners of `a`'s outline that are also corners of `b`'s. */
export function sharedEdge(a: Cell, b: Cell): [Point, Point] | undefined {
  const close = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-5 && Math.abs(p.z - q.z) < 1e-5;
  const common = a.polygon.filter((p) => b.polygon.some((q) => close(p, q)));
  return common.length >= 2 ? [common[0]!, common[common.length - 1]!] : undefined;
}

/** The nearest point of the coast: a dock is read where its lane comes ashore, a little off the coast. */
export function ontoCoast(p: Point, coast: Coast): Point {
  let best = p, d = Infinity;
  for (const ring of coast) ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const q = { x: a.x + t * dx, z: a.z + t * dz };
    if (far(p, q) < d) { d = far(p, q); best = q; }
  });
  return best;
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

function polygonArea(ring: readonly Point[]): number {
  return Math.abs(ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]!; return s + a.x * b.z - b.x * a.z; }, 0)) / 2;
}
