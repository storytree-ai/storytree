/** Round 6A's plan of the island, in its own units (about one pixel each at rest) before it is laid on the land: no three.js,
 * no page.
 * - Layers by dependency, as the architecture diagram stands: a capability above what it calls. Each starts at its longest
 *   path from the top, then moves, within the room its callers and callees leave it, to the layer that keeps its links
 *   shortest (a few sweeps), so a link mostly spans one layer.
 * - Order within a layer by barycentre sweeps over the links (long links counted through every layer they cross), keeping
 *   the order with the fewest crossings; then each patch slides toward the patches it is linked to, never closer to its
 *   neighbour than the open land allows.
 * - Each capability an organic patch, its area following its lines of code (a floor keeps the smallest wide enough for its
 *   gates): a rounded blob, a little wider than tall, its wobble seeded by its id so it is the same at every load.
 * - Gates: one per link, on the called patch's outline, facing where the link comes from, spread so no two gaps meet.
 * - Roads: through the open land on a fine grid (route), never through a patch or a name, each leaving its caller by one
 *   way out and splitting toward its gates; a coast arrival comes in as one road and splits the same way. */

export type P = { x: number; z: number };
export type Cap = { id: string; title: string; lines: number; dependsOn: { id: string }[] };
export type Patch = { id: string; layer: number; x: number; z: number; r: number; outline: P[]; half: { w: number; h: number }; label: { w: number; h: number } };
export type End = { kind: "patch"; id: string } | { kind: "dock"; dock: number };
export type Want = { key: string; from: End; to: End };
export type Gate = { key: string; patch: string; at: P; out: P; along: P; s: number; approach: P; inner: P };
/** A road network for one source (a caller, or a dock): a tree of points rooted at its way out. */
export type Tree = { group: string; pts: P[]; parent: number[]; carried: Set<string>[] };
export type Routed = { trees: Tree[]; paths: Map<string, P[]>; gates: Map<string, Gate>; exits: Map<string, { at: P; out: P; reach?: number }>; unrouted: string[] };

/** Plan units per line of code, as an area: the largest patch (about 2,000 lines) is about 120 units across. */
const AREA = 8;
/** The smallest patch, in lines: under it a patch could not hold its gate and the start of its road. */
export const FLOOR_LINES = 160;
/** Open land between two patches of a layer, and between two layers, in plan units. */
export const COLUMN_GAP = 56, LAYER_GAP = 125;
/** A gate's gap, the least outline between two gaps, and how far out from the gap a road comes straight in. */
export const GAP = 11, GATE_SPACING = 30, APPROACH = 20;
/** A road keeps this far off a patch's outline and a name's box, except where it comes in through its gate. */
export const CLEAR = 9;
/** A name's box, in plan units at rest: the map's nameplate, 11-pixel type in a pill. */
export const LABEL = (name: string) => ({ w: name.length * 5.7 + 16, h: 18 });

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
export const along = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const nameOf = (title: string) => title.replace(/^\d+ · /, "");

/** A small seeded random, so a patch's wobble is the same at every load. */
function seeded(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

/** An organic patch's outline about the origin: a rounded blob of the given area, wider than tall by `stretch`. */
function blob(id: string, area: number, stretch = 1.18): P[] {
  const rnd = seeded(id), N = 96;
  const waves = [[2, 0.07], [3, 0.055], [4, 0.03], [5, 0.022]].map(([k, a]) => ({ k: k!, a: a! * (0.6 + rnd() * 0.8), phase: rnd() * Math.PI * 2 }));
  const raw = Array.from({ length: N }, (_, i) => {
    const t = i / N * Math.PI * 2, r = 1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * t + w.phase), 0);
    return { x: Math.cos(t) * r * stretch, z: Math.sin(t) * r / stretch };
  });
  let a = 0;
  for (let i = 0; i < N; i++) { const p = raw[i]!, q = raw[(i + 1) % N]!; a += p.x * q.z - q.x * p.z; }
  const k = Math.sqrt(area / Math.abs(a / 2));
  return raw.map(p => ({ x: p.x * k, z: p.z * k }));
}

export function layout(caps: readonly Cap[]): { patches: Map<string, Patch>; layers: string[][]; crossings: number } {
  const own = new Set(caps.map(c => c.id));
  const calls = new Map(caps.map(c => [c.id, c.dependsOn.map(d => d.id).filter(d => own.has(d) && d !== c.id)]));
  const callers = new Map(caps.map(c => [c.id, caps.filter(o => calls.get(o.id)!.includes(c.id)).map(o => o.id)]));
  // Longest path from the top.
  const layer = new Map<string, number>();
  const top = (id: string, seen = new Set<string>()): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const l = Math.max(-1, ...callers.get(id)!.map(c => top(c, seen))) + 1;
    layer.set(id, l);
    return l;
  };
  caps.forEach(c => top(c.id));
  const depth = Math.max(...layer.values());
  // Then each to the layer, within the room its links leave it, that keeps its links shortest; ties go to the thinner layer.
  for (let sweep = 0; sweep < 8; sweep++) for (const c of caps) {
    const up = callers.get(c.id)!, down = calls.get(c.id)!;
    const lo = Math.max(0, ...up.map(u => layer.get(u)! + 1)), hi = Math.min(depth, ...down.map(d => layer.get(d)! - 1));
    if (!up.length && !down.length) continue;
    let best = layer.get(c.id)!, cost = Infinity;
    for (let l = lo; l <= hi; l++) {
      const length = up.reduce((s, u) => s + l - layer.get(u)!, 0) + down.reduce((s, d) => s + layer.get(d)! - l, 0);
      const width = caps.filter(o => o.id !== c.id && layer.get(o.id) === l).reduce((s, o) => s + Math.max(LABEL(nameOf(o.title)).w, Math.sqrt(Math.max(FLOOR_LINES, o.lines) * AREA) * 1.2) + COLUMN_GAP, 0);
      const score = length * 200 + width / 4;
      if (score < cost) { cost = score; best = l; }
    }
    layer.set(c.id, best);
  }
  // A group of capabilities linked only among themselves moves down, whole, to the layers where the rest is thinnest, so the
  // plan stays about as wide as it is tall, as the island is.
  const component = new Map<string, number>();
  caps.forEach((c, k) => { if (component.has(c.id)) return; const stack = [c.id]; while (stack.length) { const id = stack.pop()!; if (component.has(id)) continue; component.set(id, k); stack.push(...calls.get(id)!, ...callers.get(id)!); } });
  const sizes = new Map<number, number>();
  for (const k of component.values()) sizes.set(k, (sizes.get(k) ?? 0) + 1);
  const main = [...sizes].sort((a, b) => b[1] - a[1])[0]![0];
  for (const [k, n] of [...sizes].sort((a, b) => b[1] - a[1])) {
    if (k === main || n < 2) continue;
    const members = caps.filter(c => component.get(c.id) === k).map(c => c.id), span = Math.max(...members.map(m => layer.get(m)!));
    let best = 0, cost = Infinity;
    for (let shift = 0; shift + span <= depth; shift++) {
      const widths = Array.from({ length: depth + 1 }, (_, l) => caps.filter(o => (component.get(o.id) === k ? layer.get(o.id)! + shift : layer.get(o.id)!) === l).length);
      const score = Math.max(...widths) * 100 + widths.reduce((s, w) => s + w * w, 0);
      if (score < cost) { cost = score; best = shift; }
    }
    for (const m of members) layer.set(m, layer.get(m)! + best);
  }
  // A capability linked to nothing here stands in the thinnest layer.
  for (const c of caps) if (!calls.get(c.id)!.length && !callers.get(c.id)!.length) {
    const counts = Array.from({ length: depth + 1 }, (_, l) => caps.filter(o => o.id !== c.id && layer.get(o.id) === l).length);
    layer.set(c.id, counts.indexOf(Math.min(...counts.slice(1))));
  }

  // Order within layers, long links counted through every layer they cross (a stand-in in each).
  type Item = { id: string; real: boolean };
  const rows: Item[][] = Array.from({ length: depth + 1 }, () => []);
  for (const c of caps) rows[layer.get(c.id)!]!.push({ id: c.id, real: true });
  const ties: [string, string][] = [];
  for (const c of caps) for (const d of calls.get(c.id)!) {
    let prev = c.id;
    for (let l = layer.get(c.id)! + 1; l < layer.get(d)!; l++) { const id = `${c.id}~${d}~${l}`; rows[l]!.push({ id, real: false }); ties.push([prev, id]); prev = id; }
    ties.push([prev, d]);
  }
  const rowOf = new Map(rows.flatMap((row, l) => row.map(i => [i.id, l] as const)));
  const up = new Map<string, string[]>(), down = new Map<string, string[]>();
  for (const [a, b] of ties) { down.set(a, [...(down.get(a) ?? []), b]); up.set(b, [...(up.get(b) ?? []), a]); }
  const posIn = () => new Map(rows.flatMap(row => row.map((i, k) => [i.id, k] as const)));
  const crossings = () => {
    const pos = posIn();
    let n = 0;
    const byRow = ties.filter(([a]) => true).map(([a, b]) => ({ l: rowOf.get(a)!, a: pos.get(a)!, b: pos.get(b)! }));
    for (let i = 0; i < byRow.length; i++) for (let j = i + 1; j < byRow.length; j++) {
      const e = byRow[i]!, f = byRow[j]!;
      if (e.l === f.l && (e.a - f.a) * (e.b - f.b) < 0) n++;
    }
    return n;
  };
  let bestOrder = rows.map(r => r.map(i => i.id)), bestCross = crossings();
  for (let sweep = 0; sweep < 24; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? rows.map((_, l) => l) : rows.map((_, l) => rows.length - 1 - l);
    for (const l of order) {
      const pos = posIn(), row = rows[l]!;
      const wanted = new Map(row.map((item, k) => {
        const others = (downward ? up.get(item.id) : down.get(item.id)) ?? [];
        return [item.id, others.length ? others.reduce((s, o) => s + pos.get(o)!, 0) / others.length : k] as const;
      }));
      row.sort((a, b) => wanted.get(a.id)! - wanted.get(b.id)!);
    }
    const n = crossings();
    if (n < bestCross) { bestCross = n; bestOrder = rows.map(r => r.map(i => i.id)); }
  }
  rows.forEach((row, l) => { const byId = new Map(row.map(i => [i.id, i])); rows[l] = bestOrder[l]!.map(id => byId.get(id)!); });

  // Patches, sized by their lines.
  const byId = new Map(caps.map(c => [c.id, c]));
  const patches = new Map<string, Patch>();
  for (const c of caps) {
    const outline = blob(c.id, Math.max(FLOOR_LINES, c.lines) * AREA);
    const xs = outline.map(p => p.x), zs = outline.map(p => p.z);
    patches.set(c.id, { id: c.id, layer: layer.get(c.id)!, x: 0, z: 0, r: Math.sqrt(Math.max(FLOOR_LINES, c.lines) * AREA / Math.PI), outline,
      half: { w: Math.max(...xs.map(Math.abs)), h: Math.max(...zs.map(Math.abs)) }, label: LABEL(nameOf(c.title)) });
  }
  // A stand-in for a long link is narrow: a road's width and its clearance.
  const width = (id: string) => { const p = patches.get(id); return p ? Math.max(p.half.w * 2, p.label.w) : CLEAR * 2; };
  const gapAfter = (a: string, b: string) => (patches.has(a) && patches.has(b) ? COLUMN_GAP : COLUMN_GAP * 0.45);
  // Heights: each layer as tall as its tallest patch.
  let z = 0;
  rows.forEach((row, l) => {
    const h = Math.max(20, ...row.filter(i => i.real).map(i => patches.get(i.id)!.half.h));
    z += h;
    for (const i of row) if (i.real) patches.get(i.id)!.z = z;
    z += h + LAYER_GAP;
  });
  // x, for each group of linked capabilities on its own: packed, then each slides toward what it is linked to, keeping its
  // order and the open land beside it. Then the groups stand side by side, each as close to the last as the open land allows,
  // layer by layer.
  const x = new Map<string, number>();
  const groupOf = (id: string) => component.get(id.split("~")[0]!)!;
  const order = [...sizes].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const contour = new Map<number, number>();
  for (const k of order) {
    const sub = rows.map(row => row.filter(i => groupOf(i.id) === k));
    for (const row of sub) { let cursor = 0; row.forEach((item, j) => { if (j) cursor += gapAfter(row[j - 1]!.id, item.id); x.set(item.id, cursor + width(item.id) / 2); cursor += width(item.id); }); }
    for (const row of sub) if (row.length) { const mid = (x.get(row[0]!.id)! - width(row[0]!.id) / 2 + x.get(row.at(-1)!.id)! + width(row.at(-1)!.id) / 2) / 2; for (const i of row) x.set(i.id, x.get(i.id)! - mid); }
    for (let sweep = 0; sweep < 40; sweep++) {
      for (const row of sub) {
        if (!row.length) continue;
        const want = row.map(item => {
          const others = [...(up.get(item.id) ?? []), ...(down.get(item.id) ?? [])];
          return others.length ? others.reduce((s, o) => s + x.get(o)!, 0) / others.length : x.get(item.id)!;
        });
        row.forEach((item, j) => x.set(item.id, x.get(item.id)! * 0.5 + want[j]! * 0.5));
        const mid = Math.floor(row.length / 2);
        for (let j = mid + 1; j < row.length; j++) { const a = row[j - 1]!.id, b = row[j]!.id, least = x.get(a)! + width(a) / 2 + gapAfter(a, b) + width(b) / 2; if (x.get(b)! < least) x.set(b, least); }
        for (let j = mid - 1; j >= 0; j--) { const a = row[j]!.id, b = row[j + 1]!.id, most = x.get(b)! - width(b) / 2 - gapAfter(a, b) - width(a) / 2; if (x.get(a)! > most) x.set(a, most); }
      }
    }
    // Beside what is already placed, layer by layer: the open land between layers is wide enough for a group to tuck in under
    // a wider layer above it.
    let shift = -Infinity;
    sub.forEach((row, l) => {
      if (!row.length) return;
      const left = x.get(row[0]!.id)! - width(row[0]!.id) / 2;
      if (contour.has(l)) shift = Math.max(shift, contour.get(l)! + COLUMN_GAP * 1.4 - left);
    });
    if (shift === -Infinity) shift = 0;
    sub.forEach((row, l) => {
      for (const i of row) x.set(i.id, x.get(i.id)! + shift);
      if (row.length) contour.set(l, Math.max(contour.get(l) ?? -Infinity, x.get(row.at(-1)!.id)! + width(row.at(-1)!.id) / 2));
    });
  }
  for (const [id, p] of patches) p.x = x.get(id)!;
  for (const p of patches.values()) p.outline = p.outline.map(q => ({ x: q.x + p.x, z: q.z + p.z }));
  void byId;
  return { patches, layers: rows.map(r => r.filter(i => i.real).map(i => i.id)), crossings: bestCross };
}

/** Cumulative length along a closed outline, and the point and direction at a length. */
function arc(outline: P[]) {
  const cum = [0];
  for (let i = 1; i <= outline.length; i++) cum.push(cum[i - 1]! + dist(outline[i - 1]!, outline[i % outline.length]!));
  const total = cum.at(-1)!;
  const at = (s: number) => {
    s = ((s % total) + total) % total;
    let i = 0;
    while (cum[i + 1]! < s) i++;
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!, t = (s - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
    const l = dist(a, b) || 1;
    return { p: along(a, b, t), tangent: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
  };
  /** The length at which a ray from the centre at angle `t` leaves the outline. */
  const ofAngle = (c: P, t: number) => {
    const d = { x: Math.cos(t), z: Math.sin(t) };
    let best = 0, far = -1;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
      const ex = b.x - a.x, ez = b.z - a.z, den = d.x * ez - d.z * ex;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((a.x - c.x) * ez - (a.z - c.z) * ex) / den, v = ((a.x - c.x) * d.z - (a.z - c.z) * d.x) / den;
      if (u > 0 && v >= 0 && v <= 1 && u > far) { far = u; best = cum[i]! + v * (cum[i + 1]! - cum[i]!); }
    }
    return best;
  };
  return { total, at, ofAngle, cum };
}
export function outlineArc(outline: P[]) { return arc(outline); }

/** The outward normal of a counter-clockwise or clockwise outline at a tangent, pointing away from the centre. */
function outward(c: P, p: P, tangent: P): P {
  const n = { x: tangent.z, z: -tangent.x };
  return (p.x - c.x) * n.x + (p.z - c.z) * n.z >= 0 ? n : { x: -n.x, z: -n.z };
}

/** Lays the gates and routes every road. `land` says whether a plan point is on the island; docks are plan points on the coast. */
export function route(patches: Map<string, Patch>, wants: readonly Want[], land: (p: P) => boolean, docks: readonly P[]): Routed {
  // Twice: first with each gate facing where its link starts, then with each facing where its road was found to come in, so
  // no road has to bend round a patch to reach its gap.
  const first = routeOnce(patches, wants, land, docks);
  const toward = new Map<string, P>();
  for (const [key, g] of first.gates) {
    const pts = first.paths.get(key), p = patches.get(g.patch)!;
    if (!pts) continue;
    const reach = Math.max(p.half.w, p.half.h) + APPROACH + 50;
    let at = pts[0]!;
    for (let i = pts.length - 3; i >= 0; i--) if (dist(pts[i]!, p) > reach) { at = pts[i]!; break; }
    toward.set(key, at);
  }
  return routeOnce(patches, wants, land, docks, toward);
}

function routeOnce(patches: Map<string, Patch>, wants: readonly Want[], land: (p: P) => boolean, docks: readonly P[], toward = new Map<string, P>()): Routed {
  const where = (e: End): P => e.kind === "patch" ? patches.get(e.id)! : docks[e.dock]!;
  // Gates: on each called patch, one per link, at the outline facing where the link comes from, spread so they never meet.
  const gates = new Map<string, Gate>();
  const exits = new Map<string, { at: P; out: P; reach?: number }>();
  const incoming = new Map<string, Want[]>();
  for (const w of wants) if (w.to.kind === "patch") incoming.set(w.to.id, [...(incoming.get(w.to.id) ?? []), w]);
  for (const [id, ws] of incoming) {
    const p = patches.get(id)!, a = arc(p.outline);
    // Where each comes from: its caller's way out, roughly, or its dock.
    const wantS = ws.map(w => { const src = toward.get(w.key) ?? where(w.from); return a.ofAngle(p, Math.atan2(src.z - p.z, src.x - p.x)); });
    const order = ws.map((_, i) => i).sort((i, j) => wantS[i]! - wantS[j]!);
    const s = order.map(i => wantS[i]!);
    // Spread so every pair of neighbours round the outline is a spacing apart, each moving as little as it can: the circle is
    // cut at its widest gap, and the gates along it are fitted in order (an isotonic fit of each less k spacings).
    const space = Math.min(GATE_SPACING, a.total / Math.max(1, s.length) * 0.9);
    if (s.length > 1) {
      const n = s.length;
      let cut = 0, widest = -1;
      for (let i = 0; i < n; i++) { const gap = i === n - 1 ? s[0]! + a.total - s[n - 1]! : s[i + 1]! - s[i]!; if (gap > widest) { widest = gap; cut = (i + 1) % n; } }
      const run = Array.from({ length: n }, (_, k) => { const i = (cut + k) % n; return s[i]! + (i < cut ? a.total : 0); });
      const y = run.map((v, k) => v - k * space);
      // Pool adjacent violators: blocks of equal value, each the mean of what it pools.
      const blocks: { sum: number; count: number }[] = [];
      for (const v of y) {
        blocks.push({ sum: v, count: 1 });
        while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.count > blocks.at(-1)!.sum / blocks.at(-1)!.count) { const b = blocks.pop()!; blocks.at(-1)!.sum += b.sum; blocks.at(-1)!.count += b.count; }
      }
      const fitted = blocks.flatMap(b => Array(b.count).fill(b.sum / b.count) as number[]);
      for (let k = 0; k < n; k++) s[(cut + k) % n] = fitted[k]! + k * space;
    }
    order.forEach((i, k) => {
      const w = ws[i]!, at = a.at(s[k]!), out = outward(p, at.p, at.tangent);
      gates.set(w.key, { key: w.key, patch: id, at: at.p, out, along: at.tangent, s: ((s[k]! % a.total) + a.total) % a.total,
        approach: { x: at.p.x + out.x * APPROACH, z: at.p.z + out.z * APPROACH }, inner: { x: at.p.x - out.x * GAP * 0.6, z: at.p.z - out.z * GAP * 0.6 } });
    });
  }
  // Each caller's one way out: toward the middle of what it calls, at the outline, clear of its own gates.
  const outgoing = new Map<string, Want[]>();
  for (const w of wants) if (w.from.kind === "patch") outgoing.set(w.from.id, [...(outgoing.get(w.from.id) ?? []), w]);
  for (const [id, ws] of outgoing) {
    const p = patches.get(id)!, a = arc(p.outline);
    const targets = ws.map(w => w.to.kind === "patch" ? gates.get(w.key)!.approach : docks[w.to.dock]!);
    const mid = { x: targets.reduce((s, t) => s + t.x, 0) / targets.length, z: targets.reduce((s, t) => s + t.z, 0) / targets.length };
    let s = a.ofAngle(p, Math.atan2(mid.z - p.z, mid.x - p.x));
    const own = [...gates.values()].filter(g => g.patch === id).map(g => g.s);
    for (let k = 0; k < 60; k++) {
      const near = own.find(g => { const d = Math.abs(((s - g) % a.total + a.total * 1.5) % a.total - a.total / 2); return d < GATE_SPACING; });
      if (near === undefined) break;
      s += ((s - near) % a.total + a.total * 1.5) % a.total - a.total / 2 >= 0 ? 4 : -4;
    }
    const at = a.at(s);
    exits.set(id, { at: at.p, out: outward(p, at.p, at.tangent) });
  }

  // The grid the roads are found on.
  const C = 3;
  const all = [...patches.values()].flatMap(p => p.outline).concat(docks);
  const x0 = Math.min(...all.map(p => p.x)) - 200, x1 = Math.max(...all.map(p => p.x)) + 200;
  const z0 = Math.min(...all.map(p => p.z)) - 200, z1 = Math.max(...all.map(p => p.z)) + 200;
  const W = Math.ceil((x1 - x0) / C), H = Math.ceil((z1 - z0) / C);
  const cell = (p: P) => Math.max(0, Math.min(W - 1, Math.floor((p.x - x0) / C))) + Math.max(0, Math.min(H - 1, Math.floor((p.z - z0) / C))) * W;
  const centreOf = (i: number): P => ({ x: x0 + (i % W + 0.5) * C, z: z0 + (Math.floor(i / W) + 0.5) * C });
  const blocked = new Uint8Array(W * H), near = new Float32Array(W * H);
  // Off the land is no way, nor inside a patch or a name, with their clearance.
  for (let i = 0; i < W * H; i++) if (!land(centreOf(i))) blocked[i] = 1;
  const inside = (p: P, poly: P[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]!, b = poly[j]!; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
  const segDist = (p: P, a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)); return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz); };
  for (const p of patches.values()) {
    const reach = Math.max(p.half.w, p.label.w / 2) + CLEAR + 30, i0 = cell({ x: p.x - reach, z: p.z - reach }), i1 = cell({ x: p.x + reach, z: p.z + reach });
    for (let j = Math.floor(i0 / W); j <= Math.floor(i1 / W); j++) for (let i = i0 % W; i <= i1 % W; i++) {
      const k = i + j * W, q = centreOf(k);
      let d = Infinity;
      if (inside(q, p.outline)) d = 0;
      else for (let m = 0; m < p.outline.length; m += 2) d = Math.min(d, segDist(q, p.outline[m]!, p.outline[(m + 2) % p.outline.length]!));
      const lx = Math.max(0, Math.abs(q.x - p.x) - p.label.w / 2), lz = Math.max(0, Math.abs(q.z - p.z) - p.label.h / 2);
      d = Math.min(d, Math.hypot(lx, lz));
      if (d < CLEAR) blocked[k] = 1;
      else if (d < CLEAR + 24) near[k] = Math.max(near[k]!, (CLEAR + 24 - d) / 24);
    }
  }
  // A gate's way in runs straight out from its gap until it is clear of every patch and name, so a gap beside a wide name
  // still has its road; a caller's way out the same.
  const clearOut = (at: P, out: P) => {
    let d = APPROACH;
    while (d < 120 && blocked[cell({ x: at.x + out.x * d, z: at.z + out.z * d })]) d += C;
    return d === APPROACH ? d : d + C * 1.5;
  };
  for (const g of gates.values()) { const d = clearOut(g.at, g.out); g.approach = { x: g.at.x + g.out.x * d, z: g.at.z + g.out.z * d }; }
  for (const e of exits.values()) e.reach = clearOut(e.at, e.out);
  // A gate's way in and a caller's way out are kept for their own roads.
  const reserved = new Int32Array(W * H).fill(-1);
  const stubs: { group: string; from: P; to: P }[] = [];
  const groupOf = (w: Want) => w.from.kind === "patch" ? `p:${w.from.id}` : `d:${w.from.dock}`;
  const groups = [...new Set(wants.map(groupOf))];
  for (const w of wants) {
    const g = gates.get(w.key);
    if (g) stubs.push({ group: groupOf(w), from: g.approach, to: g.at });
  }
  for (const [id, e] of exits) stubs.push({ group: `p:${id}`, from: e.at, to: { x: e.at.x + e.out.x * e.reach!, z: e.at.z + e.out.z * e.reach! } });
  for (const s of stubs) {
    const gi = groups.indexOf(s.group);
    for (let t = 0; t <= 1; t += 0.05) { const q = along(s.from, s.to, t); for (const dx of [-C, 0, C]) for (const dz of [-C, 0, C]) { const k = cell({ x: q.x + dx, z: q.z + dz }); reserved[k] = reserved[k] === -1 || reserved[k] === gi ? gi : -2; blocked[k] = 0; } }
  }
  // A dock is on the coast: its road comes in straight toward the plan's middle until it is well on the land.
  const middle = { x: [...patches.values()].reduce((s, p) => s + p.x, 0) / patches.size, z: [...patches.values()].reduce((s, p) => s + p.z, 0) / patches.size };
  for (const d of docks) {
    const l = dist(d, middle) || 1, u = { x: (middle.x - d.x) / l, z: (middle.z - d.z) / l };
    let onLand = 0;
    for (let r = 0; r < l && onLand < 8; r += C) {
      const q = { x: d.x + u.x * r, z: d.z + u.z * r };
      if (land(q)) onLand++;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const k = cell({ x: q.x + dx * C, z: q.z + dz * C }); if (!land(centreOf(k)) || r < 4 * C) blocked[k] = 0; }
    }
  }

  const used = new Int32Array(W * H).fill(-1);
  const crowd = new Float32Array(W * H);
  const mark = (pts: P[], gi: number) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, n = Math.ceil(dist(a, b) / (C * 0.5));
      for (let t = 0; t <= n; t++) {
        const k = cell(along(a, b, t / Math.max(1, n)));
        if (used[k] === -1) used[k] = gi; else if (used[k] !== gi) used[k] = -3;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const m = k + dx + dz * W; if (m >= 0 && m < W * H) crowd[m] = Math.max(crowd[m]!, 1 - Math.hypot(dx, dz) / 3); }
      }
    }
  };
  // A cell's cost for a road of group gi: plain land 1, more near patches, much more along another group's road, little along
  // its own group's (so its roads share a trunk), and none through another's reserved way.
  const stepCost = (k: number, gi: number) => {
    if (blocked[k]) return Infinity;
    if (reserved[k] !== -1 && reserved[k] !== gi) return Infinity;
    if (used[k] === gi) return 0.35;
    let c = 1 + near[k]! * 2.5;
    if (used[k] !== -1) c += 14;
    else c += crowd[k]! * 2.5;
    return c;
  };
  const astar = (starts: number[], goal: number, gi: number): number[] | undefined => {
    const N = W * H, g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap: [number, number][] = [];
    const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
    const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
    const gp = centreOf(goal), h = (k: number) => dist(centreOf(k), gp) / C * 0.35;
    for (const s of starts) { g[s] = 0; push(h(s), s); }
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === goal) break;
      const kx = k % W, kz = Math.floor(k / W);
      for (const [dx, dz] of steps) {
        const nx = kx + dx, nz = kz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const m = nx + nz * W, c = m === goal ? 1 : stepCost(m, gi);
        if (c === Infinity) continue;
        const ng = g[k]! + c * (dx && dz ? Math.SQRT2 : 1);
        if (ng < g[m]!) { g[m] = ng; from[m] = k; push(ng + h(m), m); }
      }
    }
    if (from[goal] === -1 && !starts.includes(goal)) return undefined;
    const path = [goal];
    while (!starts.includes(path.at(-1)!)) path.push(from[path.at(-1)!]!);
    return path.reverse();
  };
  // A cell path pulled taut where the land allows (no patch, no name, no other road it did not already cross), then smoothed.
  const clearLine = (a: P, b: P, gi: number, others: number) => {
    const n = Math.ceil(dist(a, b) / (C * 0.5));
    let crossed = 0;
    for (let t = 0; t <= n; t++) { const k = cell(along(a, b, t / Math.max(1, n))); if (stepCost(k, gi) === Infinity) return false; if (used[k] !== -1 && used[k] !== gi) crossed++; }
    return crossed <= others;
  };
  const taut = (cells: number[], gi: number): P[] => {
    const pts = cells.map(centreOf), out = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        let others = 0;
        for (let m = i; m <= j; m++) if (used[cells[m]!] !== -1 && used[cells[m]!] !== gi) others++;
        if (clearLine(pts[i]!, pts[j]!, gi, others)) break;
      }
      out.push(pts[j]!);
      i = j;
    }
    return out;
  };
  const smooth = (pts: P[], rounds = 3): P[] => {
    let q = pts;
    for (let r = 0; r < rounds; r++) {
      if (q.length < 3) return q;
      const next = [q[0]!];
      for (let i = 0; i + 1 < q.length; i++) { next.push(along(q[i]!, q[i + 1]!, 0.25), along(q[i]!, q[i + 1]!, 0.75)); }
      next.push(q.at(-1)!);
      q = next;
    }
    return q;
  };
  const resample = (pts: P[], step: number): P[] => {
    const out = [pts[0]!];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, l = dist(a, b);
      let s = step - carry;
      while (s < l) { out.push(along(a, b, s / l)); s += step; }
      carry = l - (s - step);
    }
    if (dist(out.at(-1)!, pts.at(-1)!) > 1e-6) out.push(pts.at(-1)!);
    return out;
  };

  // Each group's roads, the groups with the shortest roads first; within a group, the farthest gate first.
  const trees: Tree[] = [];
  const paths = new Map<string, P[]>();
  const unrouted: string[] = [];
  const startOf = (w: Want): P => w.from.kind === "patch" ? (() => { const e = exits.get(w.from.id)!; return { x: e.at.x + e.out.x * e.reach!, z: e.at.z + e.out.z * e.reach! }; })() : docks[w.from.dock]!;
  const endOf = (w: Want): P => w.to.kind === "patch" ? gates.get(w.key)!.approach : docks[w.to.dock]!;
  const groupLength = (g: string) => wants.filter(w => groupOf(w) === g).reduce((s, w) => s + dist(startOf(w), endOf(w)), 0);
  const ordered = [...groups].sort((a, b) => groupLength(a) - groupLength(b));
  for (const group of ordered) {
    const gi = groups.indexOf(group), ws = wants.filter(w => groupOf(w) === group).sort((a, b) => dist(startOf(b), endOf(b)) - dist(startOf(a), endOf(a)));
    const first = ws[0]!;
    // The root: the caller's way out (its outline point, then straight out), or the dock.
    const head: P[] = first.from.kind === "patch" ? [exits.get(first.from.id)!.at] : [];
    const tree: Tree = { group, pts: [], parent: [], carried: [] };
    const add = (pts: P[], parent: number) => { let prev = parent; for (const p of pts) { tree.pts.push(p); tree.parent.push(prev); tree.carried.push(new Set()); prev = tree.pts.length - 1; } return prev; };
    for (const w of ws) {
      const goal = cell(endOf(w));
      let leaf: number;
      if (!tree.pts.length) {
        const cells = astar([cell(startOf(w))], goal, gi);
        if (!cells) { unrouted.push(w.key); continue; }
        const line = smooth([...head, startOf(w), ...taut(cells, gi).slice(1, -1), endOf(w)], 3);
        leaf = add(resample(line, 2), -1);
      } else {
        // From the gate back to the nearest point of the group's network, so the road splits off the trunk.
        const onTree = new Map<number, number>();
        tree.pts.forEach((p, i) => { if (tree.parent[i] !== -1 || head.length === 0) onTree.set(cell(p), i); });
        const cells = astar([...onTree.keys()], goal, gi);
        if (!cells) { unrouted.push(w.key); continue; }
        const join = onTree.get(cells[0]!)!;
        // The branch leaves its trunk a little way back toward the root, so it parts at an easy angle.
        let base = join;
        for (let k = 0; k < 4 && tree.parent[base]! >= 0; k++) base = tree.parent[base]!;
        const line = smooth([tree.pts[base]!, tree.pts[join]!, ...taut(cells, gi).slice(1, -1), endOf(w)], 3).slice(1);
        const cut = resample(line, 2);
        // Where the smoothing came back over the trunk, the branch starts from the trunk point it left from.
        leaf = add(cut.slice(1), base);
      }
      for (let i = leaf; i !== -1; i = tree.parent[i]!) tree.carried[i]!.add(w.key);
      const pts: P[] = [];
      for (let i = leaf; i !== -1; i = tree.parent[i]!) pts.push(tree.pts[i]!);
      pts.reverse();
      if (w.to.kind === "patch") { const g = gates.get(w.key)!; pts.push(g.at, g.inner); }
      paths.set(w.key, pts);
      mark(pts, gi);
    }
    if (tree.pts.length) trees.push(tree);
  }
  return { trees, paths, gates, exits, unrouted };
}

/** A tree's roads as polylines, each a run of points carrying the same links, so a shared stretch is drawn once. */
export function runsOf(tree: Tree, paths: Map<string, P[]>, gates: Map<string, Gate>): { pts: P[]; links: string[] }[] {
  const children = new Map<number, number[]>();
  tree.parent.forEach((p, i) => children.set(p, [...(children.get(p) ?? []), i]));
  const runs: { pts: P[]; links: string[] }[] = [];
  const key = (i: number) => [...tree.carried[i]!].sort().join();
  const walk = (start: number, from: P | undefined) => {
    let i = start;
    const pts = from ? [from, tree.pts[i]!] : [tree.pts[i]!];
    for (;;) {
      const next = children.get(i) ?? [];
      if (next.length !== 1 || key(next[0]!) !== key(i)) {
        runs.push({ pts, links: [...tree.carried[i]!] });
        for (const n of next) walk(n, tree.pts[i]);
        return;
      }
      i = next[0]!;
      pts.push(tree.pts[i]!);
    }
  };
  for (const r of children.get(-1) ?? []) walk(r, undefined);
  // The way in through each gate, from its approach point, belongs to that link alone.
  for (const [k, g] of gates) if (paths.has(k)) runs.push({ pts: [g.approach, g.at, g.inner], links: [k] });
  return runs;
}
