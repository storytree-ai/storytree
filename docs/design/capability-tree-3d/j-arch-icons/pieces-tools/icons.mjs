// Round 12's icon pieces: round 11's road piece (one piece of The library's land: Library API, Graduation, The library's
// commands, Work model, the open land at the mouth, the coast; pieces/roads-tools/roads.mjs in ../h-quiet-roads) with the
// sandy track Mick picked and round 11's standing gate posts, and each settlement drawn as the architecture-diagram symbol
// for its capability's kind (../kinds.mjs) in three styles, against round 11's disc:
//   0. round 11's settlement, a paper disc ringed in ink;
//   1. flat symbols: the symbol's outline in ink on a paper fill, laid on the ground;
//   2. standing symbols: small solids that match the standing gate posts (a cylinder for a store, a box for a service...);
//   3. tokens: round 11's disc inverted, ink with the symbol drawn in paper, laid on the ground.
// At the map's resting scale and tilt (about 2.6 pixels a ground unit, the ground 0.77 as deep as it is wide), close up,
// and the six kinds side by side. Writes pieces/icons.html (static SVG, opens from disk); --shots takes the stills (into
// pieces/stills with --retake, else the capture kit's scratch folder).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/j-arch-icons/pieces-tools/icons.mjs [--shots [--retake]]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS, KIND_NAMES } from '../kinds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), pieces = path.join(path.dirname(here), 'pieces');

// ── The land, in ground units (x across, z down the page): round 11's road piece ───────────────────────────────────
const W = 124, H = 80;
const LAND = { healthy: '#8eb35e', untested: '#d6bd6c', open: '#686d70', sea: '#18242d', side: '#374335', coastLine: '#edf1f1' };
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
const coast = [[124, 58], [119, 63], [116, 70], [111, 75], [106, 80]];
const open = [V.s, V.t, V.u, [106, 80], ...[...coast].reverse()];
const borders = [['d', 'b'], ['d', 'e'], ['e', 'f'], ['f', 'g'], ['g', 'h'], ['h', 'i'], ['f', 'l'], ['l', 'k'], ['k', 'j'], ['g', 'm'], ['m', 'n'], ['s', 't'], ['t', 'u']].map(([p, q]) => [V[p], V[q]]);
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
/** The settlements, each with its capability's kind (../kinds.mjs) and round 11's grade (1-2, 3-5, 6+ roads meeting). */
const towns = [{ at: S1, grade: 2, kind: 'service' }, { at: S2, grade: 1, kind: 'log' }, { at: S3, grade: 0, kind: 'service' }, { at: S4, grade: 0, kind: 'store' }];
const names = [{ text: 'Library API', at: [S1[0], S1[1] - 6.5] }, { text: 'Graduation', at: [S2[0] + 14, S2[1] - 4] }, { text: "The library's commands", at: [S3[0] - 6, S3[1] + 6.5] }, { text: 'Work model', at: [S4[0] + 4, S4[1] + 6.5] }];
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
const cls = n => n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0;
/** Round 11's pick: the sandy track, the borders white at 40%. */
const ROAD = { colour: '#e2d3aa', alpha: 0.7, widths: [0.5, 0.7, 0.95, 1.3] };

// ── The marks' sizes and colours (overlay.ts's PALETTE and RELIEF) ──────────────────────────────────────────────────
const C = { ink: '#2a2723', paper: '#f3efe4', casing: '#141a20', post: '#1b2024', slate: '#9aa2a8' };
/** A symbol's box across, in ground units, by grade: a step larger than round 11's disc (2.1, 2.8, 3.5 across). */
const ICON = [3.4, 4.0, 4.7];
const TILT = 0.77, UP = Math.sqrt(1 - TILT * TILT), PX = 2.6;
/** Toward the light on the ground (from the upper left at rest: north-west), and a face's shade by where it faces. */
const LH = (() => { const l = Math.hypot(0.6, 0.75); return [-0.6 / l, -0.75 / l]; })();
const shadeOf = n => 0.56 + 0.28 * ((n[0] * LH[0] + n[1] * LH[1]) / (Math.hypot(...n) || 1) + 1) / 2;
const hexMul = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(Math.min(255, parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('');

const f2 = v => +v.toFixed(2);
const pathOf = pts => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${f2(x)} ${f2(z)}`).join('');

/** A drawing context: `view` the ground window [x0, z0, x1, z1], `scale` pixels a ground unit. */
function frame(view, scale) {
  const [x0, z0] = view;
  /** A ground point at height `y`, on the page. */
  const scr = (x, z, y = 0) => [(x - x0) * scale, ((z - z0) * TILT - y * UP) * scale];
  const pts = list => list.map(p => p.map(f2).join(',')).join(' ');
  /** A solid standing on the ground: `foot` its footprint (ground points, any winding), from `base` to `base + h`. Its sides
   * that face the page are shaded by the light, its top `top` (or an ink top with a paper face, `face`), and its shadow. */
  const prism = (foot, base, h, { side = C.slate, top = C.paper, edge = C.ink, face, edgeWidth = 0.16, shadow = true } = {}) => {
    const cx = foot.reduce((s, p) => s + p[0], 0) / foot.length, cz = foot.reduce((s, p) => s + p[1], 0) / foot.length;
    const out = [];
    if (shadow && base === 0) {
      const away = [-LH[0] * h * 0.8, -LH[1] * h * 0.8], hull = [...foot, ...foot.map(p => [p[0] + away[0], p[1] + away[1]])];
      const mx = hull.reduce((s, p) => s + p[0], 0) / hull.length, mz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
      hull.sort((a, b) => Math.atan2(a[1] - mz, a[0] - mx) - Math.atan2(b[1] - mz, b[0] - mx));
      out.push(`<polygon points="${pts(hull.map(p => scr(p[0], p[1])))}" fill="#000" fill-opacity="0.22"/>`);
    }
    for (let i = 0; i < foot.length; i++) {
      const a = foot[i], b = foot[(i + 1) % foot.length], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let n = [-(b[1] - a[1]), b[0] - a[0]];
      if (n[0] * (mid[0] - cx) + n[1] * (mid[1] - cz) < 0) n = [-n[0], -n[1]];
      if (n[1] <= 0) continue;
      const colour = hexMul(side, shadeOf(n));
      out.push(`<polygon points="${pts([scr(a[0], a[1], base), scr(b[0], b[1], base), scr(b[0], b[1], base + h), scr(a[0], a[1], base + h)])}" fill="${colour}" stroke="${colour}" stroke-width="0.4"/>`);
    }
    const t = foot.map(p => scr(p[0], p[1], base + h));
    out.push(`<polygon points="${pts(t)}" fill="${face ? C.post : top}"${face ? '' : ` stroke="${edge}" stroke-width="${f2(edgeWidth * scale)}" stroke-linejoin="round"`}/>`);
    if (face) out.push(`<polygon points="${pts(foot.map(p => scr(cx + (p[0] - cx) * face, cz + (p[1] - cz) * face, base + h + 0.01)))}" fill="${C.paper}"/>`);
    return { svg: out.join(''), z: cz };
  };
  const rect = (cx, cz, w, d, rot = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]); };
  const circle = (cx, cz, r, n = 28) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos(2 * Math.PI * k / n), cz + r * Math.sin(2 * Math.PI * k / n)]);
  /** A flat glyph laid on the ground at height `y`, centred at (x, z), `size` ground units across its 24-unit box. */
  const laid = (x, z, y, size) => { const k = size / 24, [ex, ey] = scr(x, z, y); return `matrix(${f2(k * scale)} 0 0 ${f2(k * scale * TILT)} ${f2(ex)} ${f2(ey)})`; };
  return { scr, prism, rect, circle, laid, scale };
}

// ── The symbols, in each style ──────────────────────────────────────────────────────────────────────────────────────
const glyphSvg = (kind, { fill, stroke, width, casing }) => {
  const g = GLYPHS[kind], d = [...g.parts, ...g.lines];
  return (casing ? `<g fill="none" stroke="${casing}" stroke-opacity="0.55" stroke-width="${width + 2.2}" stroke-linejoin="round" stroke-linecap="round">${d.map(p => `<path d="${p}"/>`).join('')}</g>` : '')
    + g.parts.map(p => `<path d="${p}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`).join('')
    + g.lines.map(p => `<path d="${p}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
};
/** Round 11's settlement disc, laid on the ground. */
function disc(F, x, z, grade) {
  const r = [1.05, 1.4, 1.75][grade], [cx, cy] = F.scr(x, z), e = (rr, fill) => `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${f2(rr * F.scale)}" ry="${f2(rr * F.scale * TILT)}" fill="${fill}"/>`;
  return e(r + 0.25, C.casing) + e(r, C.ink) + e(r - 0.36, C.paper) + (grade === 2 ? e(r - 0.756, C.ink) + e(r - 1.044, C.paper) : '') + (grade >= 1 ? e(0.42, C.ink) : '');
}
/** Style 1: the symbol's outline in ink on a paper fill, on a faint dark casing, laid on the ground. */
const flat = (F, x, z, kind, size) => `<g transform="${F.laid(x, z, 0, size)}">${glyphSvg(kind, { fill: C.paper, stroke: C.ink, width: 2.1, casing: C.casing })}</g>`;
/** Style 3: an ink token, the symbol drawn on it in paper. */
function token(F, x, z, kind, size) {
  const r = size * 0.62, [cx, cy] = F.scr(x, z), e = (rr, fill) => `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${f2(rr * F.scale)}" ry="${f2(rr * F.scale * TILT)}" fill="${fill}"/>`;
  return e(r + 0.25, C.casing) + e(r, C.ink) + `<g transform="${F.laid(x, z, 0, size * 0.78)}">${glyphSvg(kind, { fill: C.ink, stroke: C.paper, width: 2.0 })}</g>`;
}
/** Style 2: a small solid for the kind, standing on the ground, slate sides and a paper top edged in ink, like the posts. */
function standing(F, x, z, kind, size) {
  const s = size, parts = [];
  const P = (foot, base, h, o) => parts.push(F.prism(foot, base, h, o));
  if (kind === 'store') {
    const r = s * 0.33, h = s * 0.5;
    P(F.circle(x, z, r), 0, h);
    // The band round the cylinder's front, in ink, as a database is drawn.
    const band = Array.from({ length: 15 }, (_, k) => { const a = Math.PI * k / 14; return F.scr(x + r * Math.cos(a), z + r * Math.sin(a), h * 0.5); });
    parts.push({ svg: `<polyline points="${band.map(p => p.map(f2).join(',')).join(' ')}" fill="none" stroke="${C.ink}" stroke-opacity="0.7" stroke-width="${f2(0.14 * F.scale)}"/>`, z: z + 0.01 });
  } else if (kind === 'service') {
    P(F.rect(x + s * 0.06, z, s * 0.6, s * 0.48), 0, s * 0.3);
    for (const dz of [-0.11, 0.11]) P(F.rect(x - s * 0.28, z + dz * s, s * 0.2, s * 0.12), 0, s * 0.18, { edgeWidth: 0.12 });
  } else if (kind === 'queue') {
    for (const dx of [-0.3, 0, 0.3]) P(F.rect(x + dx * s, z, s * 0.24, s * 0.24), 0, s * 0.24, { edgeWidth: 0.12 });
  } else if (kind === 'index') {
    const hex = Array.from({ length: 6 }, (_, k) => [x + s * 0.36 * Math.cos(Math.PI / 6 + k * Math.PI / 3), z + s * 0.36 * Math.sin(Math.PI / 6 + k * Math.PI / 3)]);
    P(hex, 0, s * 0.16);
    parts.push({ svg: `<g transform="${F.laid(x, z, s * 0.16 + 0.01, s * 0.5)}">${GLYPHS.index.parts.map(p => `<path d="${p}" fill="none" stroke="${C.ink}" stroke-width="2.6"/>`).join('')}${GLYPHS.index.lines.map(p => `<path d="${p}" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`).join('')}</g>`, z: z + 0.5 });
  } else if (kind === 'link') {
    P(F.rect(x, z, s * 0.42, s * 0.32), 0, s * 0.26);
    for (const dx of [-0.1, 0.1]) P(F.rect(x + dx * s, z, s * 0.06, s * 0.06), s * 0.26, s * 0.2, { side: '#59626a', top: C.ink, edgeWidth: 0.04, shadow: false });
  } else if (kind === 'log') {
    for (let k = 0; k < 3; k++) P(F.rect(x + (k - 1) * s * 0.05, z + (1 - k) * s * 0.05, s * 0.5, s * 0.4), k * s * 0.09, s * 0.09, { edgeWidth: 0.12, shadow: k === 0 });
  }
  // Painted back to front (the page's depth is z), shadows first.
  const shadows = [], rest = [];
  for (const p of parts) { const m = p.svg.match(/^<polygon[^>]*fill-opacity="0.22"\/>/); if (m) { shadows.push(m[0]); rest.push({ svg: p.svg.slice(m[0].length), z: p.z }); } else rest.push(p); }
  return shadows.join('') + rest.sort((a, b) => a.z - b.z).map(p => p.svg).join('');
}
/** Round 11's standing gate post (RELIEF.post): ink top with a paper face, slate sides. */
const post = (F, cx, cz, along, entrance) => {
  const side = entrance ? 1.4 : 1.2, tall = entrance ? 1.2 : 1.0, rot = Math.atan2(along[1], along[0]);
  return F.prism(F.rect(cx, cz, side, side, rot), 0, tall, { face: 0.62 });
};
const STYLES = [
  { key: 'disc', name: "Round 11's settlement", note: 'a paper disc ringed in ink, graded by roads meeting', draw: (F, t) => disc(F, t.at[0], t.at[1], t.grade) },
  { key: 'flat', name: 'Flat symbols', note: 'the outline in ink on paper, laid on the ground', draw: (F, t) => flat(F, t.at[0], t.at[1], t.kind, ICON[t.grade]) },
  { key: 'standing', name: 'Standing symbols', note: 'small solids, slate and paper, like the gate posts', draw: (F, t) => standing(F, t.at[0], t.at[1], t.kind, ICON[t.grade]) },
  { key: 'token', name: 'Symbol tokens', note: "round 11's disc inverted: ink, the symbol in paper", draw: (F, t) => token(F, t.at[0], t.at[1], t.kind, ICON[t.grade]) },
];

// ── One piece ─────────────────────────────────────────────────────────────────────────────────────────────────────
let uid = 0;
function piece(style, { view = [0, 0, W, H], scale = PX } = {}) {
  const id = `s${uid++}`, [x0, z0, x1, z1] = view, w = (x1 - x0) * scale, h = (z1 - z0) * scale * TILT, F = frame(view, scale);
  const ground = `transform="translate(${f2(-x0 * scale)} ${f2(-z0 * scale * TILT)}) scale(${scale} ${f2(scale * TILT)})"`;
  const out = [`<svg width="${f2(w)}" height="${f2(h)}" viewBox="0 0 ${f2(w)} ${f2(h)}" xmlns="http://www.w3.org/2000/svg">`];
  out.push(`<defs><clipPath id="${id}c"><rect width="${f2(w)}" height="${f2(h)}"/></clipPath>`);
  out.push(`<mask id="${id}m" maskUnits="userSpaceOnUse" x="-10" y="-10" width="${W + 20}" height="${H + 20}"><rect x="-10" y="-10" width="${W + 20}" height="${H + 20}" fill="#fff"/>${gates.map(g => {
    const o = Math.max(3, ROAD.widths[cls(g.links)] + 2), a = Math.atan2(g.along[1], g.along[0]) * 180 / Math.PI;
    return `<rect x="${f2(-o / 2)}" y="-1.2" width="${f2(o)}" height="2.4" transform="translate(${f2(g.at[0])} ${f2(g.at[1])}) rotate(${f2(a)})" fill="#000"/>`;
  }).join('')}</mask></defs><g clip-path="url(#${id}c)"><rect width="${f2(w)}" height="${f2(h)}" fill="${LAND.sea}"/><g ${ground}>`);
  out.push(`<path d="${pathOf([...coast, ...coast.slice().reverse().map(([x, z]) => [x, z + 7])])}Z" fill="${LAND.side}"/>`);
  for (const t of territories) out.push(`<path d="${pathOf(t.pts)}Z" fill="${t.fill}"/>`);
  out.push(`<path d="${pathOf(open)}Z" fill="${LAND.open}"/>`);
  out.push(`<path d="${pathOf(coast)}" fill="none" stroke="${LAND.coastLine}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  out.push(`<g mask="url(#${id}m)">${borders.map(([a, b]) => `<path d="${pathOf([a, b])}" stroke="#f4f7f8" stroke-opacity="0.4" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}</g>`);
  out.push(`<g opacity="${ROAD.alpha}">${roads.map(r => `<path d="${pathOf(r.pts)}" fill="none" stroke="${ROAD.colour}" stroke-width="${ROAD.widths[cls(r.links)]}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g>`);
  out.push(`</g>`);
  // The posts and the settlements, back to front down the page.
  const marks = [];
  for (const g of gates) {
    const o = Math.max(3, ROAD.widths[cls(g.links)] + 2), side = g.entrance ? 1.4 : 1.2;
    for (const sg of [-1, 1]) { const p = post(F, g.at[0] + g.along[0] * (o / 2 + side / 2) * sg, g.at[1] + g.along[1] * (o / 2 + side / 2) * sg, g.along, g.entrance); marks.push(p); }
  }
  for (const t of towns) marks.push({ svg: style.draw(F, t), z: t.at[1] });
  out.push(marks.sort((a, b) => a.z - b.z).map(m => m.svg).join(''));
  for (const n of names) {
    const fs = Math.max(10, Math.min(16, 10 * scale / PX * 0.75)), tw = n.text.length * fs * 0.52 + 10, th = fs + 5, [x, y] = F.scr(n.at[0], n.at[1]);
    out.push(`<g transform="translate(${f2(x)} ${f2(y)})"><rect x="${f2(-tw / 2)}" y="${f2(-th / 2)}" width="${f2(tw)}" height="${f2(th)}" rx="${f2(th / 2)}" fill="#1b1f23" fill-opacity="0.72"/><text y="${f2(fs * 0.35)}" text-anchor="middle" font-size="${f2(fs)}" fill="#e8ece4" font-family="Noto Sans, Segoe UI, sans-serif">${n.text.replace(/'/g, '&#39;')}</text></g>`);
  }
  out.push(`</g></svg>`);
  return out.join('');
}
/** The six kinds side by side, on healthy land, at grade 1, in one style. */
function kinds(style, scale) {
  const list = Object.keys(GLYPHS), gap = 11, labelled = scale > 4, w = list.length * gap * scale, h = (labelled ? 12 : 8) * scale * TILT, F = frame([0, 0], scale);
  const marks = list.map((kind, i) => style.draw(F, { at: [gap * (i + 0.5), 4.2], grade: 1, kind })).join('');
  const labels = !labelled ? "" : list.map((kind, i) => { const [x] = F.scr(gap * (i + 0.5), 0); return `<text x="${f2(x)}" y="${f2(h - 6)}" text-anchor="middle" font-size="${labelled ? 12 : 10}" fill="#1b2a12" font-family="Noto Sans, Segoe UI, sans-serif">${KIND_NAMES[kind]}</text>`; }).join('');
  return `<svg width="${f2(w)}" height="${f2(h)}" xmlns="http://www.w3.org/2000/svg"><rect width="${f2(w)}" height="${f2(h)}" fill="${LAND.healthy}"/>${marks}${labels}</svg>`;
}

const cell = (style, n, opts) => `<figure><div class="swatch">${piece(style, opts)}</div><figcaption><b>${n}. ${style.name}</b><span>${style.note}</span></figcaption></figure>`;
const sheet = (title, opts) => `<section><h2>${title}</h2><div class="grid">${STYLES.map((s, i) => cell(s, i, opts)).join('')}</div></section>`;
const CLOSE = { view: [14, 4, 96, 60], scale: 6.2 };
const kindSheet = `<section><h2>The six kinds, at rest and close up</h2><div class="kinds">${STYLES.slice(1).map((s, i) => `<figure><figcaption><b>${i + 1}. ${s.name}</b></figcaption><div class="swatch">${kinds(s, PX)}</div><div class="swatch">${kinds(s, 6.2)}</div></figure>`).join('')}</div></section>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Architecture symbols</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #101418; color: #d9dee2; font: 13px/1.35 "Noto Sans", "Segoe UI", sans-serif; }
main { padding: 18px 22px 28px; }
h1 { font-size: 17px; margin: 0 0 4px; font-weight: 600; } p.lede { margin: 0 0 14px; color: #9aa6ae; max-width: 980px; }
h2 { font-size: 13px; font-weight: 600; color: #9aa6ae; text-transform: uppercase; letter-spacing: .06em; margin: 10px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(2, max-content); gap: 14px 16px; }
.kinds { display: grid; grid-template-columns: repeat(3, max-content); gap: 14px 20px; } .kinds .swatch { margin-top: 6px; }
figure { margin: 0; } .swatch { line-height: 0; border-radius: 6px; overflow: hidden; outline: 1px solid #222b32; width: max-content; }
figcaption { margin-top: 5px; display: flex; flex-direction: column; } figcaption b { font-weight: 600; } figcaption span { color: #8b979f; font-size: 12px; }
section + section { margin-top: 22px; }
</style></head><body><main>
<h1>Architecture symbols for the settlements: one piece of The library, three styles</h1>
<p class="lede">Round 11's piece of land with its sandy track and standing gate posts, each settlement drawn as the symbol for its capability's kind: Library API and The library's commands are services, Graduation a record, Work model a store. Sizes step with the roads meeting there, as round 11's discs do.</p>
<div id="rest">${sheet('At rest', {})}</div>
<div id="close">${sheet('Close up, round Library API', CLOSE)}</div>
<div id="kinds">${kindSheet}</div>
</main></body></html>`;
writeFileSync(path.join(pieces, 'icons.html'), html);
console.error(`wrote ${path.join(pieces, 'icons.html')} (${STYLES.length} styles, ${gates.length} gates)`);

if (process.argv.includes('--shots')) {
  const { withCapture } = await import('../../../../../apps/desktop/src/capture/index.ts');
  await withCapture({ dist: pieces, folder: path.join(pieces, 'stills') }, async ({ browser, origin, out }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    await page.goto(`${origin}/icons.html`, { waitUntil: 'load' });
    for (const id of ['rest', 'close', 'kinds']) {
      const el = await page.$(`#${id}`), file = path.join(out, `icons-${id}.png`);
      await el.screenshot({ path: file });
      console.error(file);
    }
  });
}
