/** Round 13's layout tool: round 11's (h-quiet-roads/tools/layout.ts), with three things added. MIN gives every territory
 * at least that many cells, taken from the largest; SEARCH=net anneals from a start arrangement (START, round 11's by
 * default) with each change scored on the shared road network routed over it (netScore below); and NET_COST's prices
 * (network.ts: `shareEntrance`, `edge`) are routed with and written into the arrangement, so the page routes with them too.
 * It writes layouts/<NAME>.json and layouts/<NAME>.measures.json, and prints each territory's room (the largest disc it
 * holds). Run from the checkout root, for example the chosen arrangement:
 *   REGROW=1 SEARCH=net MIN=5 ITER=400 SEED=43 START=docs/design/capability-tree-3d/m-height/layouts/net5.json \
 *   NET_COST='{"shareEntrance":1,"edge":0.8}' NAME=chosen node --import tsx docs/design/capability-tree-3d/m-height/tools/layout.ts
 *
 * Round 10's header, as it was:
 * Round 10's layout tool: round 9's, re-run on a fresh snapshot, and its links routed as one shared road network
 * (network.ts, measureNet below) as well as round 9's one road each off a ring road (so the two compare on one land).
 * Round 9's method, unchanged: round 8's link layout, with the territories shrunk away from the coast: on the map's own cutter
 * run finer (layout-core.ts's CUT), a band of OPEN land inside the coast and a wider open mouth where the main road comes
 * ashore belong to no territory, and every territory's cells, still shared out by its lines of code, lie inside them. It
 * measures that arrangement against the map's own and round 8's, and writes what the page and the plain diagrams draw:
 *   layout.json    each cell's owner (or open land), and where each arrival enters its territory
 *   measures.json  the arrangements measured, with the lines the plain diagrams draw
 *
 * The method (README.md, "The layout method"):
 * 0. Open land: every cell whose seed lies within BAND of the coast, or within MOUTH of where the main road comes ashore,
 *    is open; the rest, the territories' land, is shared out by lines of code (largest remainder, at least one cell each).
 * 1. Interfaces on the open land: every capability another story calls (the map's own selection lanes, `selectionLanes`),
 *    and the one that calls out (Connection by address, to Keys), is seeded on a cell beside the open land, in a ring order.
 * 2. Internals inland: the rest are seeded on cells further in.
 * 3. Every territory grows from its seed, a cell at a time, the one furthest short of its count taking its free
 *    neighbouring cell nearest its seed, until each holds exactly the cells the map gives it (its lines of code).
 * 4. A search (simulated annealing, seeded so it repeats) changes the ring order, the ring's turn and the inland seeds,
 *    and keeps a change when it lowers the score: crossings, links over a third territory, line length and the ring
 *    road's length, less a reward for links between neighbours.
 * 5. Round 9's roads, measured for comparison: a ring road through the open land, halfway between the coast and the
 *    territories (at most RING_OFF from the coast), both ways from the mouth; a road off it to each interface.
 * 6. Round 10's network on the chosen arrangement: every link routed over one lattice of roads (network.ts), the arrivals
 *    from the mouth. layout.json's landings are where each arrival enters the territory it calls.
 * REUSE=1 skips the search and routes the arrangement layout.json holds; NET_COST='{"third":25}' tries other prices. */
import { readFileSync, writeFileSync } from "node:fs";
import { forestScene, selectionLanes } from "../../../../../packages/forest/src/index.ts";
import { workStates } from "../../../../../packages/arc-surface/src/index.ts";
import { islandCoast } from "../../../../../packages/forest-world/src/geometry.ts";
import { islandTerritories, onLand, territories, territoryAt, type TerritoryMap } from "../../../../../packages/forest/src/territories/territories.ts";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.ts";
import { relayout, cellEdges, CUT, OPEN, type P } from "./layout-core.ts";
import { network, type BorderSeg, type NetLink } from "./network.ts";

/** The snapshot is round 11's (h-quiet-roads/data.json); round 13 writes into its own folder. */
const DIR = "docs/design/capability-tree-3d/h-quiet-roads";
const HERE = "docs/design/capability-tree-3d/m-height";
const data = JSON.parse(readFileSync(`${DIR}/data.json`, "utf8"));
const STORY: string = data.story.id;
/** Where the map's sea roads come ashore on this island, in its own coordinates, read off the selection's lanes on the page
 * (round 7's dock reading; tools/look.mjs printed them): the one road from the 20 calling stories, and the road out to Keys. */
const HARBOUR = { dock: { x: 62.47, z: 35.49 }, sea: { x: 73.36, z: 45.25 } };
const KEYS = { dock: { x: -51.71, z: 70.59 }, sea: { x: -61.77, z: 80.77 } };

const scene = forestScene(data.map.tree, data.map.changes, workStates([]), data.map.survey);
const island = scene.islands.find((one: { story: string }) => one.story === STORY)!;
const coast = islandCoast(island);
const today: TerritoryMap = islandTerritories(island.land!.territories, coast);
const caps: { id: string; title: string; dependsOn: { id: string; storyId: string; story: string; title: string }[] }[] = data.capabilities;
const own = new Set(caps.map(c => c.id));
const titleOf = new Map(caps.map(c => [c.id, c.title]));
const short = (id: string) => (titleOf.get(id) ?? id).replace(/^\d+ · /, "");

// The links: inside the story (recorded dependsOn, both ends here), and the lanes to and from other stories.
type Link = { from: string; to: string };
const inside: Link[] = caps.flatMap(c => c.dependsOn.filter(d => own.has(d.id)).map(d => ({ from: c.id, to: d.id })));
const lanes = selectionLanes(scene, STORY);
const arriving = new Map<string, number>(), leaving = new Map<string, number>();
for (const l of lanes) if (l.dir === "down") arriving.set(l.to, (arriving.get(l.to) ?? 0) + 1); else leaving.set(l.from, (leaving.get(l.from) ?? 0) + 1);
const coastal = caps.map(c => c.id).filter(id => arriving.has(id) || leaving.has(id));
const inland = caps.map(c => c.id).filter(id => !coastal.includes(id));

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const toSegD = (p: P, a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)); return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz); };
const toCoast = (p: P) => Math.min(...coast.flatMap(l => l.map((a, i) => toSegD(p, a, l[(i + 1) % l.length]!))));

// The cut: the map's own cutter, finer. Open land first, then each territory's cells by its lines of code.
/** Open land's depth inside the coast, the mouth's reach round the harbour's landfall, and the open land round the way out's
 * landfall (Keys), in ground units. Round 11: no band (BAND=0), so open land is only where a road comes ashore. */
const BAND = Number(process.env.BAND ?? 0), MOUTH = Number(process.env.MOUTH ?? 25), KEYS_OPEN = Number(process.env.KEYS_OPEN ?? 11);
/** How deep inside the coast an interface's seed may lie (round 10's band), now that the band is the territories' land. */
const FRONT = Number(process.env.FRONT ?? 9);
/** Round 13: the fewest cells a territory may hold (1 is round 11's: sized by lines of code alone). */
const MIN = Number(process.env.MIN ?? 1);
const fine: TerritoryMap = territories(island.land!.territories, coast, CUT);
const cells = fine.cells;
const N = cells.length;
const isOpen = cells.map(c => toCoast(c.site) < BAND || dist(c.site, HARBOUR.dock) < MOUTH || dist(c.site, KEYS.dock) < KEYS_OPEN);
const owned = isOpen.filter(o => !o).length;
const shares = fine.territories.map(t => ({ id: t.capability!, lines: t.lines }));
const counts = new Map<string, number>();
{ // Largest remainder, at least one cell each, as the map apportions its own cut.
  const total = shares.reduce((s, t) => s + t.lines, 0), spare = owned - shares.length;
  const raw = shares.map(t => ({ id: t.id, want: t.lines / total * spare }));
  raw.forEach(r => counts.set(r.id, 1 + Math.floor(r.want)));
  let left = owned - [...counts.values()].reduce((s, n) => s + n, 0);
  for (const r of [...raw].sort((a, b) => (b.want % 1) - (a.want % 1))) { if (left-- <= 0) break; counts.set(r.id, counts.get(r.id)! + 1); }
  // Round 13, MIN: no territory holds fewer than MIN cells, so each has room for its symbol, its name and its gates; the
  // cells it is given are taken one at a time from whichever territory is then the largest.
  for (const [id] of counts) while (counts.get(id)! < MIN) {
    const largest = [...counts].reduce((a, b) => b[1] > a[1] ? b : a)[0];
    counts.set(largest, counts.get(largest)! - 1); counts.set(id, counts.get(id)! + 1);
  }
}
const todayOwners = today.cells.map(c => today.territories[c.territory]!.capability!);
/** A cell of the territories' land beside the open land: where an interface's gate can open onto the ring road. */
const isFrontier = cells.map((c, i) => !isOpen[i] && (c.neighbours.some(n => isOpen[n]) || toCoast(c.site) < FRONT));
const angleOf = (p: P) => Math.atan2(p.z, p.x);

// The coast, as one walk round its longest loop, a point every half unit, each pulled a little inland.
const loop = [...coast].sort((a, b) => b.length - a.length)[0]!;
const walk: { p: P; s: number }[] = [];
let around = 0;
for (let i = 0; i < loop.length; i++) {
  const a = loop[i]!, b = loop[(i + 1) % loop.length]!, l = dist(a, b);
  for (let t = 0; t < l; t += 0.5) {
    const q = { x: a.x + (b.x - a.x) * t / l, z: a.z + (b.z - a.z) * t / l }, r = Math.hypot(q.x, q.z) || 1;
    walk.push({ p: { x: q.x - q.x / r * 1.2, z: q.z - q.z / r * 1.2 }, s: around + t });
  }
  around += l;
}
const COAST_LENGTH = around;
/** The ring road: for each step along the coast, halfway in across the open land to the territories (at most RING_OFF in),
 * smoothed; the same steps as the coast walk, so a place along the coast and along the road share one `s`. */
const RING_OFF = Number(process.env.RING_OFF ?? 7);
const nearestCell = (p: P) => cells.reduce((b, c) => dist(c.site, p) < dist(b.site, p) ? c : b);
const ringRaw = walk.map(w => {
  const r = Math.hypot(w.p.x, w.p.z) || 1, u = { x: -w.p.x / r, z: -w.p.z / r };
  let d = 0;
  while (d < 60 && isOpen[nearestCell({ x: w.p.x + u.x * d, z: w.p.z + u.z * d }).index]) d += 0.5;
  const k = Math.max(2.5, Math.min(RING_OFF, d / 2));
  return { x: w.p.x + u.x * k, z: w.p.z + u.z * k, depth: d };
});
/** Smoothed, then each point kept at least RING_CLEAR inside the coast (smoothing would pull it out across the bays). */
const RING_CLEAR = 3;
const ring: P[] = ringRaw.map((_, i) => {
  let x = 0, z = 0;
  for (let k = -5; k <= 5; k++) { const q = ringRaw[(i + k + ringRaw.length) % ringRaw.length]!; x += q.x; z += q.z; }
  let p = { x: x / 11, z: z / 11 };
  const r = Math.hypot(p.x, p.z) || 1;
  for (let step = 0; step < 40 && (!onLand(p, coast) || toCoast(p) < RING_CLEAR); step++) p = { x: p.x - p.x / r * 0.4, z: p.z - p.z / r * 0.4 };
  return p;
});
const sAt = (p: P) => walk.reduce((best, w) => dist(w.p, p) < dist(best.p, p) ? w : best).s;
const ringAt = (p: P) => ring.reduce((b, q, i) => dist(q, p) < dist(ring[b]!, p) ? i : b, 0);
const harbourS = sAt(HARBOUR.dock), keysS = sAt(KEYS.dock);
/** Along-the-coast distance between two places on the walk, the short way round. */
const along = (a: number, b: number) => { const d = Math.abs(a - b) % COAST_LENGTH; return Math.min(d, COAST_LENGTH - d); };

// ── Growing an arrangement from seeds ─────────────────────────────────────────────────────────────────────────────────
function grow(seeds: Map<string, number>): string[] | undefined {
  const owner = new Array<string | undefined>(N).fill(undefined).map((_, c) => isOpen[c] ? OPEN : undefined);
  const have = new Map<string, number>();
  for (const [id, cell] of seeds) { if (owner[cell] !== undefined) return undefined; owner[cell] = id; have.set(id, 1); }
  const ids = [...seeds.keys()];
  let left = owned - ids.length;
  while (left > 0) {
    let best: string | undefined, short = -Infinity, take = -1;
    for (const id of ids) {
      const want = counts.get(id)!, got = have.get(id)!, need = (want - got) / want;
      if (need <= short) continue;
      // Its free neighbouring cell nearest its seed.
      let cell = -1, d = Infinity;
      const seed = cells[seeds.get(id)!]!.site;
      for (let c = 0; c < N; c++) if (owner[c] === id) for (const n of cells[c]!.neighbours) if (owner[n] === undefined) { const dd = dist(cells[n]!.site, seed); if (dd < d) { d = dd; cell = n; } }
      if (cell < 0) continue;
      best = id; short = need; take = cell;
    }
    if (best === undefined) break;
    owner[take] = best; have.set(best, have.get(best)! + 1); left--;
  }
  if (left > 0) return undefined;
  balance(owner as string[], seeds);
  return owner as string[];
}

/** Whether `id`'s cells stay one piece without `cell`. */
function staysWhole(owner: readonly string[], id: string, cell: number): boolean {
  const mine = owner.map((o, c) => o === id && c !== cell ? c : -1).filter(c => c >= 0);
  if (mine.length === 0) return false;
  const seen = new Set([mine[0]!]), queue = [mine[0]!];
  while (queue.length) { const c = queue.pop()!; for (const n of cells[c]!.neighbours) if (n !== cell && owner[n] === id && !seen.has(n)) { seen.add(n); queue.push(n); } }
  return seen.size === mine.length;
}

/** Hands cells along a chain of neighbouring territories until every territory holds exactly its count. */
function balance(owner: string[], seeds: Map<string, number>): void {
  for (let round = 0; round < 200; round++) {
    const have = new Map<string, number>();
    for (const o of owner) if (o !== OPEN) have.set(o, (have.get(o) ?? 0) + 1);
    const under = [...counts].find(([id, n]) => (have.get(id) ?? 0) < n)?.[0];
    if (under === undefined) return;
    // The nearest territory with a cell to spare, through neighbouring territories.
    const next = new Map<string, Set<string>>();
    for (const [key] of cellEdges(cells)) { const [a, b] = key.split(":").map(Number) as [number, number]; if (owner[a] !== owner[b] && owner[a] !== OPEN && owner[b] !== OPEN) { (next.get(owner[a]!) ?? next.set(owner[a]!, new Set()).get(owner[a]!)!).add(owner[b]!); (next.get(owner[b]!) ?? next.set(owner[b]!, new Set()).get(owner[b]!)!).add(owner[a]!); } }
    const back = new Map<string, string>([[under, ""]]), queue = [under];
    let spare: string | undefined;
    while (queue.length && !spare) { const t = queue.shift()!; for (const n of next.get(t) ?? []) if (!back.has(n)) { back.set(n, t); if ((have.get(n) ?? 0) > counts.get(n)!) { spare = n; break; } queue.push(n); } }
    if (!spare) return;
    const chain: string[] = [];
    for (let t: string = spare; t !== ""; t = back.get(t)!) chain.push(t);
    // chain runs spare → … → under: each gives the next one cell on their shared border.
    for (let i = 0; i + 1 < chain.length; i++) {
      const giver = chain[i]!, taker = chain[i + 1]!, seed = cells[seeds.get(taker)!]!.site;
      const options = owner.map((o, c) => o === giver && c !== seeds.get(giver) && cells[c]!.neighbours.some(n => owner[n] === taker) ? c : -1).filter(c => c >= 0 && staysWhole(owner, giver, c));
      if (!options.length) return;
      const c = options.reduce((a, b) => dist(cells[a]!.site, seed) < dist(cells[b]!.site, seed) ? a : b);
      owner[c] = taker;
    }
  }
}

// ── Measuring an arrangement ─────────────────────────────────────────────────────────────────────────────────────────
type Path = { key: string; kind: "inside" | "arrival" | "out"; from: string; to: string; points: P[]; links: number; gates: P[]; third: string[]; borders: number; neighbours: boolean; open: boolean };
export type Measured = {
  name: string; crossings: number; length: number; insideLength: number; arrivalLength: number; roadLength: number;
  overThird: number; overThirdBorders: number; neighbours: number; insideLinks: number; worstBorders: number;
  landings: { capability: string; at: P; s: number; lines: number; links: number }[];
  paths: Path[]; plates: { capability: string; title: string; x: number; z: number }[];
};

function segCross(a: P, b: P, c: P, d: P): P | undefined {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { x: a.x + t * r.x, z: a.z + t * r.z } : undefined;
}
const toSeg = (p: P, a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)); return { x: a.x + t * dx, z: a.z + t * dz }; };

export function measure(name: string, map: TerritoryMap, landingsFor: "dock" | "own" | "road"): Measured {
  const plates = capabilityPlates(map);
  const plate = new Map(plates.map(p => [p.capability, { x: p.x, z: p.z } as P]));
  /** The territory under a point: its capability, "open" on open land, undefined off the island. */
  const tAt = (p: P) => !onLand(p, coast) ? undefined : territoryAt(map, p.x, p.z)?.capability ?? "open";
  // Borders between each pair of territories, as segments.
  const between = new Map<string, [P, P][]>();
  for (const b of map.borders) {
    const [x, y] = b.between.map(c => map.territories[map.cells[c]!.territory]?.capability ?? "open") as [string, string];
    const key = [x, y].sort().join("|");
    (between.get(key) ?? between.set(key, []).get(key)!).push([b.from, b.to]);
  }
  /** The gate where a way from `p` to `q` best crosses the border of `a` and `b`: a point on their border, kept off its corners. */
  const gate = (a: string, b: string, p: P, q: P): P | undefined => {
    const segs = between.get([a, b].sort().join("|"));
    if (!segs) return undefined;
    let best: P | undefined, d = Infinity;
    for (const [u, v] of segs) for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const g = { x: u.x + (v.x - u.x) * t, z: u.z + (v.z - u.z) * t }, dd = dist(p, g) + dist(g, q);
      if (dd < d) { d = dd; best = g; }
    }
    return best;
  };
  /** Walks a way, noting each territory it is over in turn, and the points where it crosses from one to the next. */
  const trace = (points: P[]) => {
    const seq: (string | undefined)[] = [], at: P[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!, l = dist(a, b), n = Math.max(1, Math.ceil(l / 0.6));
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }, t = tAt(p);
        if (seq.length === 0 || seq.at(-1) !== t) { seq.push(t); at.push(p); }
      }
    }
    return { seq, at: at.slice(1) };
  };
  const path = (key: string, kind: Path["kind"], from: string, to: string, s: P, e: P, links: number, ends: [string | undefined, string | undefined]): Path => {
    let points = [s, e];
    const [fa, fb] = ends;
    if (fa && fb && fa !== fb) { const g = gate(fa, fb, s, e); if (g) { const direct = trace([s, e]).seq; if (direct.length !== 2 || direct[0] !== fa || direct[1] !== fb) points = [s, g, e]; } }
    const { seq, at } = trace(points);
    const onLandSeq = seq.filter((t): t is string => t !== undefined);
    const third = [...new Set(onLandSeq.filter(t => t !== ends[0] && t !== ends[1] && t !== "open"))];
    const borders = seq.filter((t, i) => i > 0 && t !== undefined && seq[i - 1] !== undefined).length;
    return { key, kind, from, to, points, links, gates: at.filter((p, i) => seq[i] !== undefined && seq[i + 1] !== undefined), third, borders, neighbours: between.has([from, to].sort().join("|")), open: onLandSeq.includes("open") };
  };
  /** A way along given points (an arrival or the way out, by its gate onto the open land). */
  const along3 = (key: string, kind: Path["kind"], from: string, to: string, points: P[], links: number): Path => {
    const { seq, at } = trace(points);
    const borders = seq.filter((t, i) => i > 0 && t !== undefined && seq[i - 1] !== undefined).length;
    return { key, kind, from, to, points, links, gates: at.filter((p, i) => seq[i] !== undefined && seq[i + 1] !== undefined), third: [...new Set(seq.filter((t): t is string => t !== undefined && t !== from && t !== to && t !== "open"))], borders, neighbours: false, open: true };
  };
  const paths: Path[] = [];
  for (const l of inside) paths.push(path(`${l.from}->${l.to}`, "inside", l.from, l.to, plate.get(l.from)!, plate.get(l.to)!, 1, [l.from, l.to]));
  // The arrivals: from the dock (today), or from each interface's own landing on its own coast.
  const landings: Measured["landings"] = [];
  const runs = (id: string) => {
    const out: { s: number; p: P }[][] = [];
    let run: { s: number; p: P }[] = [];
    for (const w of walk) { if (tAt(w.p) === id) run.push(w); else if (run.length) { out.push(run); run = []; } }
    if (run.length) { if (out.length && walk[0] && tAt(walk[0].p) === id) out[0] = [...run, ...out[0]!]; else out.push(run); }
    return out;
  };
  for (const [id, n] of [...arriving, ...[...leaving].map(([k, v]) => [k, -v] as [string, number])]) {
    const out = n < 0, links = Math.abs(n), want = out ? keysS : harbourS, dockP = out ? KEYS.dock : HARBOUR.dock;
    let at: P = dockP, s = want;
    if (landingsFor === "road") {
      // The gate in its outline onto the open land nearest the mouth (or Keys' landfall), a little toward its name; the
      // landing is the ring road's point nearest that gate.
      const name = plate.get(id)!;
      const segs = (between.get([id, "open"].sort().join("|")) ?? []).filter(([u, v]) => onLand(u, coast) && onLand(v, coast) && dist(u, v) > 3.4);
      let gate: P | undefined, cost = Infinity;
      for (const [u, v] of segs) {
        const g = { x: (u.x + v.x) / 2, z: (u.z + v.z) / 2 }, c = along(sAt(g), want) * 0.6 + dist(g, name);
        if (c < cost) { cost = c; gate = g; }
      }
      if (gate) {
        const r = ringAt(gate);
        at = ring[r]!; s = walk[r]!.s;
        landings.push({ capability: id, at, s, lines: 1, links });
        paths.push(out ? along3(`${id}->keys`, "out", id, "keys", [name, gate, at], links) : along3(`harbour->${id}`, "arrival", "harbour", id, [at, gate, name], links));
        continue;
      }
    }
    if (landingsFor === "own") {
      const rs = runs(id);
      if (rs.length) {
        // The stretch of its coast nearest the road, and on it the point a little toward the road from the stretch's middle.
        const run = rs.reduce((a, b) => Math.min(...a.map(w => along(w.s, want))) <= Math.min(...b.map(w => along(w.s, want))) ? a : b);
        const mid = run[Math.floor(run.length / 2)]!;
        at = mid.p; s = mid.s;
      }
    }
    const lp = landings.find(l => dist(l.at, at) < 0.01);
    if (lp) { lp.lines++; lp.links += links; } else landings.push({ capability: landingsFor === "own" ? id : "dock", at, s, lines: 1, links });
    paths.push(out ? path(`${id}->keys`, "out", id, "keys", plate.get(id)!, at, links, [id, tAt(at)]) : path(`harbour->${id}`, "arrival", "harbour", id, at, plate.get(id)!, links, [tAt(at), id]));
  }
  // Crossings between any two ways over the land, not counting where ways meet at a shared end.
  let crossings = 0;
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const A = paths[i]!, B = paths[j]!;
    const endsA = [A.points[0]!, A.points.at(-1)!], endsB = [B.points[0]!, B.points.at(-1)!];
    for (let a = 0; a + 1 < A.points.length; a++) for (let b = 0; b + 1 < B.points.length; b++) {
      const x = segCross(A.points[a]!, A.points[a + 1]!, B.points[b]!, B.points[b + 1]!);
      if (x && ![...endsA, ...endsB].some(e => dist(e, x) < 1.2) && onLand(x, coast)) crossings++;
    }
  }
  const len = (p: Path) => p.points.reduce((s, q, i) => i ? s + dist(p.points[i - 1]!, q) : 0, 0);
  const ins = paths.filter(p => p.kind === "inside");
  // The ring road (road landings): from the mouth along the open land to its furthest landing each way, as drawn.
  let roadLength = 0;
  if (landingsFor === "road") {
    const h = ringAt(HARBOUR.dock), rel = (i: number) => { let d = (i - h) % ring.length; if (d > ring.length / 2) d -= ring.length; if (d < -ring.length / 2) d += ring.length; return d; };
    const stops = landings.filter(l => !leaving.has(l.capability)).map(l => rel(ringAt(l.at)));
    const lo = Math.min(0, ...stops), hi = Math.max(0, ...stops);
    for (let k = lo; k < hi; k++) roadLength += dist(ring[(h + k + ring.length) % ring.length]!, ring[(h + k + 1 + ring.length) % ring.length]!);
  }
  // The coast road (own landings only): from the harbour along the coast, offshore, to its furthest landing each way.
  if (landingsFor === "own") {
    const offs = landings.filter(l => l.capability !== "dock" && !leaving.has(l.capability)).map(l => { let d = (l.s - harbourS) % COAST_LENGTH; if (d > COAST_LENGTH / 2) d -= COAST_LENGTH; if (d < -COAST_LENGTH / 2) d += COAST_LENGTH; return d; });
    roadLength = Math.max(0, ...offs) - Math.min(0, ...offs);
  }
  return {
    name, crossings, paths, plates: plates.map(({ capability, title, x, z }) => ({ capability, title, x, z })), landings, roadLength,
    length: paths.reduce((s, p) => s + len(p), 0), insideLength: ins.reduce((s, p) => s + len(p), 0),
    arrivalLength: paths.filter(p => p.kind !== "inside").reduce((s, p) => s + len(p), 0),
    overThird: ins.filter(p => p.third.length > 0).length, overThirdBorders: ins.filter(p => p.third.length > 0).reduce((s, p) => s + p.borders, 0),
    neighbours: ins.filter(p => p.neighbours).length, insideLinks: ins.length, worstBorders: Math.max(...ins.map(p => p.borders)),
  };
}

const zoneOf = (map: TerritoryMap) => (p: P) => dist(p, HARBOUR.dock) < MOUTH ? "mouth" : (territoryAt(map, p.x, p.z)?.capability ?? "open") === "open" ? "coast" : "inland";
const lengthOf = (line: P[]) => line.reduce((s, q, i) => i ? s + dist(line[i - 1]!, q) : 0, 0);
/** A drawn line's length in each zone: the mouth, the open band along the coast, and inland (in the territories). */
function zones(lines: P[][], zone: (p: P) => string) {
  const out: Record<string, number> = { mouth: 0, coast: 0, inland: 0 };
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, l = dist(a, b), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 0; k < n; k++) out[zone({ x: a.x + (b.x - a.x) * (k + 0.5) / n, z: a.z + (b.z - a.z) * (k + 0.5) / n })]! += l / n;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v)]));
}
// ── The search ───────────────────────────────────────────────────────────────────────────────────────────────────────
let seed = Number(process.env.SEED ?? 8);
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
type Gene = { ring: string[]; turn: number; inland: Map<string, number> };
const coastCells = cells.filter((_, c) => isFrontier[c]).map(c => c.index);
const inlandCells = cells.filter((_, c) => !isFrontier[c] && !isOpen[c]).map(c => c.index);
function seedsOf(g: Gene): Map<string, number> | undefined {
  const seeds = new Map<string, number>();
  const weight = (id: string) => Math.pow(counts.get(id)!, 0.6);
  const total = g.ring.reduce((s, id) => s + weight(id), 0);
  let at = 0;
  const used = new Set<number>();
  for (const id of g.ring) {
    const a = g.turn + (at + weight(id) / 2) / total * 2 * Math.PI;
    at += weight(id);
    const want = { x: Math.cos(a), z: Math.sin(a) };
    const cell = coastCells.filter(c => !used.has(c)).reduce((b, c) => { const p = cells[c]!.site, q = cells[b]!.site, da = Math.abs(Math.atan2(p.x * want.z - p.z * want.x, p.x * want.x + p.z * want.z)), db = Math.abs(Math.atan2(q.x * want.z - q.z * want.x, q.x * want.x + q.z * want.z)); return da < db ? c : b; });
    used.add(cell); seeds.set(id, cell);
  }
  for (const [id, cell] of g.inland) { if (used.has(cell)) return undefined; used.add(cell); seeds.set(id, cell); }
  return seeds;
}
function score(m: Measured, owners: readonly string[]): number {
  const offCoast = coastal.filter(id => !owners.some((o, c) => o === id && isFrontier[c])).length;
  const extra = m.paths.filter(p => p.kind === "inside").reduce((s, p) => s + Math.max(0, p.borders - 1), 0);
  // The way out to Keys should leave near Keys' own road.
  const keysOff = m.landings.filter(l => leaving.has(l.capability)).reduce((s, l) => s + along(l.s, keysS), 0);
  return 14 * m.crossings + 6 * extra + 10 * m.overThird + 0.04 * m.length + 0.07 * m.roadLength + 0.1 * keysOff - 3 * m.neighbours + 500 * offCoast;
}
/** Round 13's score, on the shared network's own measures (round 11's note 2): crossings, inside links over a third
 * territory and the borders they cross, the road drawn, less a reward for links between neighbours; the same guards as
 * round 9's (every interface on the coast, the way out near Keys). */
const SEARCH = process.env.SEARCH ?? "ring";
type NetRow = ReturnType<typeof measureNet>["row"];
function netScore(r: NetRow, m: Measured, owners: readonly string[]): number {
  const offCoast = coastal.filter(id => !owners.some((o, c) => o === id && isFrontier[c])).length;
  const keysOff = m.landings.filter(l => leaving.has(l.capability)).reduce((s, l) => s + along(l.s, keysS), 0);
  return 14 * r.crossings + 10 * r.overThird + 3 * r.overThirdBorders + 0.05 * r.roadDrawn + 0.1 * keysOff - 4 * r.neighbours + 500 * offCoast;
}
function evaluate(g: Gene): { owners: string[]; m: Measured; s: number; net?: NetRow } | undefined {
  const seeds = seedsOf(g);
  if (!seeds) return undefined;
  const owners = grow(seeds);
  if (!owners) return undefined;
  const have = new Map<string, number>(); for (const o of owners) have.set(o, (have.get(o) ?? 0) + 1);
  if ([...counts].some(([id, n]) => have.get(id) !== n)) return undefined;
  // Every territory one piece.
  if ([...counts.keys()].some(id => { const c = owners.indexOf(id); return !staysWhole(owners, id, -1) || c < 0; })) return undefined;
  const map = relayout(fine, owners);
  const m = measure("roads", map, "road");
  if (SEARCH !== "net") return { owners, m, s: score(m, owners) };
  // Round 13: scored on the shared network itself, routed on this arrangement.
  const r = measureNet(map).row;
  return { owners, m, s: netScore(r, m, owners), net: r };
}

function mutate(g: Gene): Gene {
  const ring = [...g.ring], inlandSeeds = new Map(g.inland);
  let turn = g.turn;
  const r = random();
  if (r < 0.4) { const i = Math.floor(random() * ring.length), j = Math.floor(random() * ring.length); [ring[i], ring[j]] = [ring[j]!, ring[i]!]; }
  else if (r < 0.55) { const i = Math.floor(random() * ring.length), j = Math.floor(random() * ring.length); const [a, b] = [Math.min(i, j), Math.max(i, j)]; ring.splice(a, b - a + 1, ...ring.slice(a, b + 1).reverse()); }
  else if (r < 0.7) turn += (random() - 0.5) * 0.6;
  else { const id = inland[Math.floor(random() * inland.length)]!, cell = inlandSeeds.get(id)!; const near = random() < 0.7 ? cells[cell]!.neighbours.filter(n => !isFrontier[n] && !isOpen[n]) : inlandCells; if (near.length) inlandSeeds.set(id, near[Math.floor(random() * near.length)]!); }
  return { ring, turn, inland: inlandSeeds };
}

const ITER = Number(process.env.ITER ?? 6000);
let best: { g: Gene; owners: string[]; m: Measured; s: number; net?: NetRow } | undefined;
// REUSE=1 takes the arrangement layout.json already holds (the search is slow), and only measures and routes it again.
if (process.env.REGROW) {
  // Round 11: round 10's arrangement (its ring order, turn and inland seeds, from g-network's layout.json) grown again on
  // this land, so the band round the coast goes to the territories beside it and every territory grows by its lines.
  const prev = JSON.parse(readFileSync(process.env.START ?? "docs/design/capability-tree-3d/h-quiet-roads/layout.json", "utf8"));
  let g: Gene = { ring: prev.ring, turn: prev.turn, inland: new Map(Object.entries(prev.inland).map(([k, v]) => [k, Number(v)])) };
  let e = evaluate(g);
  for (let tries = 0; !e && tries < 400; tries++) { const ng = mutate(g); const f = evaluate(ng); if (f) { g = ng; e = f; } }
  if (!e) throw new Error("round 10's arrangement does not grow on this land");
  best = { g, ...e };
  // Round 13, SEARCH=net: anneal from the regrown arrangement, each change scored on the network routed over it.
  if (SEARCH === "net") {
    let here = { ...best };
    const iter = Number(process.env.ITER ?? 300), t0 = Date.now();
    for (let i = 0; i < iter; i++) {
      const temp = 20 * Math.pow(0.03, i / iter), ng = mutate(here.g), f = evaluate(ng);
      if (!f) continue;
      if (f.s < here.s || random() < Math.exp((here.s - f.s) / temp)) here = { g: ng, ...f };
      if (here.s < best.s) { best = { ...here }; console.error(`  ${i}: ${best.s.toFixed(1)} ${JSON.stringify({ x: best.net?.crossings, third: best.net?.overThird, road: best.net?.roadDrawn, nb: best.net?.neighbours })} ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
    }
  }
  console.error(`regrown: score ${best.s.toFixed(1)} (crossings ${best.m.crossings}, over a third ${best.m.overThird}, neighbours ${best.m.neighbours})`);
}
else if (process.env.REUSE) {
  const prev = JSON.parse(readFileSync(process.env.START ?? `${HERE}/layouts/${process.env.NAME ?? "layout"}.json`, "utf8"));
  const m = measure("roads", relayout(fine, prev.owners), "road");
  best = { g: { ring: prev.ring, turn: prev.turn, inland: new Map(Object.entries(prev.inland).map(([k, v]) => [k, Number(v)])) }, owners: prev.owners, m, s: score(m, prev.owners) };
}
for (let restart = 0; !process.env.REUSE && !process.env.REGROW && restart < Number(process.env.RESTARTS ?? 3); restart++) {
  // Start: the ring in id order, the inland seeds near the middle.
  let g: Gene = { ring: [...coastal].sort(() => random() - 0.5), turn: random() * 2 * Math.PI, inland: new Map() };
  const middle = [...inlandCells].sort((a, b) => Math.hypot(cells[a]!.site.x, cells[a]!.site.z) - Math.hypot(cells[b]!.site.x, cells[b]!.site.z));
  inland.forEach((id, k) => g.inland.set(id, middle[k * 3]!));
  let cur = evaluate(g);
  for (let tries = 0; !cur && tries < 200; tries++) { g = mutate(g); cur = evaluate(g); }
  if (!cur) continue;
  let here = { g, ...cur };
  for (let i = 0; i < ITER; i++) {
    const temp = 30 * Math.pow(0.02, i / ITER);
    const ng = mutate(here.g), e = evaluate(ng);
    if (!e) continue;
    if (e.s < here.s || random() < Math.exp((here.s - e.s) / temp)) here = { g: ng, ...e };
    if (!best || here.s < best.s) best = { ...here };
  }
  console.error(`restart ${restart}: best so far score ${best?.s.toFixed(1)} (crossings ${best?.m.crossings}, over a third ${best?.m.overThird}, neighbours ${best?.m.neighbours})`);
}
if (!best) throw new Error("no arrangement grew");

// ── Round 10: the shared road network on the chosen arrangement ──────────────────────────────────────────────────────
export function measureNet(map: TerritoryMap) {
  const plates = capabilityPlates(map), plate = new Map(plates.map(p => [p.capability, { x: p.x, z: p.z } as P]));
  const tAt = (p: P) => !onLand(p, coast) ? undefined : territoryAt(map, p.x, p.z)?.capability ?? "open";
  const borders: BorderSeg[] = [];
  for (const b of map.borders) {
    const pair = b.between.map(c => map.territories[map.cells[c]!.territory]?.capability ?? "open") as [string, string];
    if (onLand(b.from, coast) && onLand(b.to, coast)) borders.push({ a: b.from, b: b.to, pair });
  }
  const pairs = new Set(borders.map(b => [...b.pair].sort().join("|")));
  const links: NetLink[] = [
    ...[...arriving].map(([id, n]): NetLink => ({ key: `harbour->${id}`, kind: "arrival", from: HARBOUR.dock, to: plate.get(id)!, fromT: "sea", toT: id, links: n })),
    ...[...leaving].map(([id, n]): NetLink => ({ key: `${id}->keys`, kind: "out", from: plate.get(id)!, to: KEYS.dock, fromT: id, toT: "sea", links: n })),
    ...inside.map((l): NetLink => ({ key: `${l.from}->${l.to}`, kind: "inside", from: plate.get(l.from)!, to: plate.get(l.to)!, fromT: l.from, toT: l.to, links: 1 })),
  ];
  const served = new Set(links.flatMap(l => [l.fromT, l.toT]));
  const net = network({ tAt, toCoast, borders, links, mouth: HARBOUR.dock, band: BAND, mouthReach: MOUTH, towns: [...plate].filter(([id]) => served.has(id)).map(([territory, at]) => ({ territory, at })), cost: JSON.parse(process.env.NET_COST ?? "{}") });
  // Each link's way: the territories it passes in turn.
  const per = links.map(l => {
    const way = net.ways.get(l.key)!, seq: string[] = [];
    for (let i = 0; i + 1 < way.length; i++) { const t = tAt(way[i]!); if (t !== undefined && seq.at(-1) !== t) seq.push(t); }
    const third = [...new Set(seq.filter(t => t !== l.fromT && t !== l.toT && t !== "open"))];
    // Where an arrival last enters the territory it calls, or the way out first leaves its own: its landing.
    let entrance = way[0]!;
    if (l.kind === "arrival") { for (let i = 1; i < way.length; i++) if (tAt(way[i]!) === l.toT && tAt(way[i - 1]!) !== l.toT) entrance = way[i]!; }
    else if (l.kind === "out") entrance = way.find(p => tAt(p) !== l.fromT) ?? way.at(-1)!;
    return { key: l.key, kind: l.kind, from: l.fromT, to: l.toT, links: l.links, borders: seq.length - 1, third, neighbours: pairs.has([l.fromT, l.toT].sort().join("|")), length: lengthOf(way), points: way, entrance };
  });
  // Crossings: two segments meeting anywhere but at a shared end (on the lattice, none should).
  let crossings = 0;
  const segs = net.segments;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i]!.pts, B = segs[j]!.pts, endsAB = [A[0]!, A.at(-1)!, B[0]!, B.at(-1)!];
    for (let a = 0; a + 1 < A.length; a++) for (let b = 0; b + 1 < B.length; b++) { const x = segCross(A[a]!, A[a + 1]!, B[b]!, B[b + 1]!); if (x && !endsAB.some(e => dist(e, x) < 1.2)) crossings++; }
  }
  const ins = per.filter(p => p.kind === "inside");
  const carried = segs.map(s => s.links.length);
  const weightOf = new Map(links.map(l => [l.key, l.links]));
  const zone = zoneOf(map);
  const arrivalSegs = new Set(per.filter(p => p.kind === "arrival").flatMap(p => net.segmentsOf.get(p.key)!));
  return {
    net, per,
    row: {
      name: "network", crossings, lineLength: Math.round(per.reduce((s, p) => s + p.length, 0)), insideLength: Math.round(ins.reduce((s, p) => s + p.length, 0)), arrivalLength: Math.round(per.filter(p => p.kind !== "inside").reduce((s, p) => s + p.length, 0)),
      roadDrawn: Math.round(segs.reduce((s, x) => s + lengthOf(x.pts), 0)), zones: zones(segs.map(s => s.pts), zone),
      overThird: ins.filter(p => p.third.length).length, overThirdBorders: ins.filter(p => p.third.length).reduce((s, p) => s + p.borders, 0), worstBorders: Math.max(...ins.map(p => p.borders)),
      neighbours: ins.filter(p => p.neighbours).length, insideLinks: ins.length,
      segments: segs.length, waysPerSegment: { mean: +(carried.reduce((a, b) => a + b, 0) / segs.length).toFixed(2), most: Math.max(...carried),
        lengthWeighted: +(segs.reduce((s, x) => s + lengthOf(x.pts) * x.links.length, 0) / segs.reduce((s, x) => s + lengthOf(x.pts), 0)).toFixed(2) },
      linksPerSegment: { most: Math.max(...segs.map(s => s.links.reduce((a, k) => a + weightOf.get(k)!, 0))) },
      junctions: net.junctions.length, arrivalJunctions: net.junctions.filter(j => segs.filter(s => arrivalSegs.has(s.id) && [s.pts[0]!, s.pts.at(-1)!].some(e => dist(e, j) < 0.01)).length >= 3).length,
    },
  };
}
/** Round 9's roads (one road per link, the ring road through the open land) on this arrangement, drawn length by zone and
 * links per segment, so the two ways of drawing compare on the same land. */
function ringStats(m: Measured, map: TerritoryMap) {
  const h = ringAt(HARBOUR.dock), rel = (i: number) => { let d = (i - h) % ring.length; if (d > ring.length / 2) d -= ring.length; if (d < -ring.length / 2) d += ring.length; return d; };
  const stops = m.landings.filter(l => !leaving.has(l.capability)).map(l => rel(ringAt(l.at)));
  const lo = Math.min(0, ...stops), hi = Math.max(0, ...stops);
  const road = Array.from({ length: hi - lo + 1 }, (_, k) => ring[(h + lo + k + ring.length) % ring.length]!);
  // The ring's pieces between stops, each carrying the landings beyond it; the stretch across the mouth carries them all.
  const cuts = [...new Set([lo, 0, hi, ...stops])].sort((a, b) => a - b), pieces: { len: number; carries: number }[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!, b = cuts[i + 1]!, mid = (a + b) / 2;
    const carries = stops.filter(s => mid > 0 ? s >= b : s <= a).length;
    let len = 0; for (let k = a; k < b; k++) len += dist(ring[(h + k + ring.length) % ring.length]!, ring[(h + k + 1 + ring.length) % ring.length]!);
    pieces.push({ len, carries });
  }
  const join = [HARBOUR.dock, ring[h]!];
  const lines = [road, join, ...m.paths.map(p => p.points)];
  const counts = [...pieces.map(p => p.carries), stops.length, ...m.paths.map(() => 1)];
  return { roadDrawn: Math.round(lines.reduce((s, l) => s + lengthOf(l), 0)), zones: zones(lines, zoneOf(map)), segments: counts.length,
    waysPerSegment: { mean: +(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2), most: Math.max(...counts) } };
}

const mapToday = measure("today", today, "dock");
const todayAgain = relayout(today, todayOwners);
if (todayAgain.borders.length !== today.borders.length) console.error(`warning: relayout of today's owners draws ${todayAgain.borders.length} borders, the map ${today.borders.length}`);
const row = (m: Measured) => ({
  name: m.name, crossings: m.crossings, lineLength: Math.round(m.length), insideLength: Math.round(m.insideLength), arrivalLength: Math.round(m.arrivalLength), roadLength: Math.round(m.roadLength),
  overThird: m.overThird, overThirdBorders: m.overThirdBorders, worstBorders: m.worstBorders, neighbours: m.neighbours, insideLinks: m.insideLinks,
  insideOverOpen: m.paths.filter(p => p.kind === "inside" && p.open).length,
  landings: m.landings.length, linesPerLanding: m.landings.map(l => `${l.capability === "dock" ? "dock" : short(l.capability)} ${l.lines}/${l.links}`),
});
// The open land: its share of the island (sampled on a grid), its usual depth inside the coast, and the mouth's.
let landPts = 0, openPts = 0;
for (let x = -120; x <= 120; x += 1.5) for (let z = -120; z <= 120; z += 1.5) { const p = { x, z }; if (!onLand(p, coast)) continue; landPts++; if (best.owners[nearestCell(p).index] === OPEN) openPts++; }
const depths = ringRaw.map(r => r.depth).sort((a, b) => a - b);
const mouthDepth = ringRaw[ringAt(HARBOUR.dock)]!.depth;
const mouthWide = walk.filter((w, i) => ringRaw[i]!.depth > 2 * depths[Math.floor(depths.length / 2)]! && dist(w.p, HARBOUR.dock) < MOUTH + 15).length * 0.5;
const open = { cells: N - owned, of: N, landShare: Math.round(openPts / landPts * 100), usualDepth: Math.round(depths[Math.floor(depths.length / 2)]!), mouthDepth: Math.round(mouthDepth), mouthWidth: Math.round(mouthWide), band: BAND, mouth: MOUTH };
// Sizes still by lines: each territory's share of the territories' land beside its share of the lines.
const totalLines = shares.reduce((a, t) => a + t.lines, 0);
const sizes = shares.map(t => ({ capability: short(t.id), lines: t.lines, cells: counts.get(t.id)!, linesShare: +(t.lines / totalLines * 100).toFixed(1), landShare: +(counts.get(t.id)! / owned * 100).toFixed(1) }));
console.log("open land:", JSON.stringify(open));
console.log("worst size gap (points of share):", Math.max(...sizes.map(z => Math.abs(z.linesShare - z.landShare))).toFixed(1));
const chosen = relayout(fine, best.owners);
const routed = measureNet(chosen);
/** Round 13's room: for each territory, how far in from its own edge (its borders and the coast) its deepest point lies,
 * sampled on a half-unit grid: the radius of the largest disc it can hold, where its symbol, name and gates must fit. */
const room = (() => {
  const own = new Map<string, [P, P][]>();
  for (const b of chosen.borders) for (const c of b.between) { const id = best!.owners[c]!; if (id !== OPEN) (own.get(id) ?? own.set(id, []).get(id)!).push([b.from, b.to]); }
  const out = new Map<string, number>();
  for (let x = -120; x <= 120; x += 0.5) for (let z = -120; z <= 120; z += 0.5) {
    const p = { x, z }; if (!onLand(p, coast)) continue;
    const id = best!.owners[nearestCell(p).index]!; if (id === OPEN) continue;
    const d = Math.min(toCoast(p), ...(own.get(id) ?? []).map(([a, b]) => toSegD(p, a, b)));
    if (d > (out.get(id) ?? 0)) out.set(id, d);
  }
  return Object.fromEntries([...out].map(([id, r]) => [titleOf.get(id) ?? id, +r.toFixed(1)]).sort((a, b) => (a[1] as number) - (b[1] as number)));
})();
console.log("room (largest disc's radius, smallest first):", JSON.stringify(room));
const ringNow = { ...row(best.m), ...ringStats(best.m, chosen) };
const OUT = process.env.OUTDIR ?? HERE;
const NAME = process.env.NAME ?? "layout";
writeFileSync(`${OUT}/layouts/${NAME}.json`, JSON.stringify({
  story: STORY, cells: N, owners: best.owners, ring: best.g.ring, turn: best.g.turn, inland: Object.fromEntries(best.g.inland),
  harbour: HARBOUR, keys: KEYS, open, min: MIN, net: JSON.parse(process.env.NET_COST ?? "{}"),
  landings: routed.per.filter(p => p.kind !== "inside").map(p => ({ capability: p.kind === "out" ? p.from : p.to, at: { x: +p.entrance.x.toFixed(2), z: +p.entrance.z.toFixed(2) }, links: p.links })),
  outline: chosen.borders.filter(b => (best!.owners[b.between[0]] === OPEN) !== (best!.owners[b.between[1]] === OPEN) && onLand(b.from, coast) && onLand(b.to, coast)).map(b => [b.from, b.to].map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }))),
}) + "\n");
// Round 8's and round 9's measures, as they recorded them on their own (older) snapshot, for the comparison columns.
const recorded = (file: string, key: string) => { const r = JSON.parse(readFileSync(file, "utf8"))[key]; delete r.paths; delete r.plates; delete r.landings; return r; };
const round8 = recorded("docs/design/capability-tree-3d/e-layout/measures.json", "links");
const round9 = recorded("docs/design/capability-tree-3d/f-roads/measures.json", "roads");
const fix = (line: P[]) => line.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
writeFileSync(`${OUT}/layouts/${NAME}.measures.json`, JSON.stringify({
  today: { ...row(mapToday), paths: mapToday.paths, plates: mapToday.plates, landings: mapToday.landings }, round8, round9,
  ringNow: { ...ringNow, paths: best.m.paths, plates: best.m.plates, landings: best.m.landings },
  network: { ...routed.row, room: Object.values(room)[0], ways: routed.per.map(({ points, entrance, ...p }) => ({ ...p, points: fix(points) })), segments: routed.net.segments.map(s => ({ pts: fix(s.pts), links: s.links })), junctionPoints: fix(routed.net.junctions), plates: best.m.plates },
  open, sizes, room, coast }, null, 0) + "\n");
console.log(JSON.stringify({ today: row(mapToday), round8, round9, ringNow, network: routed.row }, null, 1));
console.log("ring:", best.g.ring.map(short).join(" → "));
console.log("network over a third:", routed.per.filter(p => p.kind === "inside" && p.third.length).map(p => `${short(p.from)}→${short(p.to)} over ${p.third.map(short).join(", ")}`).join("; "));
