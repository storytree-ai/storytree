/**
 * Capability 3 · Story node render (the forest story): the selected island's territories laid out by their links
 * (ADR-1236 D1, rollout 2 step 2), ported from the capability tree mock's layout rules
 * (docs/design/capability-tree-3d/q-all-islands/tools/layout.ts) without its search.
 *
 * - The island is scaled to The library's size, the size every round of the look was tuned at, cut by the map's own
 *   cutter run finer (CUT cells), and drawn back at its own size, so its marks stand as large as The library's.
 * - Open land, held by no territory, lies round each dock the map lands sea lanes at: its reach grows with the lanes the
 *   dock carries, from KEYS_OPEN for one to MOUTH for 64 or more. Land the open land cuts off from the rest is open too.
 * - A capability a lane lands at (an interface) grows from the frontier cell nearest the dock carrying most of its
 *   lanes; one linked only at home (an internal) grows inland, near the territories it links to.
 * - Each territory grows to its share of the land left, by its lines, never under round 13's minimum, then the sizes
 *   are balanced cell by cell along neighbours, every territory kept in one piece.
 * An arrangement that cannot be grown even after moving its seeds leaves the island on the map's own cut.
 */
import { apportion, atLeast, islandTerritories, landArea, MIN_SHARE, territories, type Border, type Cell, type Coast, type Point, type TerritoryMap, type TerritoryShare } from "./territories.js";

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
const UNCLAIMED = "";
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const times = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });

const laid = new WeakMap<readonly TerritoryShare[], { coast: Coast; key: string; map: TerritoryMap }>();

/**
 * The island's territories as the map draws them: laid out by its links when it is given the docks its lanes come
 * ashore at (the selected island, once its roads are routed), else the map's own cut. Laid out once for the same
 * shares, coast, links and docks, whoever asks.
 */
export function islandLayout(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[] | undefined): TerritoryMap {
  if (docks === undefined) return islandTerritories(shares, coast);
  const key = JSON.stringify([links, docks]), known = laid.get(shares);
  if (known?.coast === coast && known.key === key) return known.map;
  const map = linkLayout(shares, coast, links, docks);
  laid.set(shares, { coast, key, map });
  return map;
}

/** The island cut to `coast` with its territories laid out by `links` and the `docks` its lanes come ashore at. */
export function linkLayout(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[]): TerritoryMap {
  const scale = Math.sqrt(landArea(coast) / LIBRARY_LAND);
  if (!(scale > 0)) return islandTerritories(shares, coast);
  const ground = coast.map((ring) => ring.map((p) => times(p, 1 / scale)));
  const fine = territories(shares, ground, CUT);
  const owners = arrange(fine, ground, links, docks.map((dock) => ({ local: ontoCoast(times(dock.local, 1 / scale), ground), links: dock.links })));
  if (owners === undefined) return islandTerritories(shares, coast);
  const cells = fine.cells.map((cell, at): Cell => ({ ...cell, site: times(cell.site, scale), polygon: cell.polygon.map((p) => times(p, scale)), territory: owners[at]! }));
  const borders: Border[] = [];
  fine.cells.forEach((cell, at) => {
    for (const n of cell.neighbours) if (n > at && owners[n] !== owners[at]) {
      const edge = sharedEdge(cells[at]!, cells[n]!);
      if (edge) borders.push({ from: edge[0], to: edge[1], between: [at, n] });
    }
  });
  return { radius: fine.radius * scale, coast, territories: fine.territories, cells, borders };
}

/** Each cell's territory (its index in `map.territories`, -1 for open land), or undefined when none grows. */
function arrange(map: TerritoryMap, coast: Coast, links: readonly Link[], docks: readonly LinkDock[]): number[] | undefined {
  const { cells, territories: held } = map;
  const N = cells.length, ids = held.map((t) => t.capability ?? UNCLAIMED), index = new Map(ids.map((id, at) => [id, at]));
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
  const reach = (n: number) => n <= 0 ? 0 : KEYS_OPEN + (MOUTH - KEYS_OPEN) * Math.min(1, Math.log(n) / Math.log(64));
  const open = cells.map((cell) => docks.some((dock, k) => far(cell.site, dock.local) < reach(loads[k]!)));
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

  const toCoast = (p: Point) => Math.min(...coast.flatMap((ring) => ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length]!))));
  const frontier = cells.map((cell, c) => !open[c] && (cell.neighbours.some((n) => open[n]) || toCoast(cell.site) < FRONT));
  const frontierCells = main.filter((c) => frontier[c]), inlandCells = main.filter((c) => !frontier[c]);
  // Interfaces: each territory a lane lands at, by the dock carrying most of its lanes.
  const dockOf = new Map<number, number>();
  lands.forEach((reached, k) => reached.forEach((n, t) => { const best = dockOf.get(t); if (best === undefined || n > lands[best]!.get(t)!) dockOf.set(t, k); }));
  const own = links.filter((l) => here(l.from) && here(l.to) && l.from !== l.to).map((l) => [index.get(l.from)!, index.get(l.to)!] as const);
  const partners = (t: number) => own.flatMap(([a, b]) => (a === t ? [b] : b === t ? [a] : []));

  // The start: each interface on the frontier nearest its dock, each internal inland, near the middle of the seeds it
  // links to pulled toward the island's middle, or else as far as it can be from every seed placed.
  const seeds = new Array<number>(held.length).fill(-1), used = new Set<number>();
  const area = cells.reduce((s, cell) => s + polygonArea(cell.polygon), 0) / N;
  const apart = 0.5 * Math.sqrt(owned / held.length) * Math.sqrt(area);
  const take = (pool: readonly number[], toward: Point) => {
    const free = pool.filter((c) => !used.has(c)), spaced = free.filter((c) => [...used].every((u) => far(cells[u]!.site, cells[c]!.site) >= apart));
    const choice = spaced.length ? spaced : free;
    if (choice.length === 0) return -1;
    return choice.reduce((b, c) => (far(cells[c]!.site, toward) < far(cells[b]!.site, toward) ? c : b));
  };
  for (const [t, k] of dockOf) { const c = take(frontierCells.length ? frontierCells : main, docks[k]!.local); seeds[t] = c; used.add(c); }
  const inland = held.map((_, t) => t).filter((t) => !dockOf.has(t)).sort((a, b) => partners(b).length - partners(a).length || a - b);
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
  if (seeds.some((c) => c < 0)) return undefined;

  // Seeds that will not grow are moved, a seeded walk so the island repeats: an interface along the frontier, an internal anywhere.
  let state = 43;
  const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  let tried = seeds;
  for (let attempt = 0; attempt <= TRIES; attempt++) {
    const grown = grow(tried, counts, least, open, cells);
    if (Array.isArray(grown)) return grown;
    // The territory that fell furthest short moves, mostly; sometimes another, so the walk cannot stall on one.
    const next = [...tried], t = grown.short >= 0 && random() < 0.8 ? grown.short : Math.floor(random() * held.length), taken = new Set(tried);
    const kind = dockOf.has(t) ? frontier : open.map((o, c) => !o && main.includes(c));
    const near = (random() < 0.75 ? cells[tried[t]!]!.neighbours.filter((n) => kind[n]) : main.filter((c) => kind[c])).filter((c) => !taken.has(c));
    if (near.length) next[t] = near[Math.floor(random() * near.length)]!;
    tried = next;
  }
  return undefined;
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
function sharedEdge(a: Cell, b: Cell): [Point, Point] | undefined {
  const close = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-5 && Math.abs(p.z - q.z) < 1e-5;
  const common = a.polygon.filter((p) => b.polygon.some((q) => close(p, q)));
  return common.length >= 2 ? [common[0]!, common[common.length - 1]!] : undefined;
}

/** The nearest point of the coast: a dock is read where its lane comes ashore, a little off the coast. */
function ontoCoast(p: Point, coast: Coast): Point {
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
