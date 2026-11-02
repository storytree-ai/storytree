/** Round 5's plan of the island, with no three.js and no page: the map's own territories, the roads between them, and a gate
 * for each link, a gap in the called territory's border. Plain geometry on the island's ground (x, z), so castle.ts only has
 * to draw it.
 * - The land as a grid: each point's territory is the one its nearest cell site gives (the map's own Voronoi cut), on the coast.
 * - Each territory's deepest point (by a distance transform), where its name stands.
 * - Roads: only along the lines the map already draws, the borders between territories and the coast between two borders, as
 *   packages/forest/src/view/border-route.ts routes a lit link inland, so a road never crosses a third territory. A link is
 *   one road; a stretch already walked costs less, so roads merge.
 * - Gates: a gap in the called territory's border near where its road first meets it, the road running through and a short
 *   way in. */
import { onLand, type Point as P, type TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { insideOf } from "../../../../../packages/forest/src/view/territory-land.js";

export type { P };
export type Town = {
  id: string; index: number;
  /** The territory's deepest point and how far it is from the territory's edge. */
  deep: P; depth: number; area: number;
};
/** A gate: a gap in the called territory's dashed border at `at`, `along` the border there, `out` its outward side; the road
 * reaches it at node `spurTo` and runs on in to `inner`. */
export type Gate = { key: string; town: string; at: P; along: P; out: P; links: string[]; spurTo: number; inner: P };
export type LinkEnd = { kind: "town"; id: string } | { kind: "dock"; dock: number };
export type Link = { key: string; from: LinkEnd; to: LinkEnd; gate?: string; nodes: number[]; edges: number[]; endSpur?: [P, P] };
export type Dock = { at: P; node: number };

const far = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
export const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const COAST_COST = 3;
const REUSE = 0.5;

/** Squared Euclidean distance transform (Felzenszwalb and Huttenlocher), in cells: each cell's distance to the nearest cell
 * where `zero` is true. */
function edt(zero: (i: number) => boolean, w: number, h: number): Float64Array {
  const INF = 1e20, d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = zero(i) ? 0 : INF;
  const n = Math.max(w, h), f = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1]! < q) k++; out[q] = (q - v[k]!) ** 2 + f[v[k]!]!; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = d[y * w + x]!; pass(h); for (let y = 0; y < h; y++) d[y * w + x] = out[y]!; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = d[y * w + x]!; pass(w); for (let x = 0; x < w; x++) d[y * w + x] = out[x]!; }
  return d;
}

/** A binary min-heap of states by cost. */
class Heap {
  items: { s: number; c: number }[] = [];
  push(s: number, c: number) { const a = this.items; a.push({ s, c }); for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p]!.c <= a[i]!.c) break; [a[p], a[i]] = [a[i]!, a[p]!]; i = p; } }
  pop() {
    const a = this.items, top = a[0]; if (!top) return undefined; const last = a.pop()!;
    if (a.length) { a[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l]!.c < a[m]!.c) m = l; if (r < a.length && a[r]!.c < a[m]!.c) m = r; if (m === i) break; [a[m], a[i]] = [a[i]!, a[m]!]; i = m; } }
    return top;
  }
}

/** The nearest point to `p` on the closed loop `ring`, with how far round the loop it lies. */
export function onRing(p: P, ring: P[]): { at: P; s: number; run: number; distance: number } {
  let best = { at: ring[0]!, s: 0, run: 0, distance: Infinity }, walked = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!, l = far(a, b), t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (l * l))) : 0;
    const q = along(a, b, t), dd = far(p, q);
    if (dd < best.distance) best = { at: q, s: walked + t * l, run: i, distance: dd };
    walked += l;
  });
  return best;
}
export type Plan = ReturnType<typeof townPlan>;

/** The plan: towns, the line graph, docks, gates and every link's road. `links` names every link once, by its two ends; a
 * link from another island arrives at `dock` (an index into `docks`), one to another island leaves by it. */
export function townPlan(map: TerritoryMap, coast: readonly (readonly P[])[], opts: {
  inset: number; gap: number; cell?: number;
  links: { key: string; from: LinkEnd; to: LinkEnd; gateGroup?: string }[]; docks: P[];
}) {
  const D = opts.inset;
  // The grid.
  const reach = Math.max(...coast.flat().map(p => Math.max(Math.abs(p.x), Math.abs(p.z)))) * 1.02;
  const cell = opts.cell ?? D / 7, N = Math.ceil(reach * 2 / cell), x0 = -reach, z0 = -reach;
  const centre = (i: number, j: number): P => ({ x: x0 + (i + 0.5) * cell, z: z0 + (j + 0.5) * cell });
  const label = new Int16Array(N * N).fill(-1);
  const sites = map.cells;
  for (let j = 0; j < N; j++) {
    // The coast's crossings of this row, so each point's on-land test is a lookup.
    const z = z0 + (j + 0.5) * cell, xs: number[] = [];
    for (const ring of coast) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const p = ring[a]!, q = ring[b]!;
      if ((p.z > z) !== (q.z > z)) xs.push((q.x - p.x) * (z - p.z) / (q.z - p.z) + p.x);
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < N; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (xs.filter(c => c < x).length % 2 === 0) continue;
      let best = Infinity, owner = -1;
      for (const c of sites) { const dd = (c.site.x - x) ** 2 + (c.site.z - z) ** 2; if (dd < best) { best = dd; owner = c.territory; } }
      label[j * N + i] = owner;
    }
  }
  const territoryAt = (p: P) => { const i = Math.floor((p.x - x0) / cell), j = Math.floor((p.z - z0) / cell); return i >= 0 && j >= 0 && i < N && j < N ? label[j * N + i]! : -1; };

  // Territories: each one's deepest point (where its name stands) and how deep it is. No walls in round 5.
  const towns = new Map<string, Town>();
  map.territories.forEach((t, index) => {
    if (!t.capability) return;
    let i0 = N, i1 = 0, j0 = N, j1 = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (label[j * N + i] === index) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    if (i0 > i1) return;
    i0 -= 2; j0 -= 2; i1 += 2; j1 += 2;
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const mine = (k: number) => { const i = i0 + (k % w), j = j0 + Math.floor(k / w); return i >= 0 && j >= 0 && i < N && j < N && label[j * N + i] === index; };
    const dist = edt(k => !mine(k), w, h);
    let deepest = 0, deepAt = 0, count = 0;
    for (let k = 0; k < w * h; k++) { if (mine(k)) count++; if (dist[k]! > deepest) { deepest = dist[k]!; deepAt = k; } }
    const depth = Math.sqrt(deepest) * cell, deep = centre(i0 + (deepAt % w), j0 + Math.floor(deepAt / w));
    towns.set(t.capability, { id: t.capability, index, deep, depth, area: count * cell * cell });
  });

  // The line graph: the borders as drawn, cut to the coast, and the coast cut at every border's end and every dock.
  const nodes: P[] = [], index = new Map<string, number>();
  const key = (p: P) => `${Math.round(p.x * 1e5)},${Math.round(p.z * 1e5)}`;
  const node = (p: P) => { const k = key(p); let i = index.get(k); if (i === undefined) { index.set(k, i = nodes.length); nodes.push(p); } return i; };
  type Edge = { a: number; b: number; length: number; cost: number; parts: number[]; coast: boolean; dead?: boolean };
  const edges: Edge[] = [];
  const addEdge = (a: number, b: number, parts: number[], coastal: boolean) => {
    if (a === b) return;
    const length = far(nodes[a]!, nodes[b]!);
    edges.push({ a, b, length, cost: length * (coastal ? COAST_COST : 1), parts, coast: coastal });
  };
  const ends: number[] = [];
  for (const border of map.borders) {
    const parts = border.between.map(c => map.cells[c]!.territory);
    for (const piece of insideOf(border.from, border.to, coast)) { const a = node(piece.from), b = node(piece.to); addEdge(a, b, parts, false); ends.push(a, b); }
  }
  const docks: Dock[] = [];
  for (const loop of coast) {
    const stops: { at: number; along: number }[] = [];
    let walked = 0;
    loop.forEach((a, i) => { stops.push({ at: node(a), along: walked }); walked += far(a, loop[(i + 1) % loop.length]!); });
    const place = (p: P) => onRing(p, loop as P[]);
    for (const end of new Set(ends)) { const q = place(nodes[end]!); if (q.distance < 1e-6) stops.push({ at: end, along: q.s }); }
    for (const dock of opts.docks) { const q = place(dock); const n = node(q.at); docks.push({ at: q.at, node: n }); stops.push({ at: n, along: q.s }); }
    stops.sort((a, b) => a.along - b.along);
    stops.forEach(({ at }, i) => {
      const next = stops[(i + 1) % stops.length]!.at;
      const mid = along(nodes[at]!, nodes[next]!, 0.5), inward = along(mid, { x: 0, z: 0 }, 0.02);
      addEdge(at, next, [territoryAt(inward)], true);
    });
  }
  const out = () => { const o = nodes.map(() => [] as number[]); edges.forEach((e, i) => { if (!e.dead) { o[e.a]!.push(i); o[e.b]!.push(i); } }); return o; };
  const touching = (n: number, o: number[][]) => new Set(o[n]!.flatMap(i => edges[i]!.parts));

  const used = new Set<number>();
  /** The cheapest way from any source to any target, each with its own start or finish cost. */
  const route = (sources: Map<number, number>, targets: Map<number, number>) => {
    const o = out(), cost = new Map<number, number>(), back = new Map<number, number>(), heap = new Heap();
    for (const [n, c] of sources) { cost.set(n, c); back.set(n, -1); heap.push(n, c); }
    let best = Infinity, end = -1;
    for (let top = heap.pop(); top; top = heap.pop()) {
      if (top.c > cost.get(top.s)!) continue;
      if (top.c >= best) break;
      const finish = targets.get(top.s);
      if (finish !== undefined && top.c + finish < best) { best = top.c + finish; end = top.s; }
      for (const i of o[top.s]!) {
        const e = edges[i]!, there = e.a === top.s ? e.b : e.a, c = top.c + e.cost * (used.has(i) ? REUSE : 1);
        if (c < (cost.get(there) ?? Infinity)) { cost.set(there, c); back.set(there, i); heap.push(there, c); }
      }
    }
    if (end < 0) return undefined;
    const way: number[] = [], walk = [end];
    for (let n = end; back.get(n)! >= 0;) { const i = back.get(n)!; way.unshift(i); n = edges[i]!.a === n ? edges[i]!.b : edges[i]!.a; walk.unshift(n); }
    return { nodes: walk, edges: way };
  };
  /** The nodes on a territory's edge: a road reaches it there. */
  const sidesOf = (town: Town, o: number[][]) => {
    const m = new Map<number, number>();
    nodes.forEach((_, n) => { if (o[n]!.length && touching(n, o).has(town.index)) m.set(n, 0); });
    return m;
  };
  const endOf = (end: LinkEnd, o: number[][]) => end.kind === "dock" ? new Map([[docks[end.dock]!.node, 0]]) : sidesOf(towns.get(end.id)!, o);

  // First, each link's way to the called end, to learn where it first meets the called territory's edge.
  const o1 = out();
  const arrive = new Map<string, number>();
  const sorted = [...opts.links].map(l => ({ l, way: route(endOf(l.from, o1), endOf(l.to, o1)) }))
    .sort((a, b) => (b.way?.edges.length ?? 0) - (a.way?.edges.length ?? 0));
  for (const { l, way } of sorted) if (way && l.to.kind === "town") arrive.set(l.key, way.nodes.at(-1)!);

  // Then the gates: one per link into a territory (or per group: the links one road brings from other islands), each a gap
  // in the territory's own dashed border, as near along that border as it can stand to where the road first meets it, and
  // kept a gap's room from every other gate. The coast is never opened, unless a territory has no border at all.
  const gates = new Map<string, Gate>();
  const byTown = new Map<string, { key: string; links: string[]; arrive: number }[]>();
  for (const l of opts.links) {
    if (l.to.kind !== "town" || !arrive.has(l.key)) continue;
    const town = towns.get(l.to.id)!, gk = l.gateGroup ?? l.key, list = byTown.get(town.id) ?? [];
    const known = list.find(g => g.key === gk);
    if (known) known.links.push(l.key);
    else list.push({ key: gk, links: [l.key], arrive: arrive.get(l.key)! });
    byTown.set(town.id, list);
  }
  const G = opts.gap, inside = (p: P, index: number) => territoryAt(p) === index;
  /** The inward side of a run from a to b, for territory `index` (+1 left of the run, -1 right, 0 neither). */
  const inwardOf = (a: P, b: P, index: number) => {
    const l = far(a, b) || 1, nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l, m = along(a, b, 0.5), r = Math.min(G * 0.3, l * 0.3);
    return inside({ x: m.x + nx * r, z: m.z + nz * r }, index) ? { x: nx, z: nz } : inside({ x: m.x - nx * r, z: m.z - nz * r }, index) ? { x: -nx, z: -nz } : undefined;
  };
  /** Splits edge i at t along it, and gives the node there. */
  const split = (i: number, t: number) => {
    const e = edges[i]!, n = node(along(nodes[e.a]!, nodes[e.b]!, t));
    if (n !== e.a && n !== e.b) { e.dead = true; addEdge(e.a, n, e.parts, e.coast); addEdge(n, e.b, e.parts, e.coast); }
    return n;
  };
  for (const [id, list] of byTown) {
    const town = towns.get(id)!, placed: P[] = [];
    for (const g of list.sort((a, b) => b.links.length - a.links.length)) {
      const o = out();
      let mineEdges = edges.map((_, i) => i).filter(i => !edges[i]!.dead && !edges[i]!.coast && edges[i]!.parts.includes(town.index));
      if (!mineEdges.length) mineEdges = edges.map((_, i) => i).filter(i => !edges[i]!.dead && edges[i]!.parts.includes(town.index));
      // How far along the territory's edge each node is from where the road first meets it.
      const far0 = new Map<number, number>([[g.arrive, 0]]), heap = new Heap(); heap.push(g.arrive, 0);
      for (let top = heap.pop(); top; top = heap.pop()) {
        if (top.c > far0.get(top.s)!) continue;
        for (const i of o[top.s]!) {
          if (!mineEdges.includes(i)) continue;
          const e = edges[i]!, there = e.a === top.s ? e.b : e.a, c = top.c + e.length;
          if (c < (far0.get(there) ?? Infinity)) { far0.set(there, c); heap.push(there, c); }
        }
      }
      const reach = (n: number, p: P) => far0.get(n) ?? far(nodes[g.arrive]!, p) + 1e3;
      // Candidates: points along each border run, a gap's half and a little from its ends, and the corners where only the
      // territory's own borders meet.
      type Spot = { at: P; along: P; in: P; edge?: number; t?: number; node?: number; cost: number };
      const spots: Spot[] = [];
      for (const i of mineEdges) {
        const e = edges[i]!, a = nodes[e.a]!, b = nodes[e.b]!, inward = inwardOf(a, b, town.index);
        if (!inward) continue;
        const dir = { x: (b.x - a.x) / (e.length || 1), z: (b.z - a.z) / (e.length || 1) }, m = G * 0.6;
        const steps = e.length < 2 * m ? (e.length >= G * 1.05 ? [e.length / 2] : []) : Array.from({ length: Math.floor((e.length - 2 * m) / 0.3) + 1 }, (_, k) => m + k * 0.3);
        for (const u of steps) {
          const at = along(a, b, u / e.length);
          spots.push({ at, along: dir, in: inward, edge: i, t: u / e.length, cost: Math.min(reach(e.a, at) + u, reach(e.b, at) + e.length - u) });
        }
      }
      for (const [n] of far0) {
        const mine = o[n]!.filter(i => mineEdges.includes(i));
        if (mine.length !== 2 || o[n]!.some(i => edges[i]!.coast)) continue;
        const ins = mine.map(i => { const e = edges[i]!; return inwardOf(nodes[e.a]!, nodes[e.b]!, town.index); });
        if (ins.some(v => !v)) continue;
        const v = { x: ins[0]!.x + ins[1]!.x, z: ins[0]!.z + ins[1]!.z }, l = Math.hypot(v.x, v.z);
        if (l < 0.6) continue;
        const inward = { x: v.x / l, z: v.z / l };
        spots.push({ at: nodes[n]!, along: { x: inward.z, z: -inward.x }, in: inward, node: n, cost: reach(n, nodes[n]!) });
      }
      const room = (k: number) => G * (k === 0 ? 1.7 : 1.25);
      let best: Spot | undefined;
      for (let k = 0; k < 2 && !best; k++) best = spots.filter(s => placed.every(p => far(p, s.at) >= room(k))).sort((a, b) => a.cost - b.cost)[0];
      best ??= spots.sort((a, b) => a.cost - b.cost)[0];
      if (!best) continue;
      const n = best.node ?? split(best.edge!, best.t!);
      placed.push(best.at);
      // The road runs on through the gap and a short way in, stopping short of leaving the territory.
      let reachIn = G * 1.15;
      while (reachIn > G * 0.3 && ![0.35, 0.7, 1].every(f => inside({ x: best.at.x + best.in.x * reachIn * f, z: best.at.z + best.in.z * reachIn * f }, town.index))) reachIn *= 0.8;
      const inner = { x: best.at.x + best.in.x * reachIn, z: best.at.z + best.in.z * reachIn };
      gates.set(g.key, { key: g.key, town: id, at: best.at, along: best.along, out: { x: -best.in.x, z: -best.in.z }, links: g.links, spurTo: n, inner });
    }
  }

  // Last, every link's road, the longest first so the shorter ones join the ways they lay. A road starts on its caller's edge
  // and ends through its gate.
  const o2 = out();
  const links: Link[] = [];
  for (const { l } of sorted) {
    const gate = l.to.kind === "town" ? [...gates.values()].find(g => g.links.includes(l.key)) : undefined;
    const targets = gate ? new Map([[gate.spurTo, 0]]) : endOf(l.to, o2);
    const way = route(endOf(l.from, o2), targets);
    if (!way) continue;
    way.edges.forEach(i => used.add(i));
    const last = nodes[way.nodes.at(-1)!]!;
    const endSpur: [P, P] | undefined = gate ? [last, gate.inner] : undefined;
    links.push({ key: l.key, from: l.from, to: l.to, ...(gate ? { gate: gate.key } : {}), nodes: way.nodes, edges: way.edges, ...(endSpur ? { endSpur } : {}) });
  }
  return { towns, nodes, edges, docks, gates, links, territoryAt, cell, N };
}

export { onLand };
