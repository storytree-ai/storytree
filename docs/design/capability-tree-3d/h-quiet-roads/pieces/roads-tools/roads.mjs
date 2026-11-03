// Round 11's road swatches: one piece of The library's land (three territories, the open land at the mouth, the coast),
// drawn as the map draws it at rest (about 2.6 pixels a ground unit, tilted so the ground reads 0.77 as deep as it is
// wide), with the same small road network in each of a set of quiet road styles. Gates, settlements and names are
// round 10's and stay the same in every swatch, so only the road changes.
// Writes pieces/roads.html (static SVG, opens from disk). With --shots it also takes the stills in the capture kit's
// Chromium (add --retake to write them into pieces/stills, else the kit's scratch folder).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/h-quiet-roads/pieces/roads-tools/roads.mjs [--shots [--retake]]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), pieces = path.dirname(here);

// ── The land, in ground units (x across, z down the page) ──────────────────────────────────────────────────────────
const W = 124, H = 80;
/** Displayed colours, sampled from round 11's resting still. */
const LAND = { healthy: '#8eb35e', untested: '#d6bd6c', parked: '#808b94', open: '#686d70', sea: '#18242d', side: '#374335', coastLight: '#a8cd78', coastLine: '#edf1f1' };
const V = {
  a: [0, 0], b: [52, 0], c: [124, 0], d: [58, 14], e: [50, 30], f: [56, 46], g: [44, 58], h: [30, 62], i: [0, 60],
  j: [124, 26], k: [100, 32], l: [80, 36], m: [72, 58], n: [64, 80], o: [0, 80], s: [124, 42], t: [100, 56], u: [84, 80],
};
const poly = (...names) => names.map(k => V[k]);
const territories = [
  { name: 'Library API', fill: LAND.healthy, pts: poly('a', 'b', 'd', 'e', 'f', 'g', 'h', 'i') },
  { name: 'Graduation', fill: LAND.healthy, pts: poly('b', 'c', 'j', 'k', 'l', 'f', 'e', 'd') },
  { name: "The library's commands", fill: LAND.untested, pts: poly('f', 'l', 'k', 'j', 's', 't', 'u', 'n', 'm', 'g') },
  { name: 'Work model', fill: LAND.healthy, pts: poly('i', 'h', 'g', 'm', 'n', 'o') },
];
/** The open land at the mouth, and the coast curving across the piece's corner. */
const coast = [[124, 58], [119, 63], [116, 70], [111, 75], [106, 80]];
const open = [V.s, V.t, V.u, [106, 80], ...[...coast].reverse()];
/** The borders: between territories, and the territories' outline onto the open land. */
const borders = [['d', 'b'], ['d', 'e'], ['e', 'f'], ['f', 'g'], ['g', 'h'], ['h', 'i'], ['f', 'l'], ['l', 'k'], ['k', 'j'], ['g', 'm'], ['m', 'n'], ['s', 't'], ['t', 'u']].map(([p, q]) => [V[p], V[q]]);

// ── The roads: a small network, each segment with the links it carries ─────────────────────────────────────────────
const J1 = [96, 47], S1 = [33, 37], S2 = [84, 15], S3 = [110, 37], S4 = [24, 71];
const roads = [
  { id: 'trunk', links: 12, pts: [[124, 77], [117, 70], [108, 57], [100, 50], J1] },
  { id: 'to-api', links: 9, pts: [J1, [80, 50], [66, 52], [50, 52], [40, 44], S1] },
  { id: 'to-commands', links: 2, pts: [J1, [103, 42], S3] },
  { id: 'to-graduation', links: 4, pts: [J1, [92, 40], [90, 34], [87, 24], S2] },
  { id: 'api-graduation', links: 3, pts: [S1, [42, 28], [54, 22], [68, 18], S2] },
  { id: 'api-work', links: 1, pts: [S1, [27, 48], [22, 61.5], S4] },
  { id: 'work-out', links: 1, pts: [S4, [12, 74], [0, 75]] },
  { id: 'graduation-out', links: 2, pts: [S2, [86, 7], [88, 0]] },
];
/** The link picked in the lit sheet: the arrivals into Library API, up the trunk and on. */
const LIT = ['trunk', 'to-api'];
const towns = [{ at: S1, grade: 2 }, { at: S2, grade: 1 }, { at: S3, grade: 0 }, { at: S4, grade: 0 }];
const names = [{ text: 'Library API', at: [S1[0], S1[1] - 5.5] }, { text: 'Graduation', at: [S2[0] + 14, S2[1] - 4] }, { text: "The library's commands", at: [S3[0] - 6, S3[1] + 6] }, { text: 'Work model', at: [S4[0] + 4, S4[1] + 5.5] }];

// Every place a road crosses a border: a gate (round 10's posts either side of an opening, the border cut there).
const cross = (p, q, r, s) => {
  const rx = q[0] - p[0], rz = q[1] - p[1], sx = s[0] - r[0], sz = s[1] - r[1], den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((r[0] - p[0]) * sz - (r[1] - p[1]) * sx) / den, u = ((r[0] - p[0]) * rz - (r[1] - p[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * rx, p[1] + t * rz] : undefined;
};
const gates = [];
for (const road of roads) for (let i = 0; i + 1 < road.pts.length; i++) for (const [a, b] of borders) {
  const x = cross(road.pts[i], road.pts[i + 1], a, b);
  if (x) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); gates.push({ at: x, along: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], links: road.links, entrance: road.links <= 4 || road.id === 'to-api' }); }
}

/** Load class by links carried: 1, 2-3, 4-7, 8 or more (round 10's steps). */
const cls = n => n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0;

// ── The styles ────────────────────────────────────────────────────────────────────────────────────────────────────
// A style is layers drawn in order; each layer is one colour at one opacity over the whole network (an SVG group's
// opacity, so roads that overlap at a junction do not darken), with a width per load class in ground units.
// `trail` gives the one-link roads a dash; `knock` cuts the next layer's width out of this one (a double line).
const STYLES = [
  { key: 'r10', name: 'Round 10 (today)', note: 'purple #6a5fee, dark casing, 0.7-1.6 wide',
    layers: [{ colour: '#141a20', alpha: 0.88, widths: [1.54, 1.79, 2.09, 2.44] }, { colour: '#6a5fee', alpha: 1, widths: [0.7, 0.95, 1.25, 1.6] }] },
  { key: 'ghost', name: 'Ghost lane', note: 'the lanes\' purple at 45%, no casing, 0.4-1.0',
    layers: [{ colour: '#6a5fee', alpha: 0.45, widths: [0.4, 0.55, 0.75, 1.0] }] },
  { key: 'hair', name: 'Hairline lane', note: 'pale purple #8a80ff at 80%, 0.25-0.7',
    layers: [{ colour: '#8a80ff', alpha: 0.8, widths: [0.25, 0.35, 0.5, 0.7] }] },
  { key: 'lavender', name: 'Lavender path', note: '#c4bff5 at 60%, 0.4-1.0',
    layers: [{ colour: '#c4bff5', alpha: 0.6, widths: [0.4, 0.55, 0.75, 1.0] }] },
  { key: 'worn', name: 'Worn track', note: 'the land darkened 16%, 0.6-1.5',
    layers: [{ colour: '#000000', alpha: 0.16, widths: [0.6, 0.8, 1.1, 1.5] }] },
  { key: 'worn-soft', name: 'Worn track, soft edge', note: 'a 7% verge under a 14% core',
    layers: [{ colour: '#000000', alpha: 0.07, widths: [1.3, 1.7, 2.2, 2.9] }, { colour: '#000000', alpha: 0.14, widths: [0.45, 0.6, 0.85, 1.15] }] },
  { key: 'pale', name: 'Pale footpath', note: 'paper #f6f1e3 at 50%, 0.4-1.0',
    layers: [{ colour: '#f6f1e3', alpha: 0.5, widths: [0.4, 0.55, 0.75, 1.0] }] },
  { key: 'pale-dash', name: 'Pale path, trails dashed', note: 'as the footpath; one-link roads dashed',
    layers: [{ colour: '#f6f1e3', alpha: 0.55, widths: [0.4, 0.55, 0.75, 1.0], trail: [1.4, 1.1] }] },
  { key: 'sand', name: 'Sandy track', note: 'tan #d8c79c at 60%, 0.5-1.3',
    layers: [{ colour: '#d8c79c', alpha: 0.6, widths: [0.5, 0.7, 0.95, 1.3] }] },
  { key: 'lane', name: 'Map lane', note: 'paper fill, a thin ink edge at 35%',
    layers: [{ colour: '#2a2723', alpha: 0.35, widths: [0.75, 0.9, 1.15, 1.4] }, { colour: '#f6f1e3', alpha: 0.85, widths: [0.45, 0.6, 0.85, 1.1] }] },
  { key: 'double', name: 'Cartographer\'s double line', note: 'two ink hairlines at 40%, the land between',
    layers: [{ colour: '#2a2723', alpha: 0.4, widths: [0.9, 1.1, 1.4, 1.75], knock: [0.5, 0.7, 1.0, 1.35] }] },
  { key: 'pencil', name: 'Pencil line', note: 'ink #2a2723 at 40%, 0.3-0.75',
    layers: [{ colour: '#2a2723', alpha: 0.4, widths: [0.3, 0.4, 0.55, 0.75] }] },
  { key: 'dots', name: 'Dotted trail', note: 'paper dots at 70%, every 1.5 units',
    layers: [{ colour: '#f6f1e3', alpha: 0.7, widths: [0.5, 0.6, 0.8, 1.0], dots: 1.5 }] },
  { key: 'steep', name: 'Quiet lanes, one clear trunk', note: 'paper at 55%: hairline lanes, only 8+ wide',
    layers: [{ colour: '#f6f1e3', alpha: 0.55, widths: [0.28, 0.34, 0.55, 1.15] }] },
  // Pale roads read like the white borders, so the last four quieten the borders instead.
  { key: 'pale-faint', name: 'Pale footpath, faint borders', note: '7, with the borders white at 40%',
    border: { colour: '#f4f7f8', alpha: 0.4 }, layers: [{ colour: '#f6f1e3', alpha: 0.6, widths: [0.4, 0.55, 0.75, 1.0] }] },
  { key: 'pale-dark', name: 'Pale footpath, dark borders', note: '7, with the borders ink at 28%',
    border: { colour: '#1b2024', alpha: 0.28 }, layers: [{ colour: '#f6f1e3', alpha: 0.6, widths: [0.4, 0.55, 0.75, 1.0] }] },
  { key: 'sand-faint', name: 'Sandy track, faint borders', note: '9, with the borders white at 40%',
    border: { colour: '#f4f7f8', alpha: 0.4 }, layers: [{ colour: '#e2d3aa', alpha: 0.7, widths: [0.5, 0.7, 0.95, 1.3] }] },
  { key: 'worn-faint', name: 'Worn track, faint borders', note: '5, with the borders white at 40%',
    border: { colour: '#f4f7f8', alpha: 0.4 }, layers: [{ colour: '#000000', alpha: 0.16, widths: [0.6, 0.8, 1.1, 1.5] }] },
];

// ── Drawing one swatch ────────────────────────────────────────────────────────────────────────────────────────────
const TILT = 0.77, PX = 2.6;
const f2 = v => +v.toFixed(2);
const pathOf = pts => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${f2(x)} ${f2(z)}`).join('');
let uid = 0;
/** One swatch: `view` is the ground window drawn [x0, z0, x1, z1], `scale` pixels a ground unit, `lit` the picked roads. */
function swatch(style, { view = [0, 0, W, H], scale = PX, lit = [] } = {}) {
  const id = `s${uid++}`, [x0, z0, x1, z1] = view, w = (x1 - x0) * scale, h = (z1 - z0) * scale * TILT;
  const sx = x => (x - x0) * scale, sz = z => (z - z0) * scale * TILT;
  const ground = `transform="translate(${f2(-x0 * scale)} ${f2(-z0 * scale * TILT)}) scale(${scale} ${f2(scale * TILT)})"`;
  const out = [];
  out.push(`<svg width="${f2(w)}" height="${f2(h)}" viewBox="0 0 ${f2(w)} ${f2(h)}" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<defs><clipPath id="${id}c"><rect width="${f2(w)}" height="${f2(h)}"/></clipPath>`);
  // The borders are cut at each gate's opening (3 units, wider where a wide road passes).
  out.push(`<mask id="${id}m" maskUnits="userSpaceOnUse" x="-10" y="-10" width="${W + 20}" height="${H + 20}"><rect x="-10" y="-10" width="${W + 20}" height="${H + 20}" fill="#fff"/>${gates.map(g => {
    const open = Math.max(3, style.layers.at(-1).widths[cls(g.links)] + 2), a = Math.atan2(g.along[1], g.along[0]) * 180 / Math.PI;
    return `<rect x="${f2(-open / 2)}" y="-1.2" width="${f2(open)}" height="2.4" transform="translate(${f2(g.at[0])} ${f2(g.at[1])}) rotate(${f2(a)})" fill="#000"/>`;
  }).join('')}</mask>`);
  for (const [li, layer] of style.layers.entries()) if (layer.knock) out.push(`<mask id="${id}k${li}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="${W + 20}" height="${H + 20}"><rect x="-10" y="-10" width="${W + 20}" height="${H + 20}" fill="#fff"/>${roads.map(r => `<path d="${pathOf(r.pts)}" fill="none" stroke="#000" stroke-width="${layer.knock[cls(r.links)]}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</mask>`);
  out.push(`</defs><g clip-path="url(#${id}c)"><rect width="${f2(w)}" height="${f2(h)}" fill="${LAND.sea}"/><g ${ground}>`);
  // The island's side, under the coast, then the land.
  out.push(`<path d="${pathOf([...coast, ...coast.slice().reverse().map(([x, z]) => [x, z + 7])])}Z" fill="${LAND.side}"/>`);
  for (const t of territories) out.push(`<path d="${pathOf(t.pts)}Z" fill="${t.fill}"/>`);
  out.push(`<path d="${pathOf(open)}Z" fill="${LAND.open}"/>`);
  out.push(`<path d="${pathOf(coast)}" fill="none" stroke="${LAND.coastLine}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  out.push(`<g mask="url(#${id}m)">${borders.map(([a, b]) => `<path d="${pathOf([a, b])}" stroke="${style.border?.colour ?? '#f4f7f8'}" stroke-opacity="${style.border?.alpha ?? 0.85}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}</g>`);
  // The roads, a layer at a time; each layer one group at one opacity, so overlaps at the junctions stay even.
  for (const [li, layer] of style.layers.entries()) {
    const stroke = r => {
      const wd = layer.widths[cls(r.links)];
      if (layer.dots) return `stroke-width="${wd}" stroke-dasharray="0.01 ${layer.dots}" stroke-linecap="round"`;
      if (layer.trail && r.links === 1) return `stroke-width="${wd}" stroke-dasharray="${layer.trail.join(' ')}" stroke-linecap="butt"`;
      return `stroke-width="${wd}" stroke-linecap="round"`;
    };
    out.push(`<g opacity="${layer.alpha}"${layer.knock ? ` mask="url(#${id}k${li})"` : ''}>${roads.map(r => `<path d="${pathOf(r.pts)}" fill="none" stroke="${layer.colour}" ${stroke(r)} stroke-linejoin="round"/>`).join('')}</g>`);
  }
  // The picked link, in gold along its whole way (round 10's lit, 0.75 wide), on a thin dark edge so it holds on yellow land.
  if (lit.length) out.push(`<g opacity="0.75">${roads.filter(r => lit.includes(r.id)).map(r => `<path d="${pathOf(r.pts)}" fill="none" stroke="#141a20" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g><g>${roads.filter(r => lit.includes(r.id)).map(r => `<path d="${pathOf(r.pts)}" fill="none" stroke="#ffd34d" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g>`);
  // Settlements (round 10's): a paper disc ringed in ink, graded by the roads meeting there.
  for (const t of towns) {
    const r = [1.05, 1.4, 1.75][t.grade], [x, z] = t.at, c = (rr, fill) => `<ellipse cx="${x}" cy="${z}" rx="${f2(rr)}" ry="${f2(rr)}" fill="${fill}"/>`;
    out.push(c(r + 0.25, '#141a20') + c(r, '#2a2723') + c(r - 0.36, '#f3efe4') + (t.grade === 2 ? c(r - 0.756, '#2a2723') + c(r - 1.044, '#f3efe4') : '') + (t.grade >= 1 ? c(0.42, '#2a2723') : ''));
  }
  // Gates (round 10's): an ink square with a paper face each side of the opening.
  for (const g of gates) {
    const [outer, face] = g.entrance ? [1.8, 1.15] : [1.45, 0.9], open = Math.max(3, style.layers.at(-1).widths[cls(g.links)] + 2), a = Math.atan2(g.along[1], g.along[0]) * 180 / Math.PI;
    for (const side of [-1, 1]) {
      const cx = g.at[0] + g.along[0] * (open / 2 + outer / 2) * side, cz = g.at[1] + g.along[1] * (open / 2 + outer / 2) * side;
      out.push(`<g transform="translate(${f2(cx)} ${f2(cz)}) rotate(${f2(a)})"><rect x="${-outer / 2}" y="${-outer / 2}" width="${outer}" height="${outer}" fill="#1b2024"/><rect x="${-face / 2}" y="${-face / 2}" width="${face}" height="${face}" fill="#f3efe4"/></g>`);
    }
  }
  out.push(`</g>`);
  // Names: the map's dark pills, upright on the page.
  for (const n of names) {
    const fs = Math.max(10, Math.min(16, 10 * scale / PX * 0.75)), tw = n.text.length * fs * 0.52 + 10, th = fs + 5, x = sx(n.at[0]), y = sz(n.at[1]);
    out.push(`<g transform="translate(${f2(x)} ${f2(y)})"><rect x="${f2(-tw / 2)}" y="${f2(-th / 2)}" width="${f2(tw)}" height="${f2(th)}" rx="${f2(th / 2)}" fill="#1b1f23" fill-opacity="0.72"/><text y="${f2(fs * 0.35)}" text-anchor="middle" font-size="${f2(fs)}" fill="#e8ece4" font-family="Noto Sans, Segoe UI, sans-serif">${n.text.replace(/'/g, '&#39;')}</text></g>`);
  }
  out.push(`</g></svg>`);
  return out.join('');
}

const cell = (style, n, opts) => `<figure><div class="swatch">${swatch(style, opts)}</div><figcaption><b>${n}. ${style.name}</b><span>${style.note}</span></figcaption></figure>`;
const sheet = (title, opts) => `<section><h2>${title}</h2><div class="grid">${STYLES.map((s, i) => cell(s, i + 1, opts)).join('')}</div></section>`;
const CLOSE = { view: [18, 8, 74, 60], scale: 6.2 };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quiet roads</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #101418; color: #d9dee2; font: 13px/1.35 "Noto Sans", "Segoe UI", sans-serif; }
main { padding: 18px 22px 28px; }
h1 { font-size: 17px; margin: 0 0 4px; font-weight: 600; } p.lede { margin: 0 0 14px; color: #9aa6ae; max-width: 980px; }
h2 { font-size: 13px; font-weight: 600; color: #9aa6ae; text-transform: uppercase; letter-spacing: .06em; margin: 10px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(4, max-content); gap: 14px 16px; }
figure { margin: 0; } .swatch { line-height: 0; border-radius: 6px; overflow: hidden; outline: 1px solid #222b32; }
figcaption { margin-top: 5px; display: flex; flex-direction: column; } figcaption b { font-weight: 600; } figcaption span { color: #8b979f; font-size: 12px; }
section + section { margin-top: 22px; }
</style></head><body><main>
<h1>Quiet roads: one piece of The library, eighteen road styles</h1>
<p class="lede">The same piece of land and the same roads in every swatch, at the map's resting scale and tilt. Only the road changes (and, in 15-18, the borders); gates, settlements and names are round 10's. The picked link's gold has a thin dark edge here, so it holds on yellow land. Widths step with the links a road carries (1, 2-3, 4-7, 8+): the trunk from the mouth carries 12.</p>
<div id="rest">${sheet('At rest', {})}</div>
<div id="close">${sheet('Close up, round Library API', CLOSE)}</div>
<div id="lit">${sheet('A link picked (gold, on a thin dark edge), at rest', { lit: LIT })}</div>
</main></body></html>`;
writeFileSync(path.join(pieces, 'roads.html'), html);
console.error(`wrote ${path.join(pieces, 'roads.html')} (${STYLES.length} styles, ${gates.length} gates)`);

if (process.argv.includes('--shots')) {
  const { withCapture } = await import('../../../../../../apps/desktop/src/capture/index.ts');
  await withCapture({ dist: pieces, folder: path.join(pieces, 'stills') }, async ({ browser, origin, out }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    await page.goto(`${origin}/roads.html`, { waitUntil: 'load' });
    for (const id of ['rest', 'close', 'lit']) {
      const el = await page.$(`#${id}`), file = path.join(out, `roads-${id}.png`);
      await el.screenshot({ path: file });
      console.error(file);
    }
  });
}
