import { readFileSync, writeFileSync } from "node:fs";
import { forestScene, selectionLanes } from "../../../../../packages/forest/src/index.ts";
import { workStates } from "../../../../../packages/arc-surface/src/index.ts";
import { islandCoast } from "../../../../../packages/forest-world/src/geometry.ts";
import { islandTerritories, onLand, territories, territoryAt, type TerritoryMap } from "../../../../../packages/forest/src/territories/territories.ts";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.ts";
import { relayout, cellEdges, CUT, OPEN, type P } from "./layout-core.ts";
import { network, type BorderSeg, type NetLink } from "./network.ts";

const DIR = "docs/design/capability-tree-3d/h-quiet-roads";
const HERE = "docs/design/capability-tree-3d/p-polish-3";
const data = JSON.parse(readFileSync(`${DIR}/data.json`, "utf8"));
const STORY: string = data.story.id;
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

const BAND = Number(process.env.BAND ?? 0), MOUTH = Number(process.env.MOUTH ?? 25), KEYS_OPEN = Number(process.env.KEYS_OPEN ?? 11);
const FRONT = Number(process.env.FRONT ?? 9);
const MIN = Number(process.env.MIN ?? 1);
const fine: TerritoryMap = territories(island.land!.territories, coast, CUT);
const cells = fine.cells;
const N = cells.length;
const isOpen = cells.map(c => toCoast(c.site) < BAND || dist(c.site, HARBOUR.dock) < MOUTH || dist(c.site, KEYS.dock) < KEYS_OPEN);
const owned = isOpen.filter(o => !o).length;
const shares = fine.territories.map(t => ({ id: t.capability!, lines: t.lines }));
const counts = new Map<string, number>();
{
  const total = shares.reduce((s, t) => s + t.lines, 0), spare = owned - shares.length;
  const raw = shares.map(t => ({ id: t.id, want: t.lines / total * spare }));
  raw.forEach(r => counts.set(r.id, 1 + Math.floor(r.want)));
  let left = owned - [...counts.values()].reduce((s, n) => s + n, 0);
  for (const r of [...raw].sort((a, b) => (b.want % 1) - (a.want % 1))) { if (left-- <= 0) break; counts.set(r.id, counts.get(r.id)! + 1); }
  for (const [id] of counts) while (counts.get(id)! < MIN) {
    const largest = [...counts].reduce((a, b) => b[1] > a[1] ? b : a)[0];
    counts.set(largest, counts.get(largest)! - 1); counts.set(id, counts.get(id)! + 1);
  }
}
const todayOwners = today.cells.map(c => today.territories[c.territory]!.capability!);
const isFrontier = cells.map((c, i) => !isOpen[i] && (c.neighbours.some(n => isOpen[n]) || toCoast(c.site) < FRONT));
const angleOf = (p: P) => Math.atan2(p.z, p.x);

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
const RING_OFF = Number(process.env.RING_OFF ?? 7);
const nearestCell = (p: P) => cells.reduce((b, c) => dist(c.site, p) < dist(b.site, p) ? c : b);
const ringRaw = walk.map(w => {
  const r = Math.hypot(w.p.x, w.p.z) || 1, u = { x: -w.p.x / r, z: -w.p.z / r };
  let d = 0;
  while (d < 60 && isOpen[nearestCell({ x: w.p.x + u.x * d, z: w.p.z + u.z * d }).index]) d += 0.5;
  const k = Math.max(2.5, Math.min(RING_OFF, d / 2));
  return { x: w.p.x + u.x * k, z: w.p.z + u.z * k, depth: d };
});
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
const along = (a: number, b: number) => { const d = Math.abs(a - b) % COAST_LENGTH; return Math.min(d, COAST_LENGTH - d); };

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

function staysWhole(owner: readonly string[], id: string, cell: number): boolean {
  const mine = owner.map((o, c) => o === id && c !== cell ? c : -1).filter(c => c >= 0);
  if (mine.length === 0) return false;
  const seen = new Set([mine[0]!]), queue = [mine[0]!];
  while (queue.length) { const c = queue.pop()!; for (const n of cells[c]!.neighbours) if (n !== cell && owner[n] === id && !seen.has(n)) { seen.add(n); queue.push(n); } }
  return seen.size === mine.length;
}

function balance(owner: string[], seeds: Map<string, number>): void {
  for (let round = 0; round < 200; round++) {
    const have = new Map<string, number>();
    for (const o of owner) if (o !== OPEN) have.set(o, (have.get(o) ?? 0) + 1);
    const under = [...counts].find(([id, n]) => (have.get(id) ?? 0) < n)?.[0];
    if (under === undefined) return;
    const next = new Map<string, Set<string>>();
    for (const [key] of cellEdges(cells)) { const [a, b] = key.split(":").map(Number) as [number, number]; if (owner[a] !== owner[b] && owner[a] !== OPEN && owner[b] !== OPEN) { (next.get(owner[a]!) ?? next.set(owner[a]!, new Set()).get(owner[a]!)!).add(owner[b]!); (next.get(owner[b]!) ?? next.set(owner[b]!, new Set()).get(owner[b]!)!).add(owner[a]!); } }
    const back = new Map<string, string>([[under, ""]]), queue = [under];
    let spare: string | undefined;
    while (queue.length && !spare) { const t = queue.shift()!; for (const n of next.get(t) ?? []) if (!back.has(n)) { back.set(n, t); if ((have.get(n) ?? 0) > counts.get(n)!) { spare = n; break; } queue.push(n); } }
    if (!spare) return;
    const chain: string[] = [];
    for (let t: string = spare; t !== ""; t = back.get(t)!) chain.push(t);
    for (let i = 0; i + 1 < chain.length; i++) {
      const giver = chain[i]!, taker = chain[i + 1]!, seed = cells[seeds.get(taker)!]!.site;
      const options = owner.map((o, c) => o === giver && c !== seeds.get(giver) && cells[c]!.neighbours.some(n => owner[n] === taker) ? c : -1).filter(c => c >= 0 && staysWhole(owner, giver, c));
      if (!options.length) return;
      const c = options.reduce((a, b) => dist(cells[a]!.site, seed) < dist(cells[b]!.site, seed) ? a : b);
      owner[c] = taker;
    }
  }
}

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
  const tAt = (p: P) => !onLand(p, coast) ? undefined : territoryAt(map, p.x, p.z)?.capability ?? "open";
  const between = new Map<string, [P, P][]>();
  for (const b of map.borders) {
    const [x, y] = b.between.map(c => map.territories[map.cells[c]!.territory]?.capability ?? "open") as [string, string];
    const key = [x, y].sort().join("|");
    (between.get(key) ?? between.set(key, []).get(key)!).push([b.from, b.to]);
  }
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
  const along3 = (key: string, kind: Path["kind"], from: string, to: string, points: P[], links: number): Path => {
    const { seq, at } = trace(points);
    const borders = seq.filter((t, i) => i > 0 && t !== undefined && seq[i - 1] !== undefined).length;
    return { key, kind, from, to, points, links, gates: at.filter((p, i) => seq[i] !== undefined && seq[i + 1] !== undefined), third: [...new Set(seq.filter((t): t is string => t !== undefined && t !== from && t !== to && t !== "open"))], borders, neighbours: false, open: true };
  };
  const paths: Path[] = [];
  for (const l of inside) paths.push(path(`${l.from}->${l.to}`, "inside", l.from, l.to, plate.get(l.from)!, plate.get(l.to)!, 1, [l.from, l.to]));
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
        const run = rs.reduce((a, b) => Math.min(...a.map(w => along(w.s, want))) <= Math.min(...b.map(w => along(w.s, want))) ? a : b);
        const mid = run[Math.floor(run.length / 2)]!;
        at = mid.p; s = mid.s;
      }
    }
    const lp = landings.find(l => dist(l.at, at) < 0.01);
    if (lp) { lp.lines++; lp.links += links; } else landings.push({ capability: landingsFor === "own" ? id : "dock", at, s, lines: 1, links });
    paths.push(out ? path(`${id}->keys`, "out", id, "keys", plate.get(id)!, at, links, [id, tAt(at)]) : path(`harbour->${id}`, "arrival", "harbour", id, at, plate.get(id)!, links, [tAt(at), id]));
  }
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
  let roadLength = 0;
  if (landingsFor === "road") {
    const h = ringAt(HARBOUR.dock), rel = (i: number) => { let d = (i - h) % ring.length; if (d > ring.length / 2) d -= ring.length; if (d < -ring.length / 2) d += ring.length; return d; };
    const stops = landings.filter(l => !leaving.has(l.capability)).map(l => rel(ringAt(l.at)));
    const lo = Math.min(0, ...stops), hi = Math.max(0, ...stops);
    for (let k = lo; k < hi; k++) roadLength += dist(ring[(h + k + ring.length) % ring.length]!, ring[(h + k + 1 + ring.length) % ring.length]!);
  }
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
function zones(lines: P[][], zone: (p: P) => string) {
  const out: Record<string, number> = { mouth: 0, coast: 0, inland: 0 };
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!, b = line[i + 1]!, l = dist(a, b), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 0; k < n; k++) out[zone({ x: a.x + (b.x - a.x) * (k + 0.5) / n, z: a.z + (b.z - a.z) * (k + 0.5) / n })]! += l / n;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v)]));
}
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
  const keysOff = m.landings.filter(l => leaving.has(l.capability)).reduce((s, l) => s + along(l.s, keysS), 0);
  return 14 * m.crossings + 6 * extra + 10 * m.overThird + 0.04 * m.length + 0.07 * m.roadLength + 0.1 * keysOff - 3 * m.neighbours + 500 * offCoast;
}
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
  if ([...counts.keys()].some(id => { const c = owners.indexOf(id); return !staysWhole(owners, id, -1) || c < 0; })) return undefined;
  const map = relayout(fine, owners);
  const m = measure("roads", map, "road");
  if (SEARCH !== "net") return { owners, m, s: score(m, owners) };
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
if (process.env.REGROW) {
  const prev = JSON.parse(readFileSync(process.env.START ?? "docs/design/capability-tree-3d/h-quiet-roads/layout.json", "utf8"));
  let g: Gene = { ring: prev.ring, turn: prev.turn, inland: new Map(Object.entries(prev.inland).map(([k, v]) => [k, Number(v)])) };
  let e = evaluate(g);
  for (let tries = 0; !e && tries < 400; tries++) { const ng = mutate(g); const f = evaluate(ng); if (f) { g = ng; e = f; } }
  if (!e) throw new Error("round 10's arrangement does not grow on this land");
  best = { g, ...e };
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
  const per = links.map(l => {
    const way = net.ways.get(l.key)!, seq: string[] = [];
    for (let i = 0; i + 1 < way.length; i++) { const t = tAt(way[i]!); if (t !== undefined && seq.at(-1) !== t) seq.push(t); }
    const third = [...new Set(seq.filter(t => t !== l.fromT && t !== l.toT && t !== "open"))];
    let entrance = way[0]!;
    if (l.kind === "arrival") { for (let i = 1; i < way.length; i++) if (tAt(way[i]!) === l.toT && tAt(way[i - 1]!) !== l.toT) entrance = way[i]!; }
    else if (l.kind === "out") entrance = way.find(p => tAt(p) !== l.fromT) ?? way.at(-1)!;
    return { key: l.key, kind: l.kind, from: l.fromT, to: l.toT, links: l.links, borders: seq.length - 1, third, neighbours: pairs.has([l.fromT, l.toT].sort().join("|")), length: lengthOf(way), points: way, entrance };
  });
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
function ringStats(m: Measured, map: TerritoryMap) {
  const h = ringAt(HARBOUR.dock), rel = (i: number) => { let d = (i - h) % ring.length; if (d > ring.length / 2) d -= ring.length; if (d < -ring.length / 2) d += ring.length; return d; };
  const stops = m.landings.filter(l => !leaving.has(l.capability)).map(l => rel(ringAt(l.at)));
  const lo = Math.min(0, ...stops), hi = Math.max(0, ...stops);
  const road = Array.from({ length: hi - lo + 1 }, (_, k) => ring[(h + lo + k + ring.length) % ring.length]!);
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
let landPts = 0, openPts = 0;
for (let x = -120; x <= 120; x += 1.5) for (let z = -120; z <= 120; z += 1.5) { const p = { x, z }; if (!onLand(p, coast)) continue; landPts++; if (best.owners[nearestCell(p).index] === OPEN) openPts++; }
const depths = ringRaw.map(r => r.depth).sort((a, b) => a - b);
const mouthDepth = ringRaw[ringAt(HARBOUR.dock)]!.depth;
const mouthWide = walk.filter((w, i) => ringRaw[i]!.depth > 2 * depths[Math.floor(depths.length / 2)]! && dist(w.p, HARBOUR.dock) < MOUTH + 15).length * 0.5;
const open = { cells: N - owned, of: N, landShare: Math.round(openPts / landPts * 100), usualDepth: Math.round(depths[Math.floor(depths.length / 2)]!), mouthDepth: Math.round(mouthDepth), mouthWidth: Math.round(mouthWide), band: BAND, mouth: MOUTH };
const totalLines = shares.reduce((a, t) => a + t.lines, 0);
const sizes = shares.map(t => ({ capability: short(t.id), lines: t.lines, cells: counts.get(t.id)!, linesShare: +(t.lines / totalLines * 100).toFixed(1), landShare: +(counts.get(t.id)! / owned * 100).toFixed(1) }));
console.log("open land:", JSON.stringify(open));
console.log("worst size gap (points of share):", Math.max(...sizes.map(z => Math.abs(z.linesShare - z.landShare))).toFixed(1));
const chosen = relayout(fine, best.owners);
const routed = measureNet(chosen);
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
