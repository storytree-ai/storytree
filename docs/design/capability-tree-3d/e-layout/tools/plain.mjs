// The plain diagrams: both arrangements as boxes and arrows, in the manner of the architecture diagram Mick liked (a dashed
// story frame, capability boxes, plain arrows), each box where the map puts that territory's name, each arrow along the way
// tools/layout.ts measured (bent through the gate on a shared border, else straight). Arrivals from other stories are teal.
// Run from the checkout root after layout.ts: node docs/design/capability-tree-3d/e-layout/tools/plain.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.dirname(here);
const measures = JSON.parse(readFileSync(path.join(dir, 'measures.json'), 'utf8'));
const layout = JSON.parse(readFileSync(path.join(dir, 'layout.json'), 'utf8'));
const W = 1600, H = 1120, S = 4.55, OX = 600, OY = 545;
const at = (p) => ({ x: OX + p.x * S, y: OY + p.z * S });
const INK = '#1d2329', LINE = '#3d4650', TEAL = '#0d8fb0', PAPER = '#fbfaf6', FRAME = '#8a939c', BOX = '#ffffff';
const loop = [...measures.coast].sort((a, b) => b.length - a.length)[0];
const nameOf = (t) => t.replace(/^\d+ · /, '');

function boxes(m) {
  const out = m.plates.map((p) => { const c = at(p), w = 9 + nameOf(p.title).length * 6.6; return { id: p.capability, title: nameOf(p.title), x: c.x, y: c.y, w, h: 24, ox: c.x, oy: c.y }; });
  // Nudge overlapping boxes apart, a little at a time, keeping each near its territory's name.
  for (let k = 0; k < 300; k++) {
    let moved = false;
    for (const a of out) for (const b of out) {
      if (a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, ox = (a.w + b.w) / 2 + 6 - Math.abs(dx), oy = (a.h + b.h) / 2 + 6 - Math.abs(dy);
      if (ox > 0 && oy > 0) { moved = true; if (oy < ox) { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; b.y += s; } else { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; b.x += s; } }
    }
    for (const a of out) { a.x += (a.ox - a.x) * 0.02; a.y += (a.oy - a.y) * 0.02; }
    if (!moved) break;
  }
  return new Map(out.map((b) => [b.id, b]));
}
/** Where the way from `p` toward the box's middle meets its edge. */
function edge(b, p) {
  const dx = p.x - b.x, dy = p.y - b.y, tx = Math.abs(dx) > 1e-6 ? (b.w / 2 + 3) / Math.abs(dx) : Infinity, ty = Math.abs(dy) > 1e-6 ? (b.h / 2 + 3) / Math.abs(dy) : Infinity, t = Math.min(tx, ty, 1);
  return { x: b.x + dx * t, y: b.y + dy * t };
}
const d = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');

function svg(m, title, sub) {
  const bx = boxes(m);
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  parts.push(`<path d="${d(loop.map(at))}Z" fill="none" stroke="${FRAME}" stroke-width="1.4" stroke-dasharray="7 6"/>`);
  parts.push(`<text x="${OX}" y="${OY + 118 * S + 8}" text-anchor="middle" font-size="15" fill="${FRAME}" font-weight="600">The library</text>`);
  const arrow = (pts, colour, width) => `<path d="${d(pts)}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" marker-end="url(#${colour === TEAL ? 'ht' : 'h'})"/>`;
  // The sea road and where it comes ashore.
  const harbour = at(layout.harbour.sea), dock = at(layout.harbour.dock);
  // The sea roads, run on out of the frame the way they come.
  const outer = (dockP, seaP, k) => ({ x: seaP.x + (seaP.x - dockP.x) * k, y: seaP.y + (seaP.y - dockP.y) * k });
  const far = outer(dock, harbour, 4.5);
  parts.push(`<path d="M${far.x} ${far.y}L${harbour.x} ${harbour.y}${m.name === 'links' ? '' : `L${dock.x} ${dock.y}`}" stroke="${TEAL}" stroke-width="5" stroke-linecap="round" opacity="0.9"/>`);
  parts.push(`<text x="${far.x + 8}" y="${far.y + 16}" font-size="13" fill="${TEAL}">from 20 stories: 203 links</text>`);
  const keysDock = at(layout.keys.dock), keys = at(layout.keys.sea), keysFar = outer(keysDock, keys, 3);
  parts.push(`<path d="M${keys.x} ${keys.y}L${keysFar.x} ${keysFar.y}" stroke="${TEAL}" stroke-width="2.5" stroke-linecap="round"/><text x="${keysFar.x}" y="${keysFar.y + 18}" font-size="13" fill="${TEAL}" text-anchor="middle">to Keys</text>`);
  if (m.name === 'links') {
    // The coast road: from the harbour along the coast, offshore, to the furthest landing each way.
    const off = (p) => { const r = Math.hypot(p.x, p.z) || 1; return { x: p.x + p.x / r * 7, z: p.z + p.z / r * 7 }; };
    const walk = []; let s = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; walk.push({ p: a, s }); s += Math.hypot(b.x - a.x, b.z - a.z); }
    const L = s, sOf = (p) => walk.reduce((b, w) => Math.hypot(w.p.x - p.x, w.p.z - p.z) < Math.hypot(b.p.x - p.x, b.p.z - p.z) ? w : b).s;
    const h = sOf(layout.harbour.dock), rel = (x) => { let v = (x - h) % L; if (v > L / 2) v -= L; if (v < -L / 2) v += L; return v; };
    const offs = m.landings.filter((l) => l.capability !== 'dock' && !l.capability.includes('keys')).map((l) => rel(l.s));
    const lo = Math.min(0, ...offs.filter((v, i) => m.landings[i]), ...offs), hi = Math.max(0, ...offs);
    const road = walk.filter((w) => { const r = rel(w.s); return r >= lo - 2 && r <= hi + 2; }).sort((a, b) => rel(a.s) - rel(b.s)).map((w) => at(off(w.p)));
    parts.push(`<path d="${d(road)}" fill="none" stroke="${TEAL}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`);
    parts.push(`<path d="M${harbour.x} ${harbour.y}L${at(off(layout.harbour.dock)).x} ${at(off(layout.harbour.dock)).y}" stroke="${TEAL}" stroke-width="5" stroke-linecap="round"/>`);
  } else {
    parts.push(`<circle cx="${dock.x}" cy="${dock.y}" r="7" fill="${PAPER}" stroke="${TEAL}" stroke-width="2"/>`);
  }
  for (const p of m.paths) {
    const pts = p.points.map(at);
    const from = p.kind === 'arrival' ? null : bx.get(p.from), to = p.kind === 'out' ? null : bx.get(p.to);
    // Ends at the boxes' edges; an arrival starts on its landing (or the dock), the way out ends on the coast.
    if (from) pts[0] = edge(from, pts[1]);
    if (to) pts[pts.length - 1] = edge(to, pts[pts.length - 2]);
    if (p.kind === 'arrival' && m.name === 'links') { const r = Math.hypot(p.points[0].x, p.points[0].z) || 1; pts.unshift(at({ x: p.points[0].x + p.points[0].x / r * 7, z: p.points[0].z + p.points[0].z / r * 7 })); }
    if (p.kind === 'out') {
      // Offshore along the coast, the short way round, to Keys' road.
      const e = p.points.at(-1), r = Math.hypot(e.x, e.z) || 1, ks = layout.keys.dock, kr = Math.hypot(ks.x, ks.z) || 1;
      let a0 = Math.atan2(e.z, e.x), a1 = Math.atan2(ks.z, ks.x), da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(1, Math.round(Math.abs(da) / 0.08));
      for (let k = 0; k <= steps; k++) { const t = k / steps, ang = a0 + da * t, rr = (r + (kr - r) * t) + 7; pts.push(at({ x: Math.cos(ang) * rr, z: Math.sin(ang) * rr })); }
      pts.push(keys);
    }
    parts.push(arrow(pts, p.kind === 'inside' ? LINE : TEAL, p.kind === 'inside' ? 1.5 : 1.6));
    if (p.kind === 'arrival' && p.links > 1 && m.name === 'links') { const q = pts[1]; parts.push(`<text x="${q.x}" y="${q.y - 4}" font-size="10" fill="${TEAL}" text-anchor="middle">${p.links}</text>`); }
  }
  for (const b of bx.values()) {
    parts.push(`<rect x="${(b.x - b.w / 2).toFixed(1)}" y="${(b.y - b.h / 2).toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h}" rx="4" fill="${BOX}" stroke="${INK}" stroke-width="1.2"/>`);
    parts.push(`<text x="${b.x.toFixed(1)}" y="${(b.y + 4.3).toFixed(1)}" font-size="12" text-anchor="middle" fill="${INK}">${b.title.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}</text>`);
  }
  const head = (id, colour) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${colour}"/></marker>`;
  const ashore = new Set(m.paths.filter((p) => p.kind === 'arrival').map((p) => `${p.points[0].x.toFixed(1)},${p.points[0].z.toFixed(1)}`)).size;
  const facts = [`${m.crossings} crossings`, `${m.lineLength} units of line on land`, `${m.overThird} of ${m.insideLinks} inside links over a third territory`, `${m.neighbours} between neighbours`, `${ashore} landing${ashore > 1 ? 's' : ''} for the 17 arrivals`];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif"><defs>${head('h', LINE)}${head('ht', TEAL)}</defs>${parts.join('')}
  <text x="1230" y="60" font-size="20" font-weight="700" fill="${INK}">${title}</text><text x="1230" y="86" font-size="13" fill="${LINE}">${sub}</text>
  ${facts.map((f, i) => `<text x="1230" y="${130 + i * 22}" font-size="14" fill="${INK}">${f}</text>`).join('')}
  <path d="M1230 280h40" stroke="${LINE}" stroke-width="1.5" marker-end="url(#h)"/><text x="1280" y="284" font-size="12" fill="${LINE}">calls (inside the story)</text>
  <path d="M1230 304h40" stroke="${TEAL}" stroke-width="1.6" marker-end="url(#ht)"/><text x="1280" y="308" font-size="12" fill="${LINE}">from or to another story</text></svg>`;
}

const require = createRequire(path.join(dir, '../../../../packages/website/package.json'));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }
const browser = await chromium.launch();
for (const [key, file, title, sub] of [['today', 'plain-today', 'Today’s arrangement', 'The map’s own halving layout, which ignores the links'], ['links', 'plain-diagram', 'Laid out by the links', 'Interfaces on the coast, each with its own landing']]) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const content = svg(measures[key], title, sub);
  writeFileSync(path.join(dir, 'stills', `${file}.svg`), content);
  await page.setContent(`<html><body style="margin:0">${content}</body></html>`);
  await page.screenshot({ path: path.join(dir, 'stills', `${file}.png`) });
  await page.close();
}
await browser.close();
console.log('stills/plain-today.png, stills/plain-diagram.png');
