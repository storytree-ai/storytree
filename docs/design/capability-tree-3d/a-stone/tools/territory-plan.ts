/** The mock's plan of the island, round 3: no three.js, no page, in the island's own flat coordinates (the plate's x and z).
 *
 * - THE MAP'S OWN CELLS AND SHARES. The island is cut by the map's own code (`territories()` in
 *   packages/forest/src/territories/territories.ts): the same near-equal cells on the same coast, and each capability given
 *   the same number of cells, so its area follows its lines exactly as the map's does. Only which cell goes to whom changes.
 * - SEEDS, GROWN. The map shares its cells out by halving the list of capabilities in order, so where a territory lands
 *   follows its place in the list, not what it calls. `territories()` takes no seeds, so the seeding is built here: each
 *   capability has a seed (a point on the island), and the regions grow from their seeds at once, each taking the free cell
 *   nearest its seed (weighed by its size), until it holds its share. Every region is one connected run of cells.
 *   The seeds are then moved, a step at a time, toward what each capability links to (`dependsOn`), keeping a move when more
 *   linked capabilities end up side by side, the shapes stay compact and every share is met.
 * - CORRIDORS, ONLY WHERE A PATH MUST PASS. A link between two territories that cannot touch gets a way along the borders
 *   between other territories, from a border of the one to a border of the other: the territories either side of each
 *   border it walks are pulled back from it, leaving a narrow strip of open ground, and the path runs down its middle. It
 *   never crosses a territory. Links that share a stretch share it (a stretch already opened costs less), as the story
 *   roads merge (packages/forest/src/view/border-route.ts walks only lines already drawn, as these walk only borders).
 * - GATES. A link between neighbours is a gate in their shared wall, on their longest stretch of it. A corridor's link has a
 *   gate at each end, in the wall the corridor runs beside. */
import type { TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";

export type P = { x: number; z: number };
/** One side of a cell: the stretch it shares with the cell `across` (-1 off the disc the cells were cut in). */
export type Side = { cell: number; across: number; from: P; to: P };
/** A gate: in the wall of `territory` on the side `side` (an index into `sides`), at `at` along it before any pull-back. */
export type Gate = { key: string; territory: number; side: number; at: P };
export type Way = { from: number; to: number; gates: [string, string]; points: P[]; sides: number[] };
export type Plan = {
  /** Each cell's territory, after the seeding. */
  owner: number[];
  seeds: P[];
  sides: Side[];
  /** The sides a corridor runs along: the territories both sides of each are pulled back from it. */
  corridor: Set<number>;
  /** How far each territory is pulled back from a corridor's middle line. */
  halfWidth: number;
  gates: Map<string, Gate>;
  /** A link between neighbours: its one gate. */
  neighbourGates: Map<string, string>;
  /** A link through a corridor: its way, gate to gate. */
  ways: Map<string, Way>;
  /** Roads off the coast: from a gate along a corridor to where it meets the coast. */
  roads: Map<string, { from: number; gate: string; points: P[]; coast: P; sides: number[] }>;
  /** Cell size: the side of a square of one cell's land. */
  unit: number;
  stats: Record<string, unknown>;
};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const key = (p: P) => `${Math.round(p.x * 1e4)},${Math.round(p.z * 1e4)}`;

/** A small fixed-seed random number source, so the plan is the same on every load. */
function random(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Each cell's sides, and which neighbour each is shared with: a side lies on the bisector between the two seeds. */
export function sidesOf(map: TerritoryMap): Side[] {
  const sides: Side[] = [];
  for (const cell of map.cells) {
    const poly = cell.polygon;
    for (let i = 0; i < poly.length; i++) {
      const from = poly[i]!, to = poly[(i + 1) % poly.length]!;
      if (dist(from, to) < 1e-9) continue;
      let across = -1;
      for (const n of cell.neighbours) {
        const s = map.cells[n]!.site, here = cell.site;
        // Both ends equally far from the two seeds, or both ends corners of the neighbour too (the cut's rounding).
        const off = (p: P) => Math.abs(dist(p, here) - dist(p, s)), corner = (p: P) => map.cells[n]!.polygon.some(q => dist(p, q) < 1e-5 * map.radius);
        if ((off(from) < 1e-5 * map.radius && off(to) < 1e-5 * map.radius) || (corner(from) && corner(to))) { across = n; break; }
      }
      sides.push({ cell: cell.index, across, from, to });
    }
  }
  return sides;
}

/** How many runs the seeding makes. */
const RUNS = 4;

type Links = readonly (readonly [number, number])[];

/** Grows every territory from its seed at once: each takes the free neighbouring cell nearest its seed, weighed by its
 * size, until it holds its share; a cell no territory could reach goes to the neighbour furthest short of its share. */
export function grow(map: TerritoryMap, counts: readonly number[], seeds: readonly P[]): number[] {
  const n = map.cells.length, owner = new Array<number>(n).fill(-1), size = counts.map(() => 0);
  const weight = counts.map(c => 1 / Math.sqrt(c));
  // A binary heap of [cost, territory, cell].
  const heap: [number, number, number][] = [];
  const push = (item: [number, number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
  const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
  const cost = (t: number, c: number) => dist(map.cells[c]!.site, seeds[t]!) * weight[t]!;
  // Each seed's own cell first, the largest territories choosing first.
  const order = counts.map((_, t) => t).sort((a, b) => counts[b]! - counts[a]! || a - b);
  for (const t of order) {
    let best = -1, far = Infinity;
    for (let c = 0; c < n; c++) if (owner[c] === -1) { const d = dist(map.cells[c]!.site, seeds[t]!); if (d < far) { far = d; best = c; } }
    owner[best] = t; size[t]++;
  }
  for (let c = 0; c < n; c++) if (owner[c]! >= 0) for (const m of map.cells[c]!.neighbours) if (owner[m] === -1) push([cost(owner[c]!, m), owner[c]!, m]);
  while (heap.length) {
    const [, t, c] = pop();
    if (owner[c] !== -1 || size[t]! >= counts[t]!) continue;
    owner[c] = t; size[t]++;
    for (const m of map.cells[c]!.neighbours) if (owner[m] === -1) push([cost(t, m), t, m]);
  }
  // Cells left over (walled in by full territories): each to the neighbouring territory furthest short of its share.
  for (let again = true; again;) {
    again = false;
    for (let c = 0; c < n; c++) {
      if (owner[c] !== -1) continue;
      const near = map.cells[c]!.neighbours.map(m => owner[m]!).filter(t => t >= 0);
      if (!near.length) { again = true; continue; }
      const t = near.sort((a, b) => size[a]! / counts[a]! - size[b]! / counts[b]!)[0]!;
      owner[c] = t; size[t]++;
    }
  }
  return owner;
}

/** Which territory pairs touch, along sides whose middle is on land. */
function touching(owner: readonly number[], sides: readonly Side[], onLand: (p: P) => boolean): Set<string> {
  const out = new Set<string>();
  for (const s of sides) if (s.across > s.cell && owner[s.cell] !== owner[s.across] && onLand(mid(s.from, s.to))) out.add(pairKey(owner[s.cell]!, owner[s.across]!));
  return out;
}
const pairKey = (a: number, b: number) => a < b ? `${a}|${b}` : `${b}|${a}`;

/** How good a cut is: linked territories side by side most, then compact shapes, then the shares met, then linked
 * territories that do not touch kept near. */
function score(map: TerritoryMap, counts: readonly number[], owner: readonly number[], links: Links, sides: readonly Side[], onLand: (p: P) => boolean, unit: number, reach: Reach, shore: ReadonlyMap<number, P>) {
  const touch = touching(owner, sides, onLand);
  const joined = reach(owner);
  const T = counts.length, sx = new Array(T).fill(0), sz = new Array(T).fill(0), size = new Array(T).fill(0), m2 = new Array(T).fill(0);
  owner.forEach((t, c) => { const s = map.cells[c]!.site; sx[t] += s.x; sz[t] += s.z; size[t]++; });
  const centre = sx.map((x, t) => ({ x: x / Math.max(1, size[t]), z: sz[t] / Math.max(1, size[t]) }));
  owner.forEach((t, c) => { m2[t] += dist(map.cells[c]!.site, centre[t]!) ** 2; });
  let compact = 0, short = 0, apart = 0, adjacent = 0;
  for (let t = 0; t < T; t++) { compact += m2[t] / (Math.max(1, size[t]) ** 2 * unit * unit); short += Math.abs(size[t] - counts[t]!); }
  // A territory whose road leaves the island is kept near the coast that faces where the road heads.
  for (const [t, at] of shore) apart += dist(centre[t]!, at) / unit;
  let cut = 0;
  for (const [a, b] of links) { if (touch.has(pairKey(a, b))) adjacent++; else { apart += dist(centre[a]!, centre[b]!) / unit; if (!joined(a, b)) cut++; } }
  return { value: 12 * adjacent - 3 * compact - 20 * short - 0.6 * apart - 40 * cut, adjacent, compact, short, apart, cut };
}

/** Whether two territories' borders join up along the border network: a corridor between them can only run along it. */
type Reach = (owner: readonly number[]) => (a: number, b: number) => boolean;
function reachOf(sides: readonly Side[], onLand: (p: P) => boolean): Reach {
  const ids = new Map<string, number>(), id = (p: P) => { const k = key(p); let i = ids.get(k); if (i === undefined) ids.set(k, i = ids.size); return i; };
  const usable = sides.map((s, i) => ({ i, s, a: id(s.from), b: id(s.to) })).filter(({ s }) => s.across > s.cell && onLand(mid(s.from, s.to)));
  return owner => {
    const up = Array.from({ length: ids.size }, (_, i) => i), root = (i: number): number => up[i] === i ? i : (up[i] = root(up[i]!));
    const on = new Map<number, number[]>();
    for (const { s, a, b } of usable) {
      const ta = owner[s.cell]!, tb = owner[s.across]!;
      if (ta === tb) continue;
      up[root(a)] = root(b);
      for (const t of [ta, tb]) on.set(t, [...(on.get(t) ?? []), a]);
    }
    return (x, y) => { const ys = new Set((on.get(y) ?? []).map(root)); return (on.get(x) ?? []).some(n => ys.has(root(n))); };
  };
}

export type Seeding = { seeds?: readonly P[]; runs?: number; iterations?: number };

export function plan(map: TerritoryMap, links: Links, onLand: (p: P) => boolean, offLand: { toward: (from: number) => P | undefined } = { toward: () => undefined },
  { seeds: given, runs = RUNS, iterations = 2000 }: Seeding = {}): Plan {
  const T = map.territories.length;
  const counts = map.territories.map((_, t) => map.cells.filter(c => c.territory === t).length);
  const sides = sidesOf(map);
  const unit = Math.sqrt(cellLand(map, onLand) / map.cells.length);
  const sites = map.cells.map(c => c.site);
  const nearestSite = (p: P) => sites.reduce((best, s) => dist(s, p) < dist(best, p) ? s : best);
  const reach = reachOf(sides, onLand);
  // Where each road off the coast leaves: the coast straight out from the island's middle toward where it heads.
  const shore = new Map<number, P>();
  for (let t = 0; t < T; t++) {
    const toward = offLand.toward(t);
    if (!toward) continue;
    const l = Math.hypot(toward.x, toward.z), out = { x: toward.x / l * map.radius * 1.2, z: toward.z / l * map.radius * 1.2 };
    shore.set(t, coastPoint({ x: 0, z: 0 }, out, onLand));
  }
  // Seeds start where the map's own cut puts each territory; a few runs from there, each its own fixed sequence of moves, and
  // the best cut any of them found is kept.
  const start: P[] = map.territories.map((_, t) => {
    const cells = map.cells.filter(c => c.territory === t);
    return { x: cells.reduce((s, c) => s + c.site.x, 0) / cells.length, z: cells.reduce((s, c) => s + c.site.z, 0) / cells.length };
  });
  let seeds = given ? [...given] : start, owner = grow(map, counts, seeds), now = score(map, counts, owner, links, sides, onLand, unit, reach, shore);
  let best = { seeds, owner, now };
  // Seeds already found (data.json's, by tools/seed.mjs) are grown as they are.
  for (let run = 0; run < (given ? 0 : runs); run++) {
    const rand = random(20261102 + run);
    seeds = start; owner = grow(map, counts, seeds); now = score(map, counts, owner, links, sides, onLand, unit, reach, shore);
    for (let k = 0; k < iterations; k++) {
      const heat = 2.5 * (1 - k / iterations);
      const t = Math.floor(rand() * T), trial = [...seeds];
      const partners = links.filter(([a, b]) => a === t || b === t).map(([a, b]) => a === t ? b : a);
      const r = rand();
      if (r < 0.45 && partners.length) {
        // Toward one of what it links to.
        const o = seeds[partners[Math.floor(rand() * partners.length)]!]!, f = 0.2 + rand() * 0.6;
        trial[t] = nearestSite({ x: seeds[t]!.x + (o.x - seeds[t]!.x) * f, z: seeds[t]!.z + (o.z - seeds[t]!.z) * f });
      } else if (r < 0.7) {
        // Change places with another seed.
        const u = Math.floor(rand() * T); trial[t] = seeds[u]!; trial[u] = seeds[t]!;
      } else {
        const a = rand() * Math.PI * 2, d = unit * (0.5 + rand() * 2.5);
        trial[t] = nearestSite({ x: seeds[t]!.x + Math.cos(a) * d, z: seeds[t]!.z + Math.sin(a) * d });
      }
      const grown = grow(map, counts, trial), next = score(map, counts, grown, links, sides, onLand, unit, reach, shore);
      if (next.value >= now.value || rand() < Math.exp((next.value - now.value) / Math.max(1e-6, heat))) {
        seeds = trial; owner = grown; now = next;
        if (now.value > best.now.value) best = { seeds, owner, now };
      }
    }
  }
  ({ seeds, owner, now } = best);

  // The border network: every side between two territories, as a graph of its ends and its middle, the middle splitting it
  // in two halves, so a way can start and end in the middle of a side, where its gate is.
  const nodes: P[] = [], index = new Map<string, number>();
  const node = (p: P) => { const k = key(p); let i = index.get(k); if (i === undefined) { index.set(k, i = nodes.length); nodes.push(p); } return i; };
  type Half = { a: number; b: number; side: number; length: number };
  const halves: Half[] = [];
  const linked = new Set(links.map(([a, b]) => pairKey(a, b)));
  const border = new Map<number, { m: number; ends: [number, number]; between: [number, number] }>();
  // Each shared side is listed twice, once from each cell: the plan keeps the one from the lower cell.
  const sideOf = new Map<string, number>();
  sides.forEach((s, i) => { if (s.across >= 0) sideOf.set(`${s.cell}>${s.across}`, i); });
  sides.forEach((s, i) => {
    if (s.across < s.cell) return;
    const ta = owner[s.cell]!, tb = owner[s.across]!;
    if (ta === tb) return;
    const inA = onLand(s.from), inB = onLand(s.to);
    if (!inA && !inB) return;
    const [from, to] = [inA ? s.from : coastPoint(s.to, s.from, onLand), inB ? s.to : coastPoint(s.from, s.to, onLand)];
    const m = node(mid(from, to)), a = node(from), b = node(to);
    border.set(i, { m, ends: [a, b], between: [ta, tb] });
    for (const end of [a, b]) halves.push({ a: m, b: end, side: i, length: dist(nodes[m]!, nodes[end]!) });
  });
  // A coast end: a side's end where it meets the coast.
  const coastEnds = new Set<number>();
  border.forEach((b, i) => { const s = sides[i]!; if (!onLand(s.from)) coastEnds.add(b.ends[0]); if (!onLand(s.to)) coastEnds.add(b.ends[1]); });
  const out = nodes.map(() => [] as number[]);
  halves.forEach((h, i) => { out[h.a]!.push(i); out[h.b]!.push(i); });
  const used = new Set<number>();
  /** The cheapest way from any of `starts` to any of `ends`, walking only borders, where a territory pair that is linked and
   * touching costs more to part (opening a corridor between them would part them). */
  const walk = (starts: number[], ends: Set<number>, extra: (n: number) => number = () => 0) => {
    const d = new Map<number, number>(), back = new Map<number, number>(), done = new Set<number>();
    for (const s of starts) d.set(s, 0);
    let last = -1;
    while (true) {
      let here = -1, low = Infinity;
      for (const [n, v] of d) if (!done.has(n) && v + extra(n) < low) { low = v + extra(n); here = n; }
      if (here < 0) break;
      if (ends.has(here)) { last = here; break; }
      done.add(here);
      for (const i of out[here]!) {
        const h = halves[i]!, there = h.a === here ? h.b : h.a;
        const [ta, tb] = border.get(h.side)!.between;
        const parts = linked.has(pairKey(ta, tb)) ? 25 : 1;
        const v = d.get(here)! + h.length * parts * (used.has(i) ? 0.45 : 1);
        if (v < (d.get(there) ?? Infinity)) { d.set(there, v); back.set(there, i); }
      }
    }
    if (last < 0) return undefined;
    const pts: number[] = [last], hs: number[] = [];
    for (let n = last; back.has(n);) { const i = back.get(n)!; hs.unshift(i); n = halves[i]!.a === n ? halves[i]!.b : halves[i]!.a; pts.unshift(n); }
    return { nodes: pts, halves: hs };
  };
  const middlesOf = (t: number) => [...border.values()].filter(b => b.between.includes(t)).map(b => b.m);

  const touch = touching(owner, sides, onLand);
  const apart = links.filter(([a, b]) => !touch.has(pairKey(a, b)));
  const gates = new Map<string, Gate>(), neighbourGates = new Map<string, string>(), ways = new Map<string, Way>();
  const corridor = new Set<number>();
  const halfWidth = unit * 0.1;
  const sideByMiddle = new Map([...border].map(([i, b]) => [b.m, i]));
  const gateOn = (territory: number, side: number, at?: P): string => {
    const k = `${territory}@${side}`, b = border.get(side)!;
    if (!gates.has(k)) gates.set(k, { key: k, territory, side, at: at ?? nodes[b.m]! });
    return k;
  };
  /** A way starts in the middle of a border and opens all of it, so its gate stands near the border's far end, where the
   * corridor stops, and the way walks the border from there: no stretch of corridor runs on past a gate. */
  const KEEP = unit * 0.24;
  const ends = (found: { nodes: number[] }) => {
    const pts = found.nodes.map(n => nodes[n]!), out = [...pts];
    const far = (m: P, e: P) => { const back = { x: 2 * m.x - e.x, z: 2 * m.z - e.z }, l = dist(back, e); return { x: back.x + (e.x - back.x) * Math.min(0.5, KEEP / l), z: back.z + (e.z - back.z) * Math.min(0.5, KEEP / l) }; };
    if (pts.length > 1) out[0] = far(pts[0]!, pts[1]!);
    return { pts: out, last: (p2: P[]) => { if (p2.length > 1) p2[p2.length - 1] = far(p2.at(-1)!, p2.at(-2)!); return p2; } };
  };
  // The furthest apart first, so the nearer ones join the ways they open.
  const centre = (t: number) => { const cs = owner.map((o, c) => o === t ? map.cells[c]!.site : undefined).filter((s): s is P => !!s); return { x: cs.reduce((s, p) => s + p.x, 0) / cs.length, z: cs.reduce((s, p) => s + p.z, 0) / cs.length }; };
  for (const [a, b] of [...apart].sort((p, q) => dist(centre(q[0]), centre(q[1])) - dist(centre(p[0]), centre(p[1])))) {
    const found = walk(middlesOf(a), new Set(middlesOf(b)));
    if (!found) continue;
    found.halves.forEach(i => { used.add(i); corridor.add(halves[i]!.side); });
    const first = sideByMiddle.get(found.nodes[0]!)!, last = sideByMiddle.get(found.nodes.at(-1)!)!;
    const { pts, last: trim } = ends(found), points = trim(pts);
    ways.set(`${a}->${b}`, { from: a, to: b, gates: [gateOn(a, first, points[0]), gateOn(b, last, points.at(-1))], points, sides: [...new Set(found.halves.map(i => halves[i]!.side))] });
  }
  // Roads off the coast: from a border of the territory to the coast nearest where the road heads.
  const roads: Plan["roads"] = new Map();
  for (let t = 0; t < T; t++) {
    const toward = offLand.toward(t);
    if (!toward) continue;
    const c = centre(t), dir = { x: toward.x - c.x, z: toward.z - c.z }, l = Math.hypot(dir.x, dir.z);
    // A coast end facing away from where the road heads costs more.
    const facing = (n: number) => coastEnds.has(n) ? unit * 4 * (1 - ((nodes[n]!.x - c.x) * dir.x + (nodes[n]!.z - c.z) * dir.z) / (l * Math.max(1e-6, dist(nodes[n]!, c)))) : 0;
    // Only a coast end that looks straight out on open sea, away from the island's middle, as the road leaves it: one at the
    // back of a bay would run the road off its end across the land beyond.
    const open = (n: number) => { const q = nodes[n]!, d = q, k = Math.hypot(d.x, d.z) || 1;
      for (let i = 1; i <= 12; i++) if (onLand({ x: q.x + d.x / k * unit * 0.1 * i, z: q.z + d.z / k * unit * 0.1 * i })) return false;
      return true; };
    const seaward = new Set([...coastEnds].filter(open));
    const found = walk(middlesOf(t), seaward.size ? seaward : coastEnds, facing);
    if (!found) continue;
    found.halves.forEach(i => { used.add(i); corridor.add(halves[i]!.side); });
    const first = sideByMiddle.get(found.nodes[0]!)!, { pts } = ends(found);
    roads.set(`${t}`, { from: t, gate: gateOn(t, first, pts[0]), points: pts, coast: nodes[found.nodes.at(-1)!]!, sides: [...new Set(found.halves.map(i => halves[i]!.side))] });
  }
  // Neighbours: one gate in their shared wall, on the longest side they share that no corridor runs along.
  for (const [a, b] of links) {
    if (!touch.has(pairKey(a, b))) continue;
    const shared = [...border].filter(([i, x]) => !corridor.has(i) && x.between.includes(a) && x.between.includes(b));
    if (!shared.length) {
      // Every side they shared became a corridor: the link crosses it, gate to gate.
      const any = [...border].filter(([, x]) => x.between.includes(a) && x.between.includes(b)).sort(([i], [j]) => len(sides[j]!) - len(sides[i]!))[0];
      if (!any) continue;
      ways.set(`${a}->${b}`, { from: a, to: b, gates: [gateOn(a, any[0]), gateOn(b, any[0])], points: [nodes[any[1].m]!], sides: [any[0]] });
      continue;
    }
    const [i] = shared.sort(([i], [j]) => len(sides[j]!) - len(sides[i]!))[0]!;
    const k = `${pairKey(a, b)}@${i}`;
    gates.set(k, { key: k, territory: -1, side: i, at: nodes[border.get(i)!.m]! });
    neighbourGates.set(`${a}->${b}`, k);
  }
  const stats = { cells: map.cells.length, territories: T, links: links.length, adjacent: now.adjacent, corridorLinks: ways.size, roads: roads.size,
    corridorSides: corridor.size, cut: now.cut, compact: Math.round(now.compact * 100) / 100, short: now.short, unit: Math.round(unit * 100) / 100 };
  return { owner, seeds, sides, corridor, halfWidth, gates, neighbourGates, ways, roads, unit, stats };
}

const len = (s: Side) => dist(s.from, s.to);
/** The land the cells cover, by sampling. */
function cellLand(map: TerritoryMap, onLand: (p: P) => boolean) {
  let on = 0, all = 0; const R = map.radius;
  for (let x = -R; x <= R; x += R / 60) for (let z = -R; z <= R; z += R / 60) { all++; if (onLand({ x, z })) on++; }
  return (on / all) * (2 * R) * (2 * R);
}
/** Where the segment from `inside` (on land) to `outside` meets the coast. */
export function coastPoint(inside: P, outside: P, onLand: (p: P) => boolean): P {
  let lo = 0, hi = 1;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (onLand({ x: inside.x + (outside.x - inside.x) * m, z: inside.z + (outside.z - inside.z) * m })) lo = m; else hi = m; }
  return { x: inside.x + (outside.x - inside.x) * lo, z: inside.z + (outside.z - inside.z) * lo };
}
