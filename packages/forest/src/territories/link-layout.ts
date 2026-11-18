// Capability 3 · Story node render
import { keptArrangement } from "./kept-layout.js";
import { apportion, atLeast, finished, islandTerritoriesInSteps, landArea, MIN_SHARE, territoriesInSteps, type Border, type Cell, type Coast, type Point, type TerritoryMap, type TerritoryShare } from "./territories.js";

export const LIBRARY_LAND = 24105;
const CUT = 260;
const KEYS_OPEN = 11, MOUTH = 25;
const FRONT = 9;
const TRIES = 50;

export type LinkDock = { readonly local: Point; readonly links: readonly string[] };
export type Link = { readonly from: string; readonly to: string };

export const UNCLAIMED = "";
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const times = (p: Point, k: number): Point => ({ x: p.x * k, z: p.z * k });

export type Seeds = Readonly<Record<string, Point>>;

const laid = new WeakMap<readonly TerritoryShare[], { coast: Coast; key: string; kept: Seeds | undefined; map: TerritoryMap }>();

export function islandLayout(story: string, shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[] | undefined): TerritoryMap {
  return finished(islandLayoutSteps(story, shares, coast, links, docks));
}

export function* islandLayoutSteps(story: string, shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], docks: readonly LinkDock[] | undefined): Generator<void, TerritoryMap, void> {
  if (docks === undefined) return yield* islandTerritoriesInSteps(shares, coast);
  const kept = keptArrangement(story)?.seeds;
  const key = JSON.stringify([links, docks]), known = laid.get(shares);
  if (known?.coast === coast && known.key === key && known.kept === kept) return known.map;
  const map = yield* linkLayoutSteps(shares, coast, links, docks, kept);
  laid.set(shares, { coast, key, kept, map });
  return map;
}

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

export function openReach(n: number): number {
  return n <= 0 ? 0 : KEYS_OPEN + (MOUTH - KEYS_OPEN) * Math.min(1, Math.log(n) / Math.log(64));
}

export type PreparedIsland = {
  readonly coast: Coast; readonly scale: number; readonly fine: TerritoryMap; readonly ids: readonly string[];
  readonly open: readonly boolean[]; readonly main: readonly number[]; readonly frontier: readonly boolean[];
  readonly counts: readonly number[]; readonly least: number;
  readonly dockOf: ReadonlyMap<number, number>;
  readonly docks: readonly LinkDock[];
  readonly partners: (t: number) => number[];
};

export function prepareIsland(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], given: readonly LinkDock[]): PreparedIsland | undefined {
  return finished(prepareIslandSteps(shares, coast, links, given));
}

export function* prepareIslandSteps(shares: readonly TerritoryShare[], coast: Coast, links: readonly Link[], given: readonly LinkDock[]): Generator<void, PreparedIsland | undefined, void> {
  const scale = Math.sqrt(landArea(coast) / LIBRARY_LAND);
  if (!(scale > 0)) return undefined;
  const ground = coast.map((ring) => ring.map((p) => times(p, 1 / scale)));
  const fine = yield* territoriesInSteps(shares, ground, CUT);
  const docks = given.map((dock) => ({ local: ontoCoast(times(dock.local, 1 / scale), ground), links: dock.links }));
  const { cells, territories: held } = fine;
  const ids = held.map((t) => t.capability ?? UNCLAIMED), index = new Map(ids.map((id, at) => [id, at]));
  if (held.length < 2) return undefined;
  const here = (id: string) => id !== UNCLAIMED && index.has(id);
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
  const pieces = piecesOf(cells.map((_, c) => c).filter((c) => !open[c]), cells);
  if (pieces.length === 0) return undefined;
  const main = pieces.reduce((a, b) => (b.length > a.length ? b : a));
  for (const piece of pieces) if (piece !== main) for (const c of piece) open[c] = true;
  const owned = main.length;
  if (owned < held.length) return undefined;

  const least = Math.max(1, Math.min(Math.floor(owned / held.length), Math.round(MIN_SHARE * owned)));
  const counts = atLeast(apportion(held.map((t) => t.lines), owned), least);

  const toCoast = (p: Point) => Math.min(...ground.flatMap((ring) => ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length]!))));
  const frontier = cells.map((cell, c) => !open[c] && (cell.neighbours.some((n) => open[n]) || toCoast(cell.site) < FRONT));
  const dockOf = new Map<number, number>();
  lands.forEach((reached, k) => reached.forEach((n, t) => { const best = dockOf.get(t); if (best === undefined || n > lands[best]!.get(t)!) dockOf.set(t, k); }));
  const own = links.filter((l) => here(l.from) && here(l.to) && l.from !== l.to).map((l) => [index.get(l.from)!, index.get(l.to)!] as const);
  const partners = (t: number) => own.flatMap(([a, b]) => (a === t ? [b] : b === t ? [a] : []));
  return { coast, scale, fine, ids, open, main, frontier, counts, least, dockOf, docks, partners };
}

export function seedKind(island: PreparedIsland, t: number): boolean[] {
  if (island.dockOf.has(t)) return [...island.frontier];
  const held = new Set(island.main);
  return island.open.map((o, c) => !o && held.has(c));
}

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

export function settle(island: PreparedIsland, seeds: readonly number[]): { owners: number[]; seeds: readonly number[] } | undefined {
  return finished(settleSteps(island, seeds));
}

export function* settleSteps(island: PreparedIsland, seeds: readonly number[]): Generator<void, { owners: number[]; seeds: readonly number[] } | undefined, void> {
  const { fine: { cells }, ids, main } = island;
  let state = 43;
  const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  let tried = seeds;
  for (let attempt = 0; attempt <= TRIES; attempt++) {
    const grown = grow(tried, island.counts, island.least, island.open, cells);
    if (Array.isArray(grown)) return { owners: grown, seeds: tried };
    const next = [...tried], t = grown.short >= 0 && random() < 0.8 ? grown.short : Math.floor(random() * ids.length), taken = new Set(tried);
    const kind = seedKind(island, t);
    const near = (random() < 0.75 ? cells[tried[t]!]!.neighbours.filter((n) => kind[n]) : main.filter((c) => kind[c])).filter((c) => !taken.has(c));
    if (near.length) next[t] = near[Math.floor(random() * near.length)]!;
    tried = next;
    yield;
  }
  return undefined;
}

export function grownFrom(island: PreparedIsland, seeds: readonly number[]): number[] | undefined {
  const grown = grow(seeds, island.counts, island.least, island.open, island.fine.cells);
  return Array.isArray(grown) ? grown : undefined;
}

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

export function seedPoints(island: PreparedIsland, seeds: readonly number[]): Seeds {
  return Object.fromEntries(island.ids.map((id, t) => [id, island.fine.cells[seeds[t]!]!.site]));
}

function grow(seeds: readonly number[], counts: readonly number[], least: number, open: readonly boolean[], cells: readonly Cell[]): number[] | { short: number } {
  const N = cells.length, FREE = -2;
  const owner = cells.map((_, c): number => (open[c] ? -1 : FREE));
  const mine = counts.map(() => [] as number[]);
  for (const [t, c] of seeds.entries()) { if (owner[c] !== FREE) return { short: t }; owner[c] = t; mine[t]!.push(c); }
  let left = owner.filter((o) => o === FREE).length;
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
  for (let pass = 0; left > 0 && pass < N; pass++) for (let c = 0; c < N; c++) if (owner[c] === FREE) {
    const by = cells[c]!.neighbours.map((n) => owner[n]!).find((o) => o >= 0);
    if (by !== undefined) { owner[c] = by; left--; }
  }
  if (left > 0) return { short: -1 };
  balance(owner, seeds, counts, cells);
  const sizes = counts.map(() => 0);
  for (const o of owner) if (o >= 0) sizes[o]! += 1;
  const short = sizes.reduce((worst, n, t) => (n / counts[t]! < sizes[worst]! / counts[worst]! ? t : worst), 0);
  if (sizes.some((n, t) => n < least || Math.abs(n - counts[t]!) > Math.max(2, Math.round(counts[t]! / 10)))) return { short };
  if (counts.some((_, t) => !whole(owner, t, -1, cells))) return { short: -1 };
  return owner;
}

function balance(owner: number[], seeds: readonly number[], counts: readonly number[], cells: readonly Cell[]): void {
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

function whole(owner: readonly number[], t: number, without: number, cells: readonly Cell[]): boolean {
  let first = -1, size = 0;
  for (let c = 0; c < owner.length; c++) if (owner[c] === t && c !== without) { size++; if (first < 0) first = c; }
  if (first < 0) return false;
  const seen = new Set([first]), queue = [first];
  while (queue.length) { const c = queue.pop()!; for (const n of cells[c]!.neighbours) if (n !== without && owner[n] === t && !seen.has(n)) { seen.add(n); queue.push(n); } }
  return seen.size === size;
}

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

export function sharedEdge(a: Cell, b: Cell): [Point, Point] | undefined {
  const close = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-5 && Math.abs(p.z - q.z) < 1e-5;
  const common = a.polygon.filter((p) => b.polygon.some((q) => close(p, q)));
  return common.length >= 2 ? [common[0]!, common[common.length - 1]!] : undefined;
}

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
