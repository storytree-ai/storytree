// Lays The library's capabilities out as fields on one island, from data.json, and writes the result into index.html.
// Run from the checkout root after measure.mjs: node docs/design/capability-tree-medieval/b-palisade/tools/layout.mjs
//
// Each field is a cell of a power diagram (a Voronoi diagram whose sites carry weights) cut to a convex island, so every
// field is one convex piece. The weights are tuned until each field's area is its share of the lines, and the sites are
// placed by a small force layout that pulls linked capabilities together, so most tracks cross one fence.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/design/capability-tree-medieval/b-palisade/';
const data = JSON.parse(readFileSync(dir + 'data.json', 'utf8'));
const W = 1090, H = 820, CX = 500, CY = 410;

// A deterministic random, so the layout is the same on every run.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// The island: a gently wobbled ellipse, kept convex (the wobble is small against the curvature).
const island = [];
for (let k = 0; k < 160; k++) {
  const t = (k / 160) * Math.PI * 2;
  const r = 1 + 0.035 * Math.sin(2 * t + 0.6) + 0.02 * Math.sin(3 * t + 1.9);
  island.push({ x: CX + 405 * r * Math.cos(t), y: CY + 355 * r * Math.sin(t), tag: -1 });
}
const area = (poly) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
const centroid = (poly) => {
  let a = 0, x = 0, y = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; const c = p.x * q.y - q.x * p.y; a += c; x += (p.x + q.x) * c; y += (p.y + q.y) * c; });
  return a === 0 ? { x: poly[0].x, y: poly[0].y } : { x: x / (3 * a), y: y / (3 * a) };
};
const total = area(island);

const GATE = 38; // a gate needs this much fence, posts included
const TRIALS = 40;
const caps = data.capabilities;
const n = caps.length;
const index = new Map(caps.map((c, i) => [c.id, i]));
const lines = caps.reduce((s, c) => s + c.lines, 0);
const target = caps.map((c) => (c.lines / lines) * total);
const links = caps.flatMap((c, i) => c.dependsOn.filter((d) => index.has(d.id)).map((d) => [i, index.get(d.id)]));
const external = caps.flatMap((c, i) => c.dependsOn.filter((d) => !index.has(d.id)).map((d) => ({ from: i, to: d })));
const roadOut = new Set(external.map(({ from }) => from));

// Clip a polygon to the half-plane a·p <= c, tagging the new edge `tag`; each vertex's tag names the edge it starts.
function clip(poly, a, c, tag) {
  const out = [], inside = (p) => a.x * p.x + a.y * p.y <= c;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length], pi = inside(p), qi = inside(q);
    const cut = () => { const s = (c - a.x * p.x - a.y * p.y) / (a.x * (q.x - p.x) + a.y * (q.y - p.y)); return { x: p.x + s * (q.x - p.x), y: p.y + s * (q.y - p.y) }; };
    if (pi && qi) out.push(p);
    else if (pi) { out.push(p); out.push({ ...cut(), tag }); }
    else if (qi) out.push({ ...cut(), tag: p.tag });
  }
  return out;
}
const cellsOf = (w) => pos.map((p, i) => {
  let cell = island;
  for (let j = 0; j < n && cell.length > 0; j++) {
    if (j === i) continue;
    const q = pos[j];
    cell = clip(cell, { x: 2 * (q.x - p.x), y: 2 * (q.y - p.y) }, q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y - w[j] + w[i], j);
  }
  return cell;
});

let pos;
// One layout from one starting seed: sites by force, then weights tuned to the areas.
function trial(start) {
  seed = start;
  // Sites by a force layout: links pull, everything pushes apart by size, the island's rim holds them in.
  const size = target.map((a) => Math.sqrt(a / Math.PI));
  pos = caps.map(() => { const t = rand() * Math.PI * 2, r = Math.sqrt(rand()); return { x: CX + 350 * r * Math.cos(t), y: CY + 300 * r * Math.sin(t) }; });
  for (let step = 0; step < 3000; step++) {
    const f = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y, d = Math.hypot(dx, dy) || 0.01, want = (size[i] + size[j]) * 1.05;
      if (d < want) { const k = (want - d) / d * 0.5; f[i].x -= dx * k; f[i].y -= dy * k; f[j].x += dx * k; f[j].y += dy * k; }
    }
    for (const [a, b] of links) {
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y, d = Math.hypot(dx, dy) || 0.01, want = size[a] + size[b];
      if (d > want) { const k = (d - want) / d * 0.2; f[a].x += dx * k; f[a].y += dy * k; f[b].x -= dx * k; f[b].y -= dy * k; }
    }
    for (let i = 0; i < n; i++) {
      // A capability with a road off the island is pulled to the east coast, where its road leaves.
      if (roadOut.has(i)) { f[i].x += (CX + 370 - pos[i].x) * 0.02; f[i].y += (CY - pos[i].y) * 0.02; }
      pos[i].x += f[i].x * 0.5; pos[i].y += f[i].y * 0.5;
      const ex = (pos[i].x - CX) / 370, ey = (pos[i].y - CY) / 320, e = Math.hypot(ex, ey);
      if (e > 1) { pos[i].x = CX + (pos[i].x - CX) / e; pos[i].y = CY + (pos[i].y - CY) / e; }
    }
  }
  
  // Tune the weights to the areas, moving each site to its cell's centroid as it goes (a weighted Lloyd iteration).
  let w = caps.map(() => 0), cells = cellsOf(w);
  for (let step = 0; step < 4000; step++) {
    cells.forEach((cell, i) => {
      const a = cell.length >= 3 ? area(cell) : 0;
      w[i] += (target[i] - a) * 0.04 * (step < 2000 ? 1 : 0.5);
      if (a > 0 && step % 4 === 0) { const c = centroid(cell); pos[i] = { x: pos[i].x * 0.7 + c.x * 0.3, y: pos[i].y * 0.7 + c.y * 0.3 }; }
    });
    const mean = w.reduce((s, x) => s + x, 0) / n; w = w.map((x) => x - mean);
    cells = cellsOf(w);
  }
  return { pos, w, cells };
}
const adjacent = (cells) => links.filter(([x, y]) => cells[x].some((p, k) => p.tag === y && Math.hypot(cells[x][(k + 1) % cells[x].length].x - p.x, cells[x][(k + 1) % cells[x].length].y - p.y) >= GATE)).length;
let best;
for (let start = 1; start <= TRIALS; start++) {
  const t = trial(start), score = adjacent(t.cells);
  if (best === undefined || score > best.score) best = { ...t, score, start };
}
pos = best.pos;
const { w, cells } = best;
const error = cells.map((cell, i) => (area(cell) - target[i]) / target[i]);

// Fences: the edge of cell i tagged j is the border between i and j.
const borders = [];
cells.forEach((cell, i) => cell.forEach((p, k) => {
  const j = p.tag, q = cell[(k + 1) % cell.length];
  if (j > i && Math.hypot(q.x - p.x, q.y - p.y) > 0.5) borders.push({ a: i, b: j, from: p, to: q, length: Math.hypot(q.x - p.x, q.y - p.y) });
}));
const borderOf = new Map(borders.map((b) => [`${b.a}|${b.b}`, b]));
const between = (a, b) => borderOf.get(a < b ? `${a}|${b}` : `${b}|${a}`);
const centre = cells.map((cell) => centroid(cell));

// Each link's route: across the shared fence when there is room for a gate, else the shortest walk through neighbours.
function route(from, to) {
  const dist = new Map([[from, 0]]), prev = new Map(), open = [from];
  while (open.length > 0) {
    open.sort((x, y) => dist.get(x) - dist.get(y));
    const here = open.shift();
    if (here === to) break;
    for (const b of borders) {
      if (b.length < GATE || (b.a !== here && b.b !== here)) continue;
      const next = b.a === here ? b.b : b.a, d = dist.get(here) + Math.hypot(centre[next].x - centre[here].x, centre[next].y - centre[here].y);
      if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); prev.set(next, here); open.push(next); }
    }
  }
  const walk = [to];
  while (walk[0] !== from) walk.unshift(prev.get(walk[0]));
  return walk;
}
// A gate sits where the line between the two field centres crosses their fence, kept clear of the fence's ends.
const gates = new Map();
function gateOn(a, b) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (gates.has(key)) return gates.get(key);
  const f = between(a, b), dx = f.to.x - f.from.x, dy = f.to.y - f.from.y;
  const ca = centre[a], cb = centre[b], ex = cb.x - ca.x, ey = cb.y - ca.y;
  const den = dx * ey - dy * ex;
  let s = den === 0 ? 0.5 : ((ca.x - f.from.x) * ey - (ca.y - f.from.y) * ex) / den;
  const keep = (GATE / 2 + 2) / f.length;
  s = Math.min(1 - keep, Math.max(keep, s));
  const gate = { id: `gate-${gates.size + 1}`, a: Math.min(a, b), b: Math.max(a, b), x: f.from.x + s * dx, y: f.from.y + s * dy, angle: Math.atan2(dy, dx), links: [] };
  gates.set(key, gate);
  return gate;
}
const pathways = links.map(([from, to], k) => {
  const walk = route(from, to), id = `path-${k + 1}`;
  const stops = walk.slice(1).map((next, s) => gateOn(walk[s], next));
  stops.forEach((g) => g.links.push(id));
  return { id, from, to, walk, gates: stops.map((g) => g.id) };
});
// A lane runs from a field's centre to one of its gates; the pathways that use it share it.
const lanes = new Map();
for (const p of pathways) p.walk.forEach((field, s) => {
  for (const g of [s > 0 ? gateOn(p.walk[s - 1], field) : undefined, s < p.walk.length - 1 ? gateOn(field, p.walk[s + 1]) : undefined]) {
    if (g === undefined) continue;
    const key = `${field}|${g.id}`;
    if (!lanes.has(key)) lanes.set(key, { field, gate: g.id, links: [] });
    if (!lanes.get(key).links.includes(p.id)) lanes.get(key).links.push(p.id);
  }
});
// The road off the coast: from its field's centre to the middle of that field's coastline, and on out to sea.
const roads = external.map(({ from, to }) => {
  const cell = cells[from], coast = cell.flatMap((p, k) => (p.tag === -1 ? [[p, cell[(k + 1) % cell.length]]] : []));
  if (coast.length === 0) throw new Error(`${caps[from].title} has no coast for its road`);
  const mid = coast[Math.floor(coast.length / 2)][0], dx = mid.x - centre[from].x, dy = mid.y - centre[from].y, d = Math.hypot(dx, dy);
  return { from, to, shore: mid, end: { x: mid.x + (dx / d) * 30, y: mid.y + (dy / d) * 30 } };
});
// The work on each field: one wrench, on the gate of the pathway the work changes, else the field's busiest gate.
const wrenchGate = (field) => {
  const own = [...gates.values()].filter((g) => g.a === field || g.b === field);
  const outward = own.filter((g) => pathways.some((p) => p.from === field && p.gates.includes(g.id)));
  return (outward.length > 0 ? outward : own).sort((x, y) => y.links.length - x.links.length)[0]?.id;
};

const round = (v) => Math.round(v * 10) / 10;
const layout = {
  width: W, height: H,
  island: island.map((p) => [round(p.x), round(p.y)]),
  fields: cells.map((cell, i) => ({ polygon: cell.map((p) => [round(p.x), round(p.y)]), centre: [round(centre[i].x), round(centre[i].y)], area: Math.round(area(cell)) })),
  fences: borders.map((b) => ({ a: b.a, b: b.b, from: [round(b.from.x), round(b.from.y)], to: [round(b.to.x), round(b.to.y)] })),
  gates: [...gates.values()].map((g) => ({ id: g.id, a: g.a, b: g.b, x: round(g.x), y: round(g.y), angle: round((g.angle * 180) / Math.PI), links: g.links })),
  lanes: [...lanes.values()],
  pathways: pathways.map(({ id, from, to, gates: through }) => ({ id, from, to, gates: through })),
  roads: roads.map(({ from, to, shore, end }) => ({ from, to: to.id, title: to.title, story: to.story, contracts: to.contracts, shore: [round(shore.x), round(shore.y)], end: [round(end.x), round(end.y)] })),
  wrenchGate: Object.fromEntries(caps.map((_, i) => [i, wrenchGate(i)])),
};
const page = {
  story: data.story, measuredAt: data.measuredAt,
  capabilities: caps.map(({ id, title, description, word, parked, lines, contracts }) => ({ id, title, description, word, parked, lines, contracts })),
  openWork: data.openWork, layout,
};
const html = readFileSync(dir + 'index.html', 'utf8');
const begin = '/* data:begin */', end = '/* data:end */';
writeFileSync(dir + 'index.html', html.slice(0, html.indexOf(begin) + begin.length) + `\nconst DATA = ${JSON.stringify(page)};\n` + html.slice(html.indexOf(end)));
const multi = pathways.filter((p) => p.gates.length > 1).length;
console.log(`start ${best.start}, fields ${n}, worst area error ${Math.round(Math.max(...error.map(Math.abs)) * 1000) / 10}%, fences ${borders.length}, gates ${gates.size}, pathways ${pathways.length} (${multi} cross more than one fence)`);
