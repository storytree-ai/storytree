/** Round 10's shared road network, used by the layout tool (Node, to measure) and the page (overlay.ts, to draw). Pure: no
 * three, no DOM.
 *
 * Every link is routed over ONE graph of possible roads: a triangular lattice laid over the island (planar, so two roads
 * can only meet at a junction, never cross over one another). A step costs its length, more on the open band along the
 * coast (so the coast carries road only where nothing inland can serve), and a step across a border costs a gate, more
 * when it enters a territory the link neither starts nor ends in. A step some other link already uses costs a fraction of
 * that, its gate included: so links that go the same way travel the same road until they part, and the arrivals, all
 * from the one mouth, come in on a trunk that branches toward the interfaces it serves (a greedy Steiner-like tree, the
 * way roads between towns share). The links are routed heaviest first, then each is torn up and routed again against the
 * others' roads, twice, so the network settles.
 *
 * Two rules keep the town map's own: no road passes through another territory's settlement, and every link enters the
 * territory it calls through its own gate (no two links share an entrance, from either side), which stays its click
 * target. The used lattice steps are then read off as SEGMENTS: maximal runs that carry the same set of links, joined at
 * junctions, each smoothed with its ends held, and each link's way is the run of segments it travels. */

export type P = { x: number; z: number };
export type NetLink = { key: string; kind: "inside" | "arrival" | "out"; from: P; to: P; fromT: string; toT: string; links: number };
export type BorderSeg = { a: P; b: P; pair: [string, string] };
export type NetInput = {
  /** The territory under a point: a capability, "open" on open land, undefined off the island. */
  tAt(p: P): string | undefined;
  toCoast(p: P): number;
  borders: BorderSeg[];
  links: NetLink[];
  /** Where the sea road comes ashore, the open land's depth along the coast, and the mouth's reach round the landfall. */
  mouth: P; band: number; mouthReach: number;
  /** Settlements, so no road passes through another territory's. */
  towns: { at: P; territory: string }[];
  /** Any extra cost for a road at a point (the page adds one under the names). */
  extra?(p: P): number;
  spacing?: number;
  cost?: Partial<typeof COST>;
};
export type Segment = { id: number; pts: P[]; links: string[]; ends: [number, number] };
export type Net = { segments: Segment[]; ways: Map<string, P[]>; segmentsOf: Map<string, number[]>; junctions: P[]; nodes: number; cost: typeof COST;
  /** Each link's own gate as routed: where it last enters the territory it calls (the way out: where it first leaves). */
  entrances: Map<string, P> };

/** The prices, in ground units of road. */
export const COST = {
  /** The open band along the coast, outside the mouth, per unit of length (1 is ordinary land). */
  coast: 2.6,
  /** A gate: crossing a border. */
  gate: 4,
  /** Entering a territory the link neither starts nor ends in: inside links, and arrivals (which pass through on a trunk). */
  third: 25, thirdArrival: 3,
  /** A step another link already travels, as a share of its price. */
  share: 0.3,
  /** Within this reach of another territory's settlement, per step. */
  town: 40, townReach: 2.6,
  /** No two entrances into one territory nearer than this. */
  entranceApart: 3.8,
  /** A gate is cut 3 units wide: a crossing must sit this far from its border segment's ends. */
  gateClear: 2.1,
};

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
function segCross(a: P, b: P, c: P, d: P): { p: P; u: number } | undefined {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { p: { x: a.x + t * r.x, z: a.z + t * r.z }, u } : undefined;
}

/** A binary heap of [cost, node]. */
class Heap {
  private c: number[] = []; private n: number[] = [];
  get size() { return this.c.length; }
  push(cost: number, node: number) {
    const c = this.c, n = this.n; let i = c.length; c.push(cost); n.push(node);
    while (i > 0) { const p = (i - 1) >> 1; if (c[p]! <= cost) break; c[i] = c[p]!; n[i] = n[p]!; i = p; }
    c[i] = cost; n[i] = node;
  }
  pop(): [number, number] {
    const c = this.c, n = this.n, top: [number, number] = [c[0]!, n[0]!], lc = c.pop()!, ln = n.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, mc = lc; if (l < c.length && c[l]! < mc) { m = l; mc = c[l]!; } if (r < c.length && c[r]! < mc) m = r; if (m === i) break; c[i] = c[m]!; n[i] = n[m]!; i = m; }
      c[i] = lc; n[i] = ln;
    }
    return top;
  }
}

export function network(input: NetInput): Net {
  const cost = { ...COST, ...input.cost };
  const h = input.spacing ?? 1.6, rowH = h * Math.sqrt(3) / 2;
  // ── The lattice: nodes on the land, each with its territory and its price per unit ─────────────────────────────────
  const pts: P[] = [], terr: string[] = [], price: number[] = [];
  const grid = new Map<string, number>();
  for (let row = -Math.ceil(130 / rowH); row <= Math.ceil(130 / rowH); row++) for (let col = -Math.ceil(130 / h); col <= Math.ceil(130 / h); col++) {
    const p = { x: col * h + (row & 1 ? h / 2 : 0), z: row * rowH }, t = input.tAt(p);
    if (t === undefined) continue;
    grid.set(`${row}:${col}`, pts.length);
    pts.push(p); terr.push(t);
    const coastal = t === "open" && input.toCoast(p) < input.band && dist(p, input.mouth) >= input.mouthReach;
    price.push((coastal ? cost.coast : 1) + (input.extra?.(p) ?? 0));
  }
  type Edge = { to: number; len: number; gate?: { p: P; pair: [string, string] } };
  /** Each territory's borders, so a step inside one can be checked for clipping a neighbour's corner. */
  const bordersOf = new Map<string, BorderSeg[]>();
  for (const b of input.borders) for (const t of b.pair) (bordersOf.get(t) ?? bordersOf.set(t, []).get(t)!).push(b);
  const adj: Edge[][] = pts.map(() => []);
  const link = (a: number, b: number) => {
    const A = pts[a]!, B = pts[b]!, mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    // The step stays on land (no shortcut across a bay).
    for (const t of [0.25, 0.5, 0.75]) if (input.tAt({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t }) === undefined) return;
    let gate: Edge["gate"];
    if (terr[a] !== terr[b]) {
      const crossings = input.borders.map(s => ({ s, x: segCross(A, B, s.a, s.b) })).filter(c => c.x !== undefined);
      if (crossings.length !== 1) return;
      const { s, x } = crossings[0]!, l = dist(s.a, s.b);
      // A gate needs room on its border segment, off the corners.
      if (x!.u * l < cost.gateClear || (1 - x!.u) * l < cost.gateClear) return;
      gate = { p: x!.p, pair: s.pair };
    } else if (input.tAt(mid) !== terr[a] || (bordersOf.get(terr[a]!) ?? []).some(s => segCross(A, B, s.a, s.b))) return;
    const len = dist(A, B);
    adj[a]!.push({ to: b, len, ...(gate ? { gate } : {}) });
    adj[b]!.push({ to: a, len, ...(gate ? { gate } : {}) });
  };
  for (const [key, a] of grid) {
    const [row, col] = key.split(":").map(Number) as [number, number], odd = row & 1;
    for (const [dr, dc] of [[0, 1], [1, odd ? 1 : 0], [1, odd ? 0 : -1]] as const) { const b = grid.get(`${row + dr}:${col + dc}`); if (b !== undefined) link(a, b); }
  }
  // Each link's ends: a node of their own, joined to the lattice nodes near them in their own territory.
  const endOf = new Map<string, number>();
  const end = (p: P, t: string) => {
    const key = `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
    const known = endOf.get(key); if (known !== undefined) return known;
    const at = pts.length; pts.push(p); terr.push(t); price.push(1); adj.push([]);
    const near = pts.map((q, i) => ({ i, d: dist(p, q) })).filter(({ i, d }) => i !== at && d < h * 2.2 && (terr[i] === t || t === "sea") && d > 1e-6).sort((x, y) => x.d - y.d).slice(0, 6);
    for (const { i, d } of near) { adj[at]!.push({ to: i, len: d }); adj[i]!.push({ to: at, len: d }); }
    endOf.set(key, at);
    return at;
  };
  const ends = new Map(input.links.map(l => [l.key, [end(l.from, l.kind === "arrival" ? "sea" : l.fromT), end(l.to, l.kind === "out" ? "sea" : l.toT)] as [number, number]]));
  const nearTown = pts.map(p => input.towns.filter(t => dist(t.at, p) < cost.townReach).map(t => t.territory));

  // ── Routing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ekey = (a: number, b: number) => a < b ? a * 1e6 + b : b * 1e6 + a;
  const usage = new Map<number, Set<string>>();
  const routes = new Map<string, number[]>();
  /** Each territory's entrances taken, by link. */
  const entrances = new Map<string, Map<string, P>>();
  const entranceOf = (l: NetLink, path: number[]): P | undefined => {
    let found: P | undefined;
    for (let i = 0; i + 1 < path.length; i++) {
      const e = adj[path[i]!]!.find(x => x.to === path[i + 1]);
      if (!e?.gate) continue;
      // The way out's own gate is where it first leaves its territory; any other link's, where it last enters the one it calls.
      if (l.kind === "out") { if (terr[path[i]!] === l.fromT) return e.gate.p; }
      else if (terr[path[i + 1]!] === l.toT) found = e.gate.p;
    }
    return found;
  };
  const route = (l: NetLink) => {
    const [s, t] = ends.get(l.key)!, taken = [...entrances.values()].flatMap(m => [...m].filter(([k]) => k !== l.key).map(([, p]) => p));
    const best = new Float64Array(pts.length).fill(Infinity), back = new Int32Array(pts.length).fill(-1);
    const heap = new Heap(); best[s] = 0; heap.push(0, s);
    while (heap.size) {
      const [c, a] = heap.pop();
      if (c > best[a]!) continue;
      if (a === t) break;
      for (const e of adj[a]!) {
        const b = e.to;
        // No road through another territory's settlement.
        let step = e.len * (price[a]! + price[b]!) / 2, third = 0;
        if (nearTown[b]!.some(x => x !== l.fromT && x !== l.toT)) step += cost.town;
        if (e.gate) {
          const into = terr[b]!;
          // Its entrance is its own: never at (or beside) a gate that is another link's entrance, either way through.
          const own = l.kind === "out" ? terr[a] === l.fromT : into === l.toT;
          if (own && taken.some(q => dist(q, e.gate!.p) < cost.entranceApart)) continue;
          step += cost.gate;
          // An inside link over a third territory is a fault however many share the road; an arrival's trunk is not.
          if (into !== "open" && into !== l.fromT && into !== l.toT) { if (l.kind === "inside") third = cost.third; else step += cost.thirdArrival; }
        }
        const used = usage.get(ekey(a, b));
        if (used && [...used].some(k => k !== l.key)) step *= cost.share;
        const nc = c + step + third;
        if (nc < best[b]!) { best[b] = nc; back[b] = a; heap.push(nc, b); }
      }
    }
    if (back[t] === -1 && s !== t) throw new Error(`no road for ${l.key}`);
    const path = [t];
    while (path[0] !== s) path.unshift(back[path[0]!]!);
    return path;
  };
  const lay = (l: NetLink, path: number[]) => {
    routes.set(l.key, path);
    for (let i = 0; i + 1 < path.length; i++) { const k = ekey(path[i]!, path[i + 1]!); (usage.get(k) ?? usage.set(k, new Set()).get(k)!).add(l.key); }
    const g = entranceOf(l, path);
    const at = l.kind === "out" ? l.fromT : l.toT;
    if (g) (entrances.get(at) ?? entrances.set(at, new Map()).get(at)!).set(l.key, g);
  };
  const lift = (l: NetLink) => {
    const path = routes.get(l.key); if (!path) return;
    for (let i = 0; i + 1 < path.length; i++) usage.get(ekey(path[i]!, path[i + 1]!))?.delete(l.key);
    entrances.get(l.kind === "out" ? l.fromT : l.toT)?.delete(l.key);
  };
  const order = [...input.links].sort((a, b) => (a.kind === "inside" ? 1 : 0) - (b.kind === "inside" ? 1 : 0) || b.links - a.links);
  for (const l of order) lay(l, route(l));
  for (let pass = 0; pass < 2; pass++) for (const l of order) { lift(l); lay(l, route(l)); }

  // ── Segments: maximal runs carrying one set of links, between junctions ─────────────────────────────────────────────
  const setOf = (a: number, b: number) => [...usage.get(ekey(a, b)) ?? []].sort().join("|");
  const used = new Map<number, number[]>();
  for (const [k, set] of usage) if (set.size) { const a = Math.floor(k / 1e6), b = k % 1e6; (used.get(a) ?? used.set(a, []).get(a)!).push(b); (used.get(b) ?? used.set(b, []).get(b)!).push(a); }
  const endNodes = new Set([...ends.values()].flat());
  /** A node where runs stop: an end, a junction, or where the set of links carried changes. */
  const stop = (n: number) => { const nb = used.get(n) ?? []; return endNodes.has(n) || nb.length !== 2 || setOf(n, nb[0]!) !== setOf(n, nb[1]!); };
  const done = new Set<number>(), segments: Segment[] = [];
  const nodeRuns: number[][] = [];
  for (const [a, nb] of used) if (stop(a)) for (const b0 of nb) {
    if (done.has(ekey(a, b0))) continue;
    const run = [a, b0]; done.add(ekey(a, b0));
    while (!stop(run.at(-1)!)) { const here = run.at(-1)!, next = used.get(here)!.find(x => x !== run.at(-2))!; done.add(ekey(here, next)); run.push(next); }
    nodeRuns.push(run);
  }
  // A closed loop with no stop on it (unlikely) is left undrawn.
  /** The territories a line passes, in turn (sampled every 0.4 units). */
  const passes = (line: P[]) => {
    const seq: (string | undefined)[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!, n = Math.max(1, Math.ceil(dist(a, b) / 0.4));
      for (let k = 0; k <= n; k++) { const t = input.tAt({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); if (seq.at(-1) !== t) seq.push(t); }
    }
    return seq.join(">");
  };
  /** The lattice's zigzags pulled straight (Douglas-Peucker, a fraction of a step), keeping both ends, and never so far that
   * the line passes other territories than the lattice's way did (so a gate stays where the road was routed through it). */
  const straighten = (line: P[]): P[] => {
    if (line.length < 3) return line;
    const a = line[0]!, b = line.at(-1)!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    let far = 0, at = 0;
    for (let i = 1; i + 1 < line.length; i++) { const d = Math.abs((line[i]!.x - a.x) * dz - (line[i]!.z - a.z) * dx) / l; if (d > far) { far = d; at = i; } }
    if (far < h * 0.55 && passes([a, b]) === passes(line)) return [a, b];
    if (at === 0) at = line.length >> 1;
    return [...straighten(line.slice(0, at + 1)).slice(0, -1), ...straighten(line.slice(at))];
  };
  /** Then smoothed (Chaikin), as many rounds (up to three) as keep it passing the same territories. */
  const chaikin = (raw: P[]) => {
    const straight = straighten(raw), want = passes(raw);
    let out = straight, best = straight;
    for (let k = 0; k < 3 && out.length > 2; k++) {
      const next: P[] = [out[0]!];
      for (let i = 0; i + 1 < out.length; i++) { const a = out[i]!, b = out[i + 1]!; next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }); }
      next.push(out.at(-1)!); out = next;
      if (passes(out) !== want) break;
      best = out;
    }
    return best;
  };
  const runOf = new Map<number, { seg: number; forward: boolean }>();
  nodeRuns.forEach((run, id) => {
    segments.push({ id, pts: chaikin(run.map(n => pts[n]!)), links: setOf(run[0]!, run[1]!).split("|"), ends: [run[0]!, run.at(-1)!] });
    for (let i = 0; i + 1 < run.length; i++) { runOf.set(run[i]! * 1e6 + run[i + 1]!, { seg: id, forward: true }); runOf.set(run[i + 1]! * 1e6 + run[i]!, { seg: id, forward: false }); }
  });
  const ways = new Map<string, P[]>(), segmentsOf = new Map<string, number[]>();
  for (const l of input.links) {
    const path = routes.get(l.key)!, line: P[] = [], list: number[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const r = runOf.get(path[i]! * 1e6 + path[i + 1]!)!;
      if (list.at(-1) === r.seg) continue;
      list.push(r.seg);
      const s = segments[r.seg]!.pts, piece = r.forward ? s : [...s].reverse();
      line.push(...(line.length ? piece.slice(1) : piece));
    }
    ways.set(l.key, line); segmentsOf.set(l.key, list);
  }
  const degree = new Map<number, number>();
  for (const s of segments) for (const e of s.ends) degree.set(e, (degree.get(e) ?? 0) + 1);
  const junctions = [...degree].filter(([n, d]) => d >= 3 && !endNodes.has(n)).map(([n]) => pts[n]!);
  return { segments, ways, segmentsOf, junctions, nodes: pts.length, cost, entrances: new Map([...entrances.values()].flatMap(m => [...m])) };
}
