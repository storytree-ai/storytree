/** The mock's plan of the island, in its own units before it is fitted to the land: no three.js, no page.
 * - Fields by dependency, as the map lays its islands (planet-places: rows by dependency depth, deeper rows further east):
 *   a capability that calls nothing stands in the westmost column, each other one column east of the deepest it calls.
 *   Within a column the fields are sorted toward the fields they are linked to, by a few sweeps of barycentre ordering.
 * - Each field is a square whose area follows its lines of code (a floor keeps the smallest wide enough for its gate).
 * - Open commons between the fields: a channel GAP wide between columns and between the fields of a column.
 * - The paths run only along the commons' centre lines, as the map's border routes run only along lines already drawn
 *   (packages/forest/src/view/border-route.ts): each field has one gate, a stub leads from it to the nearest centre line, and
 *   a link takes the shortest way along the lines from gate to gate. A link is one path, whichever way it calls, and links
 *   that share a stretch share it (a stretch already walked costs less), so the ways merge. */

export type P = { x: number; z: number };
export type Side = "E" | "W" | "N" | "S";
export type Field = { id: string; col: number; side: number; x: number; z: number; gate: Side };
export type Edge = { a: number; b: number; length: number };
export type Plan = {
  fields: Field[];
  /** The commons' centre lines as a graph: its corners and its stretches. */
  nodes: P[]; edges: Edge[];
  /** Each field's gate (on its wall) and the corner its stub ends at. */
  gates: Map<string, { at: P; node: number; out: P }>;
  /** One way per linked pair, as the edges it walks, from the caller's gate to the called one's. */
  ways: Map<string, { from: string; to: string; nodes: number[]; edges: number[] }>;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** The shortest way along the lines between two corners, through no gate but the ends'. */
  shortest(from: number, to: number): { edges: number[]; nodes: number[] };
};

/** The commons' width, in the plan's units (a field of L lines is √L wide). */
export const GAP = 10;
/** The smallest field, in lines: under it a field could not hold its gate and its two towers. */
export const FLOOR_LINES = 100;
/** The commons between two fields of one column: wider than between columns, so the plan is nearer round, as the island is. */
export const ROW_GAP = GAP * 2.6;
/** A name's width on the page, in the plan's units at rest (about 2.6 pixels a unit): a column is at least as wide as its widest
 * name, less what may run over into the commons, so names in neighbouring columns do not meet. */
export const NAME_UNITS = (name: string) => (name.length * 5.4 + 16) / 2.6;

type Cap = { id: string; title: string; lines: number; dependsOn: { id: string }[] };

export function plan(caps: readonly Cap[]): Plan {
  const own = new Set(caps.map(c => c.id));
  const byId = new Map(caps.map(c => [c.id, c]));
  const calls = (id: string) => byId.get(id)!.dependsOn.map(d => d.id).filter(d => own.has(d) && d !== id);
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...calls(id).map(c => depthOf(c, seen))) + 1;
    depth.set(id, d);
    return d;
  };
  caps.forEach(c => depthOf(c.id));
  const linked = new Map(caps.map(c => [c.id, new Set<string>()]));
  for (const c of caps) for (const d of calls(c.id)) { linked.get(c.id)!.add(d); linked.get(d)!.add(c.id); }

  const columns: Field[][] = [];
  for (const c of caps) {
    const col = depth.get(c.id)!;
    (columns[col] ??= []).push({ id: c.id, col, side: Math.sqrt(Math.max(FLOOR_LINES, c.lines)), x: 0, z: 0, gate: "E" });
  }
  const titleOf = new Map(caps.map(c => [c.id, c.title.replace(/^\d+ · /, "")]));
  const widths = columns.map(col => Math.max(...col.map(f => Math.max(f.side, NAME_UNITS(titleOf.get(f.id)!) - GAP * 0.8))));
  let cursor = 0;
  columns.forEach((col, k) => { const x = cursor + widths[k]! / 2; col.forEach(f => { f.x = x; }); cursor += widths[k]! + GAP; });
  const stack = (col: Field[]) => {
    const total = col.reduce((s, f) => s + f.side, 0) + ROW_GAP * (col.length - 1);
    let z = -total / 2;
    for (const f of col) { f.z = z + f.side / 2; z += f.side + ROW_GAP; }
  };
  columns.forEach(stack);
  const all = columns.flat(), at = new Map(all.map(f => [f.id, f]));
  // Barycentre sweeps: each field toward the mean height of the fields it is linked to in other columns.
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const col of sweep % 2 ? [...columns].reverse() : columns) {
      const want = new Map(col.map(f => {
        const others = [...linked.get(f.id)!].map(id => at.get(id)!).filter(o => o.col !== f.col);
        return [f.id, others.length ? others.reduce((s, o) => s + o.z, 0) / others.length : f.z] as const;
      }));
      col.sort((a, b) => want.get(a.id)! - want.get(b.id)!);
      stack(col);
      // Then slide the whole column toward where its fields want to be, so a short column sits by its links.
      const shift = col.reduce((s, f) => s + want.get(f.id)! - f.z, 0) / col.length;
      col.forEach(f => { f.z += shift * 0.8; });
    }
  }

  // The commons' centre lines.
  const C = columns.length;
  const left = (k: number) => columns[k]![0]!.x - widths[k]! / 2, right = (k: number) => columns[k]![0]!.x + widths[k]! / 2;
  const v = Array.from({ length: C + 1 }, (_, k) => k === 0 ? left(0) - GAP / 2 : k === C ? right(C - 1) + GAP / 2 : (right(k - 1) + left(k)) / 2);
  const top = (k: number) => Math.min(...columns[k]!.map(f => f.z - f.side / 2)) - GAP / 2;
  const bottom = (k: number) => Math.max(...columns[k]!.map(f => f.z + f.side / 2)) + GAP / 2;
  const segs: [P, P][] = [];
  for (let k = 0; k <= C; k++) {
    const adj = [k - 1, k].filter(j => j >= 0 && j < C);
    segs.push([{ x: v[k]!, z: Math.min(...adj.map(top)) }, { x: v[k]!, z: Math.max(...adj.map(bottom)) }]);
  }
  // Across each column: above it, below it and between each two of its fields.
  const across = (k: number): number[] => {
    const col = [...columns[k]!].sort((a, b) => a.z - b.z), out = [top(k), bottom(k)];
    for (let i = 0; i + 1 < col.length; i++) out.push((col[i]!.z + col[i]!.side / 2 + col[i + 1]!.z - col[i + 1]!.side / 2) / 2);
    return out;
  };
  for (let k = 0; k < C; k++) for (const z of across(k)) segs.push([{ x: v[k]!, z }, { x: v[k + 1]!, z }]);

  // Each field's gate, on the side that faces the fields it is linked to (and Keys, for the road, by the caller's hint).
  const gateAt = (f: Field, side: Side): { at: P; out: P } => {
    const h = f.side / 2, k = f.col;
    const col = [...columns[k]!].sort((a, b) => a.z - b.z), lines = across(k);
    if (side === "E") return { at: { x: f.x + h, z: f.z }, out: { x: v[k + 1]!, z: f.z } };
    if (side === "W") return { at: { x: f.x - h, z: f.z }, out: { x: v[k]!, z: f.z } };
    const edge = side === "N" ? f.z - h : f.z + h;
    const line = lines.filter(z => side === "N" ? z < edge : z > edge).sort((a, b) => Math.abs(a - edge) - Math.abs(b - edge))[0]!;
    void col;
    return { at: { x: f.x, z: edge }, out: { x: f.x, z: line } };
  };
  for (const f of all) {
    let dx = 0, dz = 0;
    for (const id of linked.get(f.id)!) { const o = at.get(id)!, l = Math.hypot(o.x - f.x, o.z - f.z) || 1; dx += (o.x - f.x) / l; dz += (o.z - f.z) / l; }
    const sides: [Side, number][] = [["E", dx], ["W", -dx], ["S", dz], ["N", -dz]];
    f.gate = sides.sort((a, b) => b[1] - a[1])[0]![0];
  }
  return { ...graph(all, segs, gateAt, calls), bounds: { x0: v[0]!, x1: v[C]!, z0: Math.min(...columns.map((_, k) => top(k))), z1: Math.max(...columns.map((_, k) => bottom(k))) } };
}

function graph(fields: Field[], lines: [P, P][], gateAt: (f: Field, side: Side) => { at: P; out: P }, calls: (id: string) => string[]) {
  const segs: [P, P][] = [...lines];
  const stubs = new Map(fields.map(f => [f.id, gateAt(f, f.gate)]));
  for (const { at, out } of stubs.values()) segs.push([at, out]);
  const nodes: P[] = [], index = new Map<string, number>();
  const key = (p: P) => `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;
  const node = (p: P) => { const k = key(p); let i = index.get(k); if (i === undefined) { index.set(k, i = nodes.length); nodes.push(p); } return i; };
  const ends = segs.flat();
  const edges: Edge[] = [];
  for (const [a, b] of segs) {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-6) continue;
    // Every other line's end that lies on this one cuts it there.
    const stops = ends.map(p => ({ p, t: ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (l * l) }))
      .filter(({ p, t }) => t > -1e-6 && t < 1 + 1e-6 && Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / l < 1e-4)
      .sort((p, q) => p.t - q.t);
    for (let i = 0; i + 1 < stops.length; i++) {
      const u = node(stops[i]!.p), w = node(stops[i + 1]!.p);
      if (u === w || edges.some(e => (e.a === u && e.b === w) || (e.a === w && e.b === u))) continue;
      edges.push({ a: u, b: w, length: Math.hypot(nodes[w]!.x - nodes[u]!.x, nodes[w]!.z - nodes[u]!.z) });
    }
  }
  const gates = new Map([...stubs].map(([id, { at, out }]) => [id, { at, out, node: node(at) }]));
  const out = nodes.map(() => [] as number[]);
  edges.forEach((e, i) => { out[e.a]!.push(i); out[e.b]!.push(i); });
  const used = new Set<number>();
  const gateNodes = new Set([...gates.values()].map(g => g.node));
  const shortest = (from: number, to: number) => {
    const dist = new Map([[from, 0]]), back = new Map<number, number>(), done = new Set<number>();
    while (true) {
      let here = -1, best = Infinity;
      for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; here = n; }
      if (here < 0 || here === to) break;
      done.add(here);
      for (const i of out[here]!) {
        const e = edges[i]!, there = e.a === here ? e.b : e.a;
        // No way passes through another field's gate.
        if (gateNodes.has(there) && there !== to && there !== from) continue;
        const d = best + e.length * (used.has(i) ? 0.55 : 1);
        if (d < (dist.get(there) ?? Infinity)) { dist.set(there, d); back.set(there, i); }
      }
    }
    const way: number[] = [], walk: number[] = [to];
    for (let n = to; n !== from;) { const i = back.get(n)!; way.unshift(i); n = edges[i]!.a === n ? edges[i]!.b : edges[i]!.a; walk.unshift(n); }
    return { edges: way, nodes: walk };
  };
  const ways = new Map<string, { from: string; to: string; nodes: number[]; edges: number[] }>();
  const pairs = new Set<string>();
  // The longest links first, so the shorter ones join the trunks they lay.
  const links = fields.flatMap(f => calls(f.id).map(to => ({ from: f.id, to })))
    .filter(({ from, to }) => { const k = [from, to].sort().join("|"); if (pairs.has(k)) return false; pairs.add(k); return true; })
    .map(l => ({ ...l, far: Math.hypot(gates.get(l.from)!.at.x - gates.get(l.to)!.at.x, gates.get(l.from)!.at.z - gates.get(l.to)!.at.z) }))
    .sort((a, b) => b.far - a.far);
  for (const { from, to } of links) {
    const way = shortest(gates.get(from)!.node, gates.get(to)!.node);
    way.edges.forEach(i => used.add(i));
    ways.set(`${from}->${to}`, { from, to, ...way });
  }
  return { fields, nodes, edges, gates, ways, shortest, out };
}
