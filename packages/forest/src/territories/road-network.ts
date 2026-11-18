// Capability 3 · Story node render
import type { Point } from "./territories.js";

export type NetLink = { readonly key: string; readonly kind: "inside" | "arrival" | "out"; readonly from: Point; readonly to: Point; readonly fromT: string; readonly toT: string; readonly links: number };
export type BorderSeg = { readonly a: Point; readonly b: Point; readonly pair: readonly [string, string] };
export type NetInput = {
  tAt(p: Point): string | undefined;
  toCoast(p: Point): number;
  borders: readonly BorderSeg[];
  links: readonly NetLink[];
  mouths: readonly { at: Point; reach: number }[];
  band: number;
  towns: readonly { at: Point; territory: string }[];
  radius: number;
  extra?(p: Point): number;
  gateExtra?(p: Point): number;
  cost?: Partial<typeof COST>;
};
export type Segment = { readonly id: number; readonly pts: readonly Point[]; readonly links: readonly string[] };
export type Net = { segments: Segment[]; ways: Map<string, Point[]>; junctions: Point[]; unrouted: string[] };

export const COST = {
  coast: 2.6,
  gate: 4,
  third: 25, thirdArrival: 60,
  share: 0.3,
  town: 40, townReach: 2.6,
  entranceApart: 9,
  gateClear: 2.1,
  edge: 0.8, edgeReach: 3,
  shareEntrance: 1,
  openGate: 30,
  pairShare: 1,
  crowd: 1,
};
const SPACING = 1.6;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
function segCross(a: Point, b: Point, c: Point, d: Point): { p: Point; u: number } | undefined {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { p: { x: a.x + t * r.x, z: a.z + t * r.z }, u } : undefined;
}

class Heap {
  private c: number[] = [];
  private n: number[] = [];
  get size() { return this.c.length; }
  push(cost: number, node: number) {
    const c = this.c, n = this.n;
    let i = c.length;
    c.push(cost); n.push(node);
    while (i > 0) { const p = (i - 1) >> 1; if (c[p]! <= cost) break; c[i] = c[p]!; n[i] = n[p]!; i = p; }
    c[i] = cost; n[i] = node;
  }
  pop(): [number, number] {
    const c = this.c, n = this.n, top: [number, number] = [c[0]!, n[0]!], lc = c.pop()!, ln = n.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mc = lc;
        if (l < c.length && c[l]! < mc) { m = l; mc = c[l]!; }
        if (r < c.length && c[r]! < mc) m = r;
        if (m === i) break;
        c[i] = c[m]!; n[i] = n[m]!; i = m;
      }
      c[i] = lc; n[i] = ln;
    }
    return top;
  }
}

type Gate = { p: Point; pair: readonly [string, string] };
type Edge = { to: number; id: number; base: number; gate?: Gate };

export function roadNetwork(input: NetInput): Net {
  const cost = { ...COST, ...input.cost };
  const h = SPACING, rowH = h * Math.sqrt(3) / 2;
  const pts: Point[] = [], terr: string[] = [], price: number[] = [];
  const grid = new Map<string, number>();
  const rows = Math.ceil((input.radius + h) / rowH), cols = Math.ceil((input.radius + h) / h);
  for (let row = -rows; row <= rows; row++) for (let col = -cols; col <= cols; col++) {
    const p = { x: col * h + (row & 1 ? h / 2 : 0), z: row * rowH }, t = input.tAt(p);
    if (t === undefined) continue;
    grid.set(`${row}:${col}`, pts.length);
    pts.push(p); terr.push(t);
    const atMouth = input.mouths.some((m) => dist(p, m.at) < m.reach);
    const coastal = t === "open" && input.toCoast(p) < input.band && !atMouth;
    const edge = t !== "open" && cost.edge > 0 && !atMouth ? Math.max(0, 1 - input.toCoast(p) / cost.edgeReach) * cost.edge : 0;
    price.push((coastal ? cost.coast : 1) + edge + (input.extra?.(p) ?? 0));
  }
  const bordersOf = new Map<string, BorderSeg[]>();
  for (const b of input.borders) for (const t of b.pair) (bordersOf.get(t) ?? bordersOf.set(t, []).get(t)!).push(b);
  const adj: Edge[][] = pts.map(() => []);
  const steps = new Map<number, number>(), stepEnds: [number, number][] = [];
  const ekey = (a: number, b: number) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  const step = (a: number, b: number, base: number, gate?: Gate) => {
    const id = stepEnds.length;
    stepEnds.push([a, b]); steps.set(ekey(a, b), id);
    adj[a]!.push({ to: b, id, base, ...(gate ? { gate } : {}) });
    adj[b]!.push({ to: a, id, base, ...(gate ? { gate } : {}) });
  };
  const join = (a: number, b: number) => {
    const A = pts[a]!, B = pts[b]!, mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    for (const t of [0.25, 0.5, 0.75]) if (input.tAt({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t }) === undefined) return;
    let gate: Gate | undefined;
    if (terr[a] !== terr[b]) {
      const crossings = input.borders.flatMap((s) => { const x = segCross(A, B, s.a, s.b); return x ? [{ s, x }] : []; });
      if (crossings.length !== 1) return;
      const { s, x } = crossings[0]!, l = dist(s.a, s.b);
      if (x.u * l < cost.gateClear || (1 - x.u) * l < cost.gateClear) return;
      gate = { p: x.p, pair: s.pair };
    } else if (input.tAt(mid) !== terr[a] || (bordersOf.get(terr[a]!) ?? []).some((s) => segCross(A, B, s.a, s.b))) return;
    const gated = gate === undefined ? 0 : cost.gate + (input.gateExtra?.(gate.p) ?? 0) + (cost.openGate && gate.pair.includes("open") ? cost.openGate : 0);
    step(a, b, dist(A, B) * (price[a]! + price[b]!) / 2 + gated, gate);
  };
  for (const [key, a] of grid) {
    const [row, col] = key.split(":").map(Number) as [number, number], odd = row & 1;
    for (const [dr, dc] of [[0, 1], [1, odd ? 1 : 0], [1, odd ? 0 : -1]] as const) { const b = grid.get(`${row + dr}:${col + dc}`); if (b !== undefined) join(a, b); }
  }
  const endOf = new Map<string, number>();
  const end = (p: Point, t: string) => {
    const key = `${p.x.toFixed(3)},${p.z.toFixed(3)}`, known = endOf.get(key);
    if (known !== undefined) return known;
    const at = pts.length;
    pts.push(p); terr.push(t); price.push(1); adj.push([]);
    const row0 = Math.round(p.z / rowH), col0 = Math.round(p.x / h), around: number[] = [];
    for (let row = row0 - 3; row <= row0 + 3; row++) for (let col = col0 - 3; col <= col0 + 3; col++) { const i = grid.get(`${row}:${col}`); if (i !== undefined) around.push(i); }
    const near = around.map((i) => ({ i, d: dist(p, pts[i]!) })).filter(({ i, d }) => d < h * 2.2 && (terr[i] === t || t === "sea") && d > 1e-6).sort((x, y) => x.d - y.d || x.i - y.i).slice(0, 6);
    for (const { i, d } of near) step(at, i, d * (1 + price[i]!) / 2);
    endOf.set(key, at);
    return at;
  };
  const ends = new Map(input.links.map((l) => [l.key, [end(l.from, l.kind === "arrival" ? "sea" : l.fromT), end(l.to, l.kind === "out" ? "sea" : l.toT)] as const]));
  const nearTown = pts.map((p) => { const near = input.towns.filter((t) => dist(t.at, p) < cost.townReach).map((t) => t.territory); return near.length ? near : undefined; });

  const usage = new Map<number, Set<string>>(), uses = new Int32Array(stepEnds.length);
  const routes = new Map<string, number[]>();
  const entrances = new Map<string, Map<string, Point>>(), borderOf = new Map<string, string>();
  const pairKey = (pair: readonly [string, string]) => [...pair].sort().join("|");
  const mineOf = (l: NetLink) => (l.kind === "out" ? l.fromT : l.toT);
  const entranceOf = (l: NetLink, path: readonly number[]): Gate | undefined => {
    let found: Gate | undefined;
    for (let i = 0; i + 1 < path.length; i++) {
      const e = adj[path[i]!]!.find((x) => x.to === path[i + 1]);
      if (!e?.gate) continue;
      if (l.kind === "out") { if (terr[path[i]!] === l.fromT) return e.gate; }
      else if (terr[path[i + 1]!] === l.toT) found = e.gate;
    }
    return found;
  };
  const route = (l: NetLink, relaxed: boolean): number[] | undefined => {
    const [s, t] = ends.get(l.key)!, mine = mineOf(l);
    const taken = [...entrances].flatMap(([into, m]) => [...m].filter(([k]) => k !== l.key).map(([k, p]) => ({ p, same: into === mine, border: borderOf.get(k) })));
    const best = new Float64Array(pts.length).fill(Infinity), back = new Int32Array(pts.length).fill(-1);
    const heap = new Heap();
    best[s] = 0; heap.push(0, s);
    while (heap.size) {
      const [c, a] = heap.pop();
      if (c > best[a]!) continue;
      if (a === t) break;
      for (const e of adj[a]!) {
        const b = e.to;
        let price = e.base, third = 0;
        const town = nearTown[b];
        if (town !== undefined && town.some((x) => x !== l.fromT && x !== l.toT)) price += cost.town;
        if (e.gate) {
          const into = terr[b]!, gate = e.gate;
          const own = l.kind === "out" ? terr[a] === l.fromT : into === l.toT;
          if (own && !relaxed && taken.some((q) => dist(q.p, gate.p) < cost.entranceApart
            && !(((cost.shareEntrance && q.same) || (cost.pairShare && q.border === pairKey(gate.pair))) && dist(q.p, gate.p) < 0.05))) continue;
          if (into !== "open" && into !== l.fromT && into !== l.toT) { if (l.kind === "inside") third = cost.third; else price += cost.thirdArrival; }
        }
        if (uses[e.id]! > 0) price *= cost.share;
        const nc = c + price + third;
        if (nc < best[b]!) { best[b] = nc; back[b] = a; heap.push(nc, b); }
      }
    }
    if (back[t] === -1 && s !== t) return relaxed || !cost.crowd ? undefined : route(l, true);
    const path = [t];
    while (path[0] !== s) path.unshift(back[path[0]!]!);
    return path;
  };
  const lay = (l: NetLink, path: number[] | undefined) => {
    if (path === undefined) return;
    routes.set(l.key, path);
    for (let i = 0; i + 1 < path.length; i++) { const k = steps.get(ekey(path[i]!, path[i + 1]!))!; (usage.get(k) ?? usage.set(k, new Set()).get(k)!).add(l.key); uses[k]! += 1; }
    const g = entranceOf(l, path), at = mineOf(l);
    if (g) { (entrances.get(at) ?? entrances.set(at, new Map()).get(at)!).set(l.key, g.p); borderOf.set(l.key, pairKey(g.pair)); }
  };
  const lift = (l: NetLink) => {
    const path = routes.get(l.key);
    if (!path) return;
    routes.delete(l.key);
    for (let i = 0; i + 1 < path.length; i++) { const k = steps.get(ekey(path[i]!, path[i + 1]!))!; if (usage.get(k)?.delete(l.key)) uses[k]! -= 1; }
    entrances.get(mineOf(l))?.delete(l.key);
  };
  const order = [...input.links].sort((a, b) => (a.kind === "inside" ? 1 : 0) - (b.kind === "inside" ? 1 : 0) || b.links - a.links);
  for (const l of order) lay(l, route(l, false));
  for (let pass = 0; pass < 2; pass++) for (const l of order) { lift(l); lay(l, route(l, false)); }

  const setOf = (a: number, b: number) => [...usage.get(steps.get(ekey(a, b))!) ?? []].sort().join("|");
  const used = new Map<number, number[]>();
  for (const [k, set] of usage) if (set.size) {
    const [a, b] = stepEnds[k]!;
    (used.get(a) ?? used.set(a, []).get(a)!).push(b); (used.get(b) ?? used.set(b, []).get(b)!).push(a);
  }
  const endNodes = new Set([...ends.values()].flat());
  const stop = (n: number) => { const nb = used.get(n) ?? []; return endNodes.has(n) || nb.length !== 2 || setOf(n, nb[0]!) !== setOf(n, nb[1]!); };
  const done = new Set<number>(), runs: number[][] = [];
  for (const [a, nb] of used) if (stop(a)) for (const b0 of nb) {
    if (done.has(ekey(a, b0))) continue;
    const run = [a, b0];
    done.add(ekey(a, b0));
    while (!stop(run.at(-1)!)) { const here = run.at(-1)!, next = used.get(here)!.find((x) => x !== run.at(-2))!; done.add(ekey(here, next)); run.push(next); }
    runs.push(run);
  }
  const passes = (line: readonly Point[]) => {
    const seq: (string | undefined)[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!, n = Math.max(1, Math.ceil(dist(a, b) / 0.4));
      for (let k = 0; k <= n; k++) { const t = input.tAt({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); if (seq.at(-1) !== t) seq.push(t); }
    }
    return seq.join(">");
  };
  const straighten = (line: Point[]): Point[] => {
    if (line.length < 3) return line;
    const a = line[0]!, b = line.at(-1)!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    let far = 0, at = 0;
    for (let i = 1; i + 1 < line.length; i++) { const d = Math.abs((line[i]!.x - a.x) * dz - (line[i]!.z - a.z) * dx) / l; if (d > far) { far = d; at = i; } }
    if (far < h * 0.55 && passes([a, b]) === passes(line)) return [a, b];
    if (at === 0) at = line.length >> 1;
    return [...straighten(line.slice(0, at + 1)).slice(0, -1), ...straighten(line.slice(at))];
  };
  const chaikin = (raw: Point[]) => {
    const want = passes(raw);
    let out = straighten(raw), best = out;
    for (let k = 0; k < 3 && out.length > 2; k++) {
      const next: Point[] = [out[0]!];
      for (let i = 0; i + 1 < out.length; i++) { const a = out[i]!, b = out[i + 1]!; next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }); }
      next.push(out.at(-1)!);
      out = next;
      if (passes(out) !== want) break;
      best = out;
    }
    return best;
  };
  const segments: Segment[] = [], runOf = new Map<number, { seg: number; forward: boolean }>();
  runs.forEach((run, id) => {
    segments.push({ id, pts: chaikin(run.map((n) => pts[n]!)), links: setOf(run[0]!, run[1]!).split("|") });
    for (let i = 0; i + 1 < run.length; i++) { runOf.set(run[i]! * 1e6 + run[i + 1]!, { seg: id, forward: true }); runOf.set(run[i + 1]! * 1e6 + run[i]!, { seg: id, forward: false }); }
  });
  const ways = new Map<string, Point[]>();
  for (const [key, path] of routes) {
    const line: Point[] = [];
    let last = -1;
    for (let i = 0; i + 1 < path.length; i++) {
      const r = runOf.get(path[i]! * 1e6 + path[i + 1]!)!;
      if (r.seg === last) continue;
      last = r.seg;
      const s = segments[r.seg]!.pts, piece = r.forward ? s : [...s].reverse();
      line.push(...(line.length ? piece.slice(1) : piece));
    }
    ways.set(key, line);
  }
  const degree = new Map<number, number>();
  for (const run of runs) for (const e of [run[0]!, run.at(-1)!]) degree.set(e, (degree.get(e) ?? 0) + 1);
  const junctions = [...degree].filter(([n, d]) => d >= 3 && !endNodes.has(n)).map(([n]) => pts[n]!);
  return { segments, ways, junctions, unrouted: input.links.filter((l) => !routes.has(l.key)).map((l) => l.key) };
}
