/** Round 4's plan of the island, with no three.js and no page: the map's own territories, a walled town inset in each, and the
 * roads between them. Plain geometry on the island's ground (x, z), so castle.ts only has to draw it.
 * - The land as a grid: each point's territory is the one its nearest cell site gives (the map's own Voronoi cut), on the coast.
 * - A town: the territory pulled in by INSET on every side (its distance to the territory's edge, by a distance transform), its
 *   narrow necks opened off, then its outline simplified to a few long straight runs, a tower at each turn.
 * - Roads: only along the lines the map already draws, the borders between territories and the coast between two borders, as
 *   packages/forest/src/view/border-route.ts routes a lit link inland; a short spur leads from the line into a town. A link is
 *   one road; a stretch already walked costs less, so roads merge. */
import { onLand, type Point as P, type TerritoryMap } from "../../../../../packages/forest/src/territories/territories.js";
import { insideOf } from "../../../../../packages/forest/src/view/territory-land.js";

export type { P };
export type Town = {
  id: string; index: number; walled: boolean;
  /** The town's wall (counter-clockwise), or for an unwalled territory the ring its gate marks stand on. */
  ring: P[];
  /** The territory's deepest point and how far it is from the territory's edge. */
  deep: P; depth: number; area: number;
};
export type Gate = { key: string; town: string; at: P; along: P; out: P; links: string[]; spurTo: number };
export type LinkEnd = { kind: "town"; id: string } | { kind: "dock"; dock: number };
export type Link = { key: string; from: LinkEnd; to: LinkEnd; gate?: string; nodes: number[]; edges: number[]; startSpur?: [P, P]; endSpur?: [P, P] };
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

/** The outline of the cells where `inside` holds, as loops along the cells' sides, counter-clockwise; the largest loop. */
function outline(inside: (x: number, y: number) => boolean, w: number, h: number, corner: (x: number, y: number) => P): P[] {
  const next = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => { const k = a.join(); next.set(k, [...(next.get(k) ?? []), b]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    // The region on the left of each side as it is walked.
    if (!inside(x, y - 1)) add([x + 1, y], [x, y]);
    if (!inside(x + 1, y)) add([x + 1, y + 1], [x + 1, y]);
    if (!inside(x, y + 1)) add([x, y + 1], [x + 1, y + 1]);
    if (!inside(x - 1, y)) add([x, y], [x, y + 1]);
  }
  const loops: [number, number][][] = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const loop: [number, number][] = [start.split(",").map(Number) as [number, number]];
      let at = outs.pop()!;
      while (at.join() !== start) {
        loop.push(at);
        const options = next.get(at.join())!;
        at = options.pop()!;
      }
      loops.push(loop);
    }
  }
  const area = (l: P[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]!; return s + p.x * q.z - q.x * p.z; }, 0) / 2;
  const shaped = loops.map(l => l.map(([x, y]) => corner(x, y)));
  return shaped.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0] ?? [];
}

/** Douglas-Peucker on a closed loop, then the shortest runs folded away until every run is at least `minRun` long. */
function simplify(loop: P[], eps: number, minRun: number): P[] {
  if (loop.length < 4) return loop;
  const dp = (pts: P[]): P[] => {
    if (pts.length < 3) return pts;
    const a = pts[0]!, b = pts.at(-1)!, l = far(a, b) || 1e-9;
    let worst = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!, dd = Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / l;
      if (dd > worst) { worst = dd; at = i; }
    }
    return worst <= eps ? [a, b] : [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  // Split at the two points farthest apart, so the loop's ends are corners.
  let i0 = 0, i1 = 0, best = 0;
  for (let i = 0; i < loop.length; i += 3) for (let j = i + 1; j < loop.length; j += 3) { const dd = far(loop[i]!, loop[j]!); if (dd > best) { best = dd; i0 = i; i1 = j; } }
  let out = [...dp(loop.slice(i0, i1 + 1)).slice(0, -1), ...dp([...loop.slice(i1), ...loop.slice(0, i0 + 1)]).slice(0, -1)];
  // Fold away the corner whose triangle is smallest while a run is too short or a turn too slight.
  for (let guard = 0; guard < 400 && out.length > 4; guard++) {
    const n = out.length;
    const weak = out.map((p, i) => {
      const a = out[(i - 1 + n) % n]!, c = out[(i + 1) % n]!;
      const turn = Math.abs(Math.atan2((p.x - a.x) * (c.z - p.z) - (p.z - a.z) * (c.x - p.x), (p.x - a.x) * (c.x - p.x) + (p.z - a.z) * (c.z - p.z)));
      const short = Math.min(far(a, p), far(p, c)) < minRun, slight = turn < 0.22;
      return { i, bad: short || slight, area: Math.abs((p.x - a.x) * (c.z - a.z) - (c.x - a.x) * (p.z - a.z)) };
    }).filter(x => x.bad).sort((a, b) => a.area - b.area)[0];
    if (!weak) break;
    out = out.filter((_, i) => i !== weak.i);
  }
  return out;
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
export const perimeter = (ring: P[]) => ring.reduce((s, a, i) => s + far(a, ring[(i + 1) % ring.length]!), 0);
export function atS(ring: P[], s: number): { at: P; run: number; t: number } {
  const total = perimeter(ring); s = ((s % total) + total) % total;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, l = far(a, b);
    if (s <= l || i === ring.length - 1) return { at: along(a, b, l ? Math.min(1, s / l) : 0), run: i, t: l ? s / l : 0 };
    s -= l;
  }
  return { at: ring[0]!, run: 0, t: 0 };
}

export type Plan = ReturnType<typeof townPlan>;

/** The plan: towns, the line graph, docks, gates and every link's road. `links` names every link once, by its two ends; a
 * link from another island arrives at `dock` (an index into `docks`), one to another island leaves by it. */
export function townPlan(map: TerritoryMap, coast: readonly (readonly P[])[], opts: {
  inset: number; wallCut: number; gateRoom: number; corner: number; cell?: number;
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

  // Towns.
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
    const corner = (x: number, y: number): P => ({ x: x0 + (i0 + x) * cell, z: z0 + (j0 + y) * cell });
    const walled = depth >= opts.wallCut;
    let ring: P[];
    if (walled) {
      // Inset by D, with necks narrower than OPEN opened off: eroded by D + OPEN, then grown back by OPEN.
      const OPEN = D * 1.1, core = (k: number) => Math.sqrt(dist[k]!) * cell >= D + OPEN;
      const grown = edt(core, w, h);
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && Math.sqrt(grown[y * w + x]!) * cell <= OPEN && mine(y * w + x);
      ring = simplify(outline(inside, w, h, corner), D * 0.55, opts.corner);
    } else {
      // No wall: its gate marks stand on a ring about the territory's deepest point.
      const r = Math.max(depth * 0.55, D * 0.35);
      ring = Array.from({ length: 16 }, (_, k) => ({ x: deep.x + r * Math.cos(-k * Math.PI / 8), z: deep.z + r * Math.sin(-k * Math.PI / 8) }));
    }
    // Counter-clockwise (x right, z down the page), so the outward side is on the right of each run.
    const signed = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]!; return s + p.x * q.z - q.x * p.z; }, 0);
    if (signed < 0) ring.reverse();
    towns.set(t.capability, { id: t.capability, index, walled, ring, deep, depth, area: count * cell * cell });
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
  /** The nodes on a town's territory's edge, each with the length of its spur into the town's ring. */
  const sidesOf = (town: Town, o: number[][]) => {
    const m = new Map<number, number>();
    nodes.forEach((p, n) => { if (o[n]!.length && touching(n, o).has(town.index)) m.set(n, onRing(p, town.ring).distance); });
    return m;
  };
  const endOf = (end: LinkEnd, o: number[][]) => end.kind === "dock" ? new Map([[docks[end.dock]!.node, 0]]) : sidesOf(towns.get(end.id)!, o);

  // First, each link's way to the called end, to learn which side of the town it comes in by.
  const o1 = out();
  const arrive = new Map<string, P>();
  const sorted = [...opts.links].map(l => ({ l, way: route(endOf(l.from, o1), endOf(l.to, o1)) }))
    .sort((a, b) => (b.way?.edges.length ?? 0) - (a.way?.edges.length ?? 0));
  for (const { l, way } of sorted) if (way && l.to.kind === "town") arrive.set(l.key, nodes[way.nodes.at(-1)!]!);

  // Then the gates: one per link into a town (or per group: the links one road brings from other islands), on the ring
  // nearest where it comes in, spread apart and kept off the towers at the turns.
  const gates = new Map<string, Gate>();
  const byTown = new Map<string, { key: string; links: string[]; want: number }[]>();
  for (const l of opts.links) {
    if (l.to.kind !== "town" || !arrive.has(l.key)) continue;
    const town = towns.get(l.to.id)!, gk = l.gateGroup ?? l.key, list = byTown.get(town.id) ?? [];
    const known = list.find(g => g.key === gk);
    if (known) known.links.push(l.key);
    else list.push({ key: gk, links: [l.key], want: onRing(arrive.get(l.key)!, town.ring).s });
    byTown.set(town.id, list);
  }
  for (const [id, list] of byTown) {
    const town = towns.get(id)!, ring = town.ring, total = perimeter(ring);
    // Where a gate may stand: off the corners' towers on a walled town.
    const turns: number[] = [];
    let walked = 0;
    ring.forEach((a, i) => { turns.push(walked); walked += far(a, ring[(i + 1) % ring.length]!); });
    const free = (s: number) => !town.walled || turns.every(t => { const dd = Math.abs(((s - t) % total + total * 1.5) % total - total / 2); return dd >= opts.corner * 0.5; });
    const placed: number[] = [];
    const room = town.walled ? opts.gateRoom : Math.min(opts.gateRoom, total / Math.max(1, list.length));
    for (const g of list.sort((a, b) => b.links.length - a.links.length)) {
      let s = g.want;
      for (let k = 0; k < 4000; k++) {
        const c = g.want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * total / 4000;
        const clear = placed.every(p => Math.abs(((c - p) % total + total * 1.5) % total - total / 2) >= room);
        if (clear && free(c)) { s = c; break; }
      }
      placed.push(s);
      const { at, run } = atS(ring, s), a = ring[run]!, b = ring[(run + 1) % ring.length]!, l = far(a, b) || 1;
      const dir = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
      // Outward is on the right of a counter-clockwise run (x across, z down).
      const outward = { x: dir.z, z: -dir.x };
      gates.set(g.key, { key: g.key, town: id, at, along: dir, out: outward, links: g.links, spurTo: -1 });
    }
  }
  // Each gate's spur runs straight out from it to the first drawn line, which is cut there for it.
  const lineHit = (p: P, d: P, limit: number) => {
    let best: { i: number; t: number; u: number } | undefined;
    edges.forEach((e, i) => {
      if (e.dead) return;
      const a = nodes[e.a]!, b = nodes[e.b]!, ex = b.x - a.x, ez = b.z - a.z, den = d.x * ez - d.z * ex;
      if (Math.abs(den) < 1e-12) return;
      const t = ((a.x - p.x) * ez - (a.z - p.z) * ex) / den, u = ((a.x - p.x) * d.z - (a.z - p.z) * d.x) / den;
      if (t > 1e-6 && t < limit && u >= 0 && u <= 1 && (!best || t < best.t)) best = { i, t, u };
    });
    return best;
  };
  for (const g of gates.values()) {
    const town = towns.get(g.town)!;
    const hit = lineHit(g.at, g.out, D * 3);
    if (hit) {
      const e = edges[hit.i]!, q = along(nodes[e.a]!, nodes[e.b]!, hit.u), n = node(q);
      if (n !== e.a && n !== e.b) { e.dead = true; addEdge(e.a, n, e.parts, e.coast); addEdge(n, e.b, e.parts, e.coast); }
      g.spurTo = n;
    } else {
      const o = out(), sides = sidesOf(town, o);
      g.spurTo = [...sides.keys()].sort((a, b) => far(nodes[a]!, g.at) - far(nodes[b]!, g.at))[0]!;
    }
  }

  // Last, every link's road, the longest first so the shorter ones join the ways they lay.
  const o2 = out();
  const links: Link[] = [];
  for (const { l } of sorted) {
    const gate = l.to.kind === "town" ? [...gates.values()].find(g => g.links.includes(l.key)) : undefined;
    const targets = gate ? new Map([[gate.spurTo, 0]]) : endOf(l.to, o2);
    const way = route(endOf(l.from, o2), targets);
    if (!way) continue;
    way.edges.forEach(i => used.add(i));
    const first = nodes[way.nodes[0]!]!, last = nodes[way.nodes.at(-1)!]!;
    const startSpur: [P, P] | undefined = l.from.kind === "town" ? [onRing(first, towns.get(l.from.id)!.ring).at, first] : undefined;
    const endSpur: [P, P] | undefined = gate ? [last, gate.at] : l.to.kind === "town" ? [last, onRing(last, towns.get(l.to.id)!.ring).at] : undefined;
    links.push({ key: l.key, from: l.from, to: l.to, ...(gate ? { gate: gate.key } : {}), nodes: way.nodes, edges: way.edges, ...(startSpur ? { startSpur } : {}), ...(endSpur ? { endSpur } : {}) });
  }
  return { towns, nodes, edges, docks, gates, links, territoryAt, cell, N };
}

export { onLand };
