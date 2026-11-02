// Capability tree mock, round 6B: The library drawn as a circuit board. Every capability is a chip whose area is its
// lines of code and whose package is its health colour; every link is a copper trace that lands on its own gold pad
// (its gate) on the chip it calls. Callers sit to the right of what they call, so traces run one way. Traces are routed
// on an 8-pixel grid by a maze router (A*) that prefers straight runs, avoids chips and names, and lets a trace pass
// under another only at a cost (drawn as a break with two vias). Links from other stories enter at the right-hand edge
// connector, one gold finger per calling capability, and a finger's trace splits where it serves several pads.
(() => {
  'use strict';
  const D = window.CAPTREE;
  const STORY = D.story.id;
  const G = 8; // grid pitch, px
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = '"Segoe UI", "Helvetica Neue", "DejaVu Sans", Arial, sans-serif';
  const MONO = 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
  const HEALTH = { healthy: '#97C459', unhealthy: '#E24B4A', proposed: '#F2D16B', untested: '#F2D16B' };
  const PARKED = '#86939D';
  const C = {
    board: '#1f3a2d', boardEdge: '#2d5040', trace: '#c6914a', traceEdge: '#15291f', lit: '#ffe39a',
    pad: '#d9b45a', padEdge: '#7d5f27', silk: '#efe4c8', silk2: '#d9cdae', ink: '#1b1814', via: '#e0c27a',
  };

  // ---- the model ------------------------------------------------------------------------------------------------
  const caps = D.capabilities.map((c) => ({ ...c }));
  const byId = new Map(caps.map((c) => [c.id, c]));
  const links = [];
  for (const c of caps) for (const d of c.dependsOn) {
    if (d.storyId === STORY) links.push({ kind: 'in', from: c.id, to: d.id });
    else links.push({ kind: 'out', from: c.id, to: d.id, ext: d });
  }
  for (const i of D.incoming) links.push({ kind: 'inc', from: i.from, to: i.to, story: i.story, storyId: i.storyId, fromTitle: i.fromTitle });
  links.forEach((l, n) => { l.n = n; });
  const work = new Map(); // capability -> open increments naming it
  for (const w of D.openWork) for (const c of w.capabilities) { if (!work.has(c)) work.set(c, []); work.get(c).push(w); }

  // ---- text measure ---------------------------------------------------------------------------------------------
  // Widths are estimated from the character count, not measured, so the layout (and the routes saved for it) come out
  // the same on every machine whatever fonts it has; the estimate is generous, so names never overrun their space.
  const textW = (s, size, font = FONT, weight = '') => s.length * size * (font === MONO ? 0.61 : weight ? 0.6 : 0.56) + (/^[A-Z ]+$/.test(s) ? s.length * 1.2 : 0);
  const cells = (px) => Math.ceil(px / G);
  const NAME = 13, META = 10.5;
  const metaOf = (c) => `${c.lines.toLocaleString('en')} lines · ${c.contracts.length} contracts`;

  // ---- columns by dependency ------------------------------------------------------------------------------------
  const inDeps = (c) => c.dependsOn.filter((d) => d.storyId === STORY).map((d) => d.id);
  const memo = new Map();
  const layerOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    const ds = inDeps(byId.get(id)); const v = ds.length ? 1 + Math.max(...ds.map(layerOf)) : 0;
    memo.set(id, v); return v;
  };
  caps.forEach((c) => { c.layer = layerOf(c.id); });
  const callersOf = (id) => links.filter((l) => l.kind === 'in' && l.to === id).map((l) => byId.get(l.from));
  for (let pass = 0; pass < 6; pass++) for (const c of [...caps].sort((a, b) => b.layer - a.layer)) {
    const cs = callersOf(c.id); if (cs.length) c.layer = Math.max(c.layer, Math.min(...cs.map((x) => x.layer)) - 1);
  }
  const L = Math.max(...caps.map((c) => c.layer)) + 1;

  // ---- chip sizes: area by lines of code -------------------------------------------------------------------------
  for (const c of caps) {
    const side = Math.max(2, Math.round(Math.sqrt(c.lines) * 4.2 / G));
    c.w = side; c.h = side;
    c.pads = links.filter((l) => l.to === c.id && l.kind !== 'out');
    c.pins = links.filter((l) => l.from === c.id);
    c.h = Math.max(c.h, 2 * c.pads.length, 2 * c.pins.length);
    c.labelW = cells(Math.max(textW(c.title, NAME, FONT, '600'), textW(metaOf(c), META, MONO))) + 1;
    c.labelH = 4;
  }
  const colW = Array.from({ length: L }, (_, k) => Math.max(...caps.filter((c) => c.layer === k).map((c) => Math.max(c.w + 3, c.labelW))));
  const passing = (k) => links.filter((l) => {
    const a = byId.get(l.from), b = l.kind === 'out' ? null : byId.get(l.to);
    const lo = l.kind === 'out' ? -1 : b.layer; const hi = l.kind === 'inc' ? L : a.layer;
    return lo <= k && k < hi;
  }).length;

  // External fingers: one per story whose capabilities call into this one (right edge; its trace splits to each gate),
  // and one per capability this story calls in another (left edge).
  const fingers = [];
  for (const l of links) {
    if (l.kind === 'inc') {
      let f = fingers.find((x) => x.side === 'R' && x.cap === l.storyId);
      if (!f) { f = { side: 'R', cap: l.storyId, title: l.story, story: l.story, storyId: l.storyId, callers: [], links: [] }; fingers.push(f); }
      if (!f.callers.includes(l.fromTitle)) f.callers.push(l.fromTitle);
      f.links.push(l); l.finger = f;
    } else if (l.kind === 'out') {
      let f = fingers.find((x) => x.side === 'L' && x.cap === l.to);
      if (!f) { f = { side: 'L', cap: l.to, title: l.ext.title, story: l.ext.story, storyId: l.ext.storyId, contracts: l.ext.contracts, links: [] }; fingers.push(f); }
      f.links.push(l); l.finger = f;
    }
  }
  const LABEL = 11.5, WRAP = 236;
  const wrap = (names) => { const out = []; let line = ''; for (const n of names) { const t = line ? line + ' · ' + n : n; if (line && textW(t, LABEL, FONT, '600') > WRAP) { out.push(line + ' ·'); line = n; } else line = t; } out.push(line); return out; };
  for (const f of fingers) { f.lines = f.side === 'R' ? wrap(f.callers) : [f.title]; f.labelW = cells(Math.max(...f.lines.map((s) => textW(s, LABEL, FONT, '600')))) + 2; }
  const storyHeads = (side) => [...new Set(fingers.filter((f) => f.side === side).map((f) => f.story))];
  const zoneW = (side) => Math.max(10, ...fingers.filter((f) => f.side === side).map((f) => f.labelW + 3),
    ...storyHeads(side).map((s) => cells(textW(s.toUpperCase(), 11, FONT, '700')) + 4));

  const M = 6; // margin cells
  const leftZone = zoneW('L'), rightZone = zoneW('R');
  const colX = []; let cursor = M + leftZone + 8 + Math.round(passing(-1) * 1);
  for (let k = 0; k < L; k++) { colX[k] = cursor; cursor += colW[k] + 8 + Math.round(passing(k) * 0.9); }
  const rightZoneX = cursor; const Wc = cursor + rightZone + M;
  for (const c of caps) c.x = colX[c.layer] + 2;

  // ---- rows: barycentre ordering, then spacing -------------------------------------------------------------------
  const GAP = 5; // free rows between one chip and the next block's name
  const block = (c) => c.labelH + c.h;
  const neigh = (c) => links.filter((l) => l.kind === 'in' && (l.from === c.id || l.to === c.id)).map((l) => byId.get(l.from === c.id ? l.to : l.from));
  const cols = Array.from({ length: L }, (_, k) => caps.filter((c) => c.layer === k));
  for (const col of cols) { let y = 0; for (const c of col) { c.top = y; y += block(c) + GAP; } }
  const centre = (c) => c.top + c.labelH + c.h / 2;
  const place = (col) => {
    col.sort((a, b) => a.want - b.want);
    let y = -Infinity;
    for (const c of col) { c.top = Math.max(Math.round(c.want - c.labelH - c.h / 2), y); y = c.top + block(c) + GAP; }
    // pull the column back up by half its overflow so the stack stays centred on what it wants
    const over = col.reduce((s, c) => s + (centre(c) - c.want), 0) / col.length; for (const c of col) c.top -= Math.round(over);
    y = -Infinity; for (const c of col) { c.top = Math.max(c.top, y); y = c.top + block(c) + GAP; }
  };
  for (let it = 0; it < 12; it++) {
    const order = it % 2 ? [...cols].reverse() : cols;
    for (const col of order) {
      for (const c of col) { const ns = neigh(c); c.want = ns.length ? ns.reduce((s, n) => s + centre(n), 0) / ns.length : centre(c); }
      place(col);
    }
  }
  const TOP = M + 8; // title band
  const minTop = Math.min(...caps.map((c) => c.top));
  for (const c of caps) { c.top += TOP - minTop; c.y = c.top + c.labelH; }

  // fingers: place by where they lead
  const placeFingers = (side) => {
    const fs = fingers.filter((f) => f.side === side);
    for (const f of fs) { const ys = f.links.map((l) => centre(byId.get(side === 'R' ? l.to : l.from))); f.want = ys.reduce((a, b) => a + b, 0) / ys.length; }
    const groups = storyHeads(side).map((s) => ({ s, fs: fs.filter((f) => f.story === s) }));
    for (const g of groups) { g.fs.sort((a, b) => a.want - b.want); g.want = g.fs.reduce((a, f) => a + f.want, 0) / g.fs.length; }
    groups.sort((a, b) => a.want - b.want);
    let y = TOP;
    for (const g of groups) {
      const h = 3 + g.fs.reduce((s, f) => s + 2 * f.lines.length + 2, 0);
      g.top = Math.max(y, Math.round(g.want - h / 2)); y = g.top + h + 3;
      let r = g.top + 2; for (const f of g.fs) { f.ltop = r; f.y = r + 2 * f.lines.length + 1; r = f.y + 1; }
    }
    return groups;
  };
  const groupsR = placeFingers('R'), groupsL = placeFingers('L');
  const Hc = Math.max(...caps.map((c) => c.y + c.h), ...fingers.map((f) => f.y + 2)) + M + 4;
  for (const f of fingers) {
    if (f.side === 'R') { f.x = Wc - 2; f.stubEnd = rightZoneX + 1; }
    else { f.x = 1; f.stubEnd = leftZone + M - 1; }
  }

  // ---- pads (gates) and pins on each chip -------------------------------------------------------------------------
  const srcY = (l) => (l.kind === 'inc' ? l.finger.y : centre(byId.get(l.from)));
  const dstY = (l) => (l.kind === 'out' ? l.finger.y : centre(byId.get(l.to)));
  const slots = (n, h, base) => {
    const pitch = Math.max(2, Math.min(3, Math.floor(h / Math.max(1, n))));
    const start = base + Math.floor((h - (pitch * (n - 1) + 1)) / 2);
    return Array.from({ length: n }, (_, i) => start + i * pitch);
  };
  for (const c of caps) {
    const pads = [...c.pads].sort((a, b) => srcY(a) - srcY(b));
    slots(pads.length, c.h, c.y).forEach((row, i) => { pads[i].pad = { x: c.x + c.w, y: row }; });
    const pins = [...c.pins].sort((a, b) => dstY(a) - dstY(b));
    slots(pins.length, c.h, c.y).forEach((row, i) => { pins[i].pin = { x: c.x - 1, y: row }; });
  }
  for (const l of links) if (l.kind === 'out') l.pad = { x: l.finger.stubEnd, y: l.finger.y, finger: true };

  // ---- the grid and the router ------------------------------------------------------------------------------------
  const N = Wc * Hc;
  const blocked = new Uint8Array(N); const owner = new Int32Array(N).fill(-1); const axis = new Uint8Array(N); const fixed = new Uint8Array(N);
  const reserved = new Int32Array(N).fill(-1);
  const at = (x, y) => y * Wc + x;
  const rect = (x0, y0, x1, y1, fn) => { for (let y = Math.max(0, y0); y <= Math.min(Hc - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(Wc - 1, x1); x++) fn(at(x, y)); };
  for (let x = 0; x < Wc; x++) { blocked[at(x, 0)] = 1; blocked[at(x, Hc - 1)] = 1; }
  for (let y = 0; y < Hc; y++) { blocked[at(0, y)] = 1; blocked[at(Wc - 1, y)] = 1; }
  for (const c of caps) {
    rect(c.x - 1, c.y - 1, c.x + c.w, c.y + c.h, (i) => { blocked[i] = 1; }); // chip and its pad ring
    rect(c.x - 1, c.top - 1, c.x + c.labelW, c.y - 2, (i) => { blocked[i] = 1; }); // its name
  }
  rect(M - 1, M - 1, M + cells(textW('THE LIBRARY', 22, FONT, '700')) + 2, TOP - 4, (i) => { blocked[i] = 1; });
  for (const side of ['R', 'L']) for (const g of side === 'R' ? groupsR : groupsL) {
    const x0 = side === 'R' ? rightZoneX : M; const x1 = side === 'R' ? Wc - 2 : leftZone + M;
    rect(x0, g.top, x1, g.top + 1, (i) => { blocked[i] = 1; });
  }
  // finger labels sit just above their stub, the stub is fixed copper
  const groupOf = (l) => (l.finger ? 'f:' + l.finger.side + l.finger.cap : 'l:' + l.n);
  const gid = new Map(); const gnum = (l) => { const k = groupOf(l); if (!gid.has(k)) gid.set(k, gid.size); return gid.get(k); };
  for (const f of fingers) {
    const g = gnum(f.links[0]); const [a, b] = f.side === 'R' ? [f.stubEnd, Wc - 2] : [1, f.stubEnd];
    rect(a, f.ltop, b, f.y - 1, (i) => { blocked[i] = 1; });
    rect(a, f.y + 1, b, f.y + 1, (i) => { blocked[i] = 1; });
    for (let x = a; x <= b; x++) { const i = at(x, f.y); owner[i] = g; axis[i] |= 1; fixed[i] = 1; }
  }
  // reserve each pad's and pin's escape cell for its own link
  const esc = (p, dx) => at(p.x + dx, p.y);
  for (const l of links) { if (l.pin) reserved[esc(l.pin, -1)] = gnum(l); if (l.pad && !l.pad.finger) reserved[esc(l.pad, 1)] = gnum(l); }

  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  class Heap { constructor() { this.k = []; this.v = []; } push(k, v) { const a = this.k, b = this.v; let i = a.length; a.push(k); b.push(v); while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= k) break; a[i] = a[p]; b[i] = b[p]; i = p; } a[i] = k; b[i] = v; }
    pop() { const a = this.k, b = this.v; const top = b[0]; const k = a.pop(), v = b.pop(); if (a.length) { let i = 0; const n = a.length; for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && a[l + 1] < a[l]) l++; if (a[l] >= k) break; a[i] = a[l]; b[i] = b[l]; i = l; } a[i] = k; b[i] = v; } return top; }
    get size() { return this.v.length; } }

  // Routes from `start` (leaving in direction d0) to `goal` (entered moving in direction dGoal).
  const route = (g, start, d0, goal, dGoal) => {
    const best = new Float32Array(N * 4).fill(Infinity); const prev = new Int32Array(N * 4).fill(-1);
    const gx = goal % Wc, gy = (goal / Wc) | 0; const shared = started.has(g);
    const hw = shared ? 0.25 : 1;
    const h = (i) => hw * (Math.abs((i % Wc) - gx) + Math.abs(((i / Wc) | 0) - gy));
    const heap = new Heap(); const s0 = start * 4 + d0; best[s0] = 0; heap.push(h(start), s0);
    while (heap.size) {
      const s = heap.pop(); const i = s >> 2, d = s & 3; const cost = best[s];
      if (i === goal && d === dGoal) {
        const path = []; let t = s; while (t !== -1) { path.push(t >> 2); t = prev[t]; } return path.reverse();
      }
      const foreign = owner[i] !== -1 && owner[i] !== g;
      for (let nd = 0; nd < 4; nd++) {
        if ((nd ^ 1) === d && (nd >> 1) === (d >> 1)) continue; // no U-turn
        if (foreign && nd !== d) continue; // never bend where passing under another trace
        const x = (i % Wc) + DX[nd], y = ((i / Wc) | 0) + DY[nd]; if (x < 0 || y < 0 || x >= Wc || y >= Hc) continue;
        const j = at(x, y);
        if (j === goal) { if (nd !== dGoal) continue; }
        else {
          if (blocked[j] || (reserved[j] !== -1 && reserved[j] !== g)) continue;
          if (owner[j] !== -1 && owner[j] !== g) {
            const ax = nd < 2 ? 1 : 2; if (fixed[j] || (axis[j] & ax) || axis[j] === 3) continue;
          }
        }
        let c = owner[j] === g ? 0.25 : 1;
        if (nd !== d) c += 6;
        if (owner[j] !== -1 && owner[j] !== g) c += 90;
        // a little rent for hugging another trace, so parallel runs keep a clean pitch
        const ns = j; for (const q of [ns - 1, ns + 1, ns - Wc, ns + Wc]) if (q >= 0 && q < N && owner[q] !== -1 && owner[q] !== g) { c += 0.15; }
        const ns2 = j * 4 + nd; const nc = cost + c;
        if (nc < best[ns2]) { best[ns2] = nc; prev[ns2] = s; heap.push(nc + h(j), ns2); }
      }
    }
    return null;
  };
  const commit = (l, path) => {
    const g = gnum(l); l.path = path; l.under = [];
    for (let k = 0; k < path.length; k++) {
      const i = path[k]; const a = path[k - 1], b = path[k + 1];
      const horiz = (p, q) => p !== undefined && q !== undefined && Math.abs(p - q) === 1;
      const ax = (horiz(a, i) || horiz(i, b)) ? 1 : 2;
      const bend = a !== undefined && b !== undefined && (b - i) !== (i - a);
      if (owner[i] !== -1 && owner[i] !== g) { l.under.push(k); axis[i] = 3; fixed[i] = 1; continue; }
      owner[i] = g; axis[i] |= ax; if (bend || k === 0 || k === path.length - 1) fixed[i] = 1;
    }
  };
  // Routing order matters: the first traces get the straight runs. Try a few honest orders and keep the one whose
  // traces pass under each other least (ties: fewest bends), so the board stays calm.
  const span = (l) => (l.kind === 'in' ? byId.get(l.from).layer - byId.get(l.to).layer : 99);
  const dy = (l) => Math.abs(srcY(l) - dstY(l));
  const orders = [
    [...links].sort((a, b) => span(a) - span(b) || dy(a) - dy(b)),
    [...links].sort((a, b) => (a.kind === 'inc') - (b.kind === 'inc') || dy(a) - dy(b)),
    [...links].sort((a, b) => (b.kind === 'inc') - (a.kind === 'inc') || span(a) - span(b) || dy(a) - dy(b)),
    [...links].sort((a, b) => dy(a) - dy(b)),
    [...links].sort((a, b) => (b.kind === 'inc') - (a.kind === 'inc') || dy(b) - dy(a)),
  ];
  const base = { owner: owner.slice(), axis: axis.slice(), fixed: fixed.slice() };
  const started = new Set();
  const reset = () => { owner.set(base.owner); axis.set(base.axis); fixed.set(base.fixed); started.clear(); };
  const commitAll = (list) => { reset(); for (const l of list) if (l.path) { commit(l, l.path); started.add(gnum(l)); } };
  const routeOne = (l) => {
    const start = l.kind === 'inc' ? at(l.finger.stubEnd, l.finger.y) : at(l.pin.x, l.pin.y);
    const p = route(gnum(l), start, 1, at(l.pad.x, l.pad.y), 1);
    if (!p) return null;
    if (l.kind === 'inc') { const stub = []; for (let x = l.finger.x; x > l.finger.stubEnd; x--) stub.push(at(x, l.finger.y)); p.unshift(...stub); }
    if (l.kind === 'out') { for (let x = l.finger.stubEnd - 1; x >= l.finger.x; x--) p.push(at(x, l.finger.y)); }
    return p;
  };
  const bendsOf = (path) => path.filter((_, k) => k > 0 && k < path.length - 1 && path[k + 1] - path[k] !== path[k] - path[k - 1]).length;
  const scoreOf = () => links.reduce((s, l) => s + (l.path ? l.under.length * 100 + bendsOf(l.path) + l.path.length * 0.01 : 1e6), 0);
  const runAll = (order) => {
    reset();
    for (const l of links) { l.path = null; l.under = []; }
    for (const l of order) { const p = routeOne(l); if (p) { commit(l, p); started.add(gnum(l)); } }
    return { order: [...order], score: scoreOf() };
  };
  // Rip up and reroute: take each trace that passes under or over another out, route it again around everything else,
  // and keep the change only when the whole board scores better.
  const search = () => {
    const tried = orders.map((o) => runAll(o));
    let best = tried.reduce((a, b) => (b.score < a.score ? b : a));
    runAll(best.order); let order = best.order; let score = best.score;
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      const involved = (l) => { if (!l.path) return 1; const cells = new Set(l.path); return l.under.length + links.filter((m) => m !== l && m.path).reduce((s, m) => s + m.under.filter((k) => cells.has(m.path[k])).length, 0); };
      for (const l of [...links].sort((a, b) => involved(b) - involved(a))) {
        if (involved(l) === 0) continue;
        const keep = l.path; const others = order.filter((m) => m !== l);
        commitAll(others); const p = routeOne(l); if (!p) { commitAll(order); continue; }
        l.path = p; const next = [...others, l]; commitAll(next); const s = scoreOf();
        if (s < score - 0.5) { order = next; score = s; improved = true; } else { l.path = keep; commitAll(order); }
      }
      if (!improved) break;
    }
    return { order, tried: tried.map((t) => Math.round(t.score)), score: Math.round(score) };
  };
  const t0 = performance.now();
  const saved = window.CAPTREE_ROUTES;
  const wanted = new URLSearchParams(location.search).has('search');
  let searched = null;
  if (!wanted && saved && saved.grid === `${Wc}x${Hc}` && saved.links === links.length) {
    const byN = new Map(saved.order.map((n, k) => [n, k]));
    const order = [...links].sort((a, b) => byN.get(a.n) - byN.get(b.n));
    for (const l of links) l.path = saved.paths[l.n];
    commitAll(order);
  } else if (wanted) searched = search();
  else runAll(orders[4]);
  const failed = links.filter((l) => !l.path);
  const routeMs = Math.round(performance.now() - t0);
  const exportRoutes = () => {
    const order = searched ? searched.order.map((l) => l.n) : links.map((l) => l.n);
    return { grid: `${Wc}x${Hc}`, links: links.length, order, paths: links.map((l) => l.path), score: searched?.score, tried: searched?.tried };
  };
  if (failed.length) console.warn('unrouted', failed.map((l) => `${l.from}->${l.to}`));

  // ---- drawing ------------------------------------------------------------------------------------------------------
  const el = (name, attrs = {}, parent) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const svg = document.getElementById('board');
  const world = el('g', { id: 'world' }, svg);
  const px = (i) => [((i % Wc) + 0.5) * G, (((i / Wc) | 0) + 0.5) * G];
  const W = Wc * G, H = Hc * G;
  el('rect', { x: 0, y: 0, width: W, height: H, rx: 18, fill: C.board, stroke: C.boardEdge, 'stroke-width': 3 }, world);

  // title block, in silkscreen
  const silk = el('g', { class: 'silk' }, world);
  const text = (x, y, s, size, attrs = {}, parent = silk) => { const t = el('text', { x, y, 'font-size': size, 'font-family': FONT, fill: C.silk, ...attrs }, parent); t.textContent = s; return t; };
  text(M * G, (M + 2) * G, D.story.title.toUpperCase(), 22, { 'font-weight': 700, 'letter-spacing': 2 });
  text(M * G, (M + 4.2) * G, `${caps.length} capabilities · ${links.filter((l) => l.kind === 'in').length} links inside · ${links.filter((l) => l.kind === 'inc').length} arriving from ${new Set(D.incoming.map((i) => i.storyId)).size} stories · 1 leaving · measured ${D.measuredAt.slice(0, 10)}`, 11, { 'font-family': MONO, fill: C.silk2 });

  // edge connectors
  for (const [side, groups] of [['R', groupsR], ['L', groupsL]]) for (const g of groups) {
    const x0 = (side === 'R' ? rightZoneX + 1 : M) * G; const xr = (side === 'R' ? Wc - 3 : leftZone + M - 1) * G;
    text(side === 'R' ? xr : x0, (g.top + 1.4) * G, g.s.toUpperCase(), 11, { 'font-weight': 700, 'letter-spacing': 1.2, 'text-anchor': side === 'R' ? 'end' : 'start' });
    el('line', { x1: x0, x2: xr, y1: (g.top + 2) * G, y2: (g.top + 2) * G, stroke: C.silk, 'stroke-width': 1 }, silk);
  }
  for (const f of fingers) {
    const y = (f.y + 0.5) * G;
    const lx = f.side === 'R' ? (Wc - 3) * G : (M) * G;
    f.lines.forEach((s, i) => text(lx, y - 5 - 2 * G * (f.lines.length - 1 - i), s, LABEL, { 'font-weight': 600, 'text-anchor': f.side === 'R' ? 'end' : 'start' }));
  }

  // traces
  const traces = el('g', { class: 'traces' }, world);
  const lit = el('g', { class: 'lit' }, world);
  const pointsOf = (path) => {
    const pts = path.map(px); const out = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const [a, b, c] = [pts[k - 1], pts[k], pts[k + 1]];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) continue;
      const r = 5; const u = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])], v = [Math.sign(c[0] - b[0]), Math.sign(c[1] - b[1])];
      out.push([b[0] - u[0] * r, b[1] - u[1] * r], [b[0] + v[0] * r, b[1] + v[1] * r]);
    }
    out.push(pts[pts.length - 1]); return out;
  };
  const dOf = (pts) => 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join('L');
  const drawn = new Map();
  for (const l of links) {
    if (!l.path) continue;
    const d = dOf(pointsOf(l.path));
    const g = el('g', { class: 'trace', 'data-link': l.n }, traces);
    el('path', { d, fill: 'none', stroke: C.traceEdge, 'stroke-width': 4.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    el('path', { d, fill: 'none', stroke: C.trace, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    for (const k of l.under) { // passes under another trace: a break in the board's colour, a via each side
      const [x, y] = px(l.path[k]); const horiz = Math.abs(l.path[k + 1] - l.path[k]) === 1;
      el('rect', horiz ? { x: x - 5, y: y - 3.4, width: 10, height: 6.8, fill: C.board } : { x: x - 3.4, y: y - 5, width: 6.8, height: 10, fill: C.board }, g);
      for (const s of [-1, 1]) el('circle', { cx: horiz ? x + s * 6.5 : x, cy: horiz ? y : y + s * 6.5, r: 2.6, fill: C.board, stroke: C.via, 'stroke-width': 1.4 }, g);
    }
    el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 9, class: 'hit' }, g).addEventListener('click', clickOf({ type: 'link', l }));
    drawn.set(l.n, d);
  }
  // where a finger's trace splits, a solder junction
  const junction = new Map();
  for (const l of links) if (l.kind === 'inc' && l.path) for (let k = 1; k < l.path.length - 1; k++) {
    const i = l.path[k]; const key = gnum(l) + ':' + i; const nb = new Set(junction.get(key) ?? []); nb.add(l.path[k - 1]); nb.add(l.path[k + 1]); junction.set(key, nb);
  }
  for (const [key, nb] of junction) if (nb.size >= 3) { const [x, y] = px(+key.split(':')[1]); el('circle', { cx: x, cy: y, r: 3.4, fill: C.trace, stroke: C.traceEdge, 'stroke-width': 1 }, traces); }

  // chips
  const chips = el('g', { class: 'chips' }, world);
  for (const c of caps) {
    const g = el('g', { class: 'chip', 'data-cap': c.id }, chips);
    const fill = c.parked ? PARKED : HEALTH[c.word] ?? HEALTH.untested;
    el('rect', { x: c.x * G + 1.5, y: c.y * G + 2.5, width: c.w * G, height: c.h * G, rx: 2, fill: '#0e1d16', opacity: 0.55 }, g);
    el('rect', { x: c.x * G, y: c.y * G, width: c.w * G, height: c.h * G, rx: 2, fill, stroke: '#14211a', 'stroke-width': 1.6, class: 'body' }, g);
    if (c.w >= 3) el('circle', { cx: c.x * G + 5, cy: c.y * G + 5, r: 1.8, fill: '#14211a', opacity: 0.55 }, g);
    const t = el('title', {}, g); t.textContent = `${c.title}: ${metaOf(c)}`;
    text(c.x * G, (c.top + 1.6) * G, c.title, NAME, { 'font-weight': 600 }, g);
    text(c.x * G, (c.top + 3.1) * G, metaOf(c), META, { 'font-family': MONO, fill: C.silk2 }, g);
    if (c.parked) text(c.x * G + c.w * G / 2, c.y * G + c.h * G / 2 + 4, 'PARKED', 10, { 'text-anchor': 'middle', 'font-weight': 700, fill: '#1b1f22', 'letter-spacing': 1 }, g);
    g.addEventListener('click', clickOf({ type: 'cap', c }));
  }

  // pins (where a trace leaves its caller) and pads (gates: where it lands on what it calls)
  const pads = el('g', { class: 'pads' }, world);
  for (const l of links) {
    if (l.pin) { const [x, y] = px(at(l.pin.x, l.pin.y)); el('rect', { x: x - 3, y: y - 2, width: 7, height: 4, fill: C.trace, stroke: C.traceEdge, 'stroke-width': 0.8, 'data-pin': l.n }, pads); }
    const [x, y] = l.pad.finger ? [(l.finger.x + 0.5) * G, (l.finger.y + 0.5) * G] : px(at(l.pad.x, l.pad.y));
    const g = el('g', { class: 'pad', 'data-link': l.n }, pads);
    if (l.pad.finger) el('rect', { x: x - 8, y: y - 5, width: 22, height: 10, rx: 2, fill: C.pad, stroke: C.padEdge, 'stroke-width': 1.2, class: 'gold' }, g);
    else el('rect', { x: x - 4, y: y - 3.5, width: 10, height: 7, rx: 1.2, fill: C.pad, stroke: C.padEdge, 'stroke-width': 1, class: 'gold' }, g);
    el('rect', { x: x - 9, y: y - 8, width: 20, height: 16, fill: 'transparent', class: 'hit' }, g);
    const t = el('title', {}, g); t.textContent = `Gate: ${nameFrom(l)} → ${nameTo(l)}`;
    g.addEventListener('click', clickOf({ type: 'link', l }));
  }
  for (const f of fingers.filter((x) => x.side === 'R')) {
    const y = (f.y + 0.5) * G; const x = (f.x + 0.5) * G;
    const g = el('g', { class: 'finger', 'data-finger': f.cap }, pads);
    el('rect', { x: x - 12, y: y - 5, width: 22, height: 10, rx: 2, fill: C.pad, stroke: C.padEdge, 'stroke-width': 1.2, class: 'gold' }, g);
    el('rect', { x: x - 14, y: y - 9, width: 26, height: 18, fill: 'transparent', class: 'hit' }, g);
    const t = el('title', {}, g); t.textContent = `${f.story} · ${f.title}: ${f.links.length} link${f.links.length > 1 ? 's' : ''} into this story`;
    g.addEventListener('click', clickOf({ type: 'finger', f }));
  }

  // wrenches: at the gate its work changes (the chip's busiest pad), or on the chip's pad edge when nothing calls it
  const wrenches = el('g', { class: 'wrenches' }, world);
  const WRENCH = 'M-1.6 -6.2 L-1.6 2.6 A4.3 4.3 0 1 0 1.6 2.6 L1.6 -6.2 A3.6 3.6 0 0 0 4.2 -9.6 L4.2 -12.6 L2 -12.6 L2 -9.8 L-2 -9.8 L-2 -12.6 L-4.2 -12.6 L-4.2 -9.6 A3.6 3.6 0 0 0 -1.6 -6.2 Z';
  for (const [id, ws] of work) {
    const c = byId.get(id); if (!c) continue;
    const ps = c.pads.filter((l) => l.pad);
    const pad = ps.length ? ps.reduce((a, b) => (b.kind === 'in' && a.kind !== 'in' ? b : a)) : null;
    const wx = (c.x + c.w) * G - 9; const wy = pad ? (pad.pad.y + 0.5) * G : (c.y + c.h / 2) * G;
    const g = el('g', { class: 'wrench', 'data-cap': id, transform: `translate(${wx} ${wy}) rotate(-35) scale(1.45)` }, wrenches);
    el("circle", { r: 9, fill: 'transparent', class: 'hit' }, g);
    el('path', { d: WRENCH, fill: C.ink, stroke: C.silk, 'stroke-width': 1.3, 'stroke-linejoin': 'round', transform: 'translate(0 4)' }, g);
    const t = el('title', {}, g); t.textContent = `Work wants ${c.title}: ${ws.length} increment${ws.length > 1 ? 's' : ''}`;
    g.addEventListener('click', clickOf({ type: 'wrench', c, ws, pad }));
  }

  // ---- naming ---------------------------------------------------------------------------------------------------
  function nameFrom(l) { return l.kind === 'inc' ? `${l.fromTitle} (${l.story})` : byId.get(l.from).title; }
  function nameTo(l) { return l.kind === 'out' ? `${l.ext.title} (${l.ext.story})` : byId.get(l.to).title; }
  function contractsTo(l) { return l.kind === 'out' ? l.ext.contracts : byId.get(l.to).contracts; }

  // ---- selection and the datasheet panel --------------------------------------------------------------------------
  const panel = document.getElementById('panel');
  const esc2 = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const contractList = (ks) => `<ol class="contracts">${ks.map((k) => { const m = /^([\d.]+)\s*·\s*(.*)$/s.exec(k.title); return `<li><b>${esc2(m ? m[1] : '')}</b> ${esc2(m ? m[2] : k.title)}</li>`; }).join('')}</ol>`;
  const linkRow = (l) => `<li><a href="#" data-link="${l.n}">${esc2(nameFrom(l))} → ${esc2(nameTo(l))}</a></li>`;
  const clear = () => { lit.replaceChildren(); document.querySelectorAll('.on').forEach((e) => e.classList.remove('on')); };
  const light = (ls) => {
    for (const l of ls) {
      const d = drawn.get(l.n); if (!d) continue;
      el('path', { d, fill: 'none', stroke: '#3a2a0e', 'stroke-width': 6.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, lit);
      el('path', { d, fill: 'none', stroke: C.lit, 'stroke-width': 3.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, lit);
      document.querySelectorAll(`.pad[data-link="${l.n}"], [data-pin="${l.n}"]`).forEach((e) => e.classList.add('on'));
      if (l.finger) document.querySelectorAll(`.finger[data-finger="${l.finger.cap}"]`).forEach((e) => e.classList.add('on'));
    }
    pads.parentNode.appendChild(pads); wrenches.parentNode.appendChild(wrenches);
  };
  function show(sel) {
    clear();
    let html = '';
    if (sel.type === 'cap') {
      const c = sel.c; document.querySelector(`.chip[data-cap="${c.id}"]`).classList.add('on');
      const inn = links.filter((l) => l.to === c.id), out = links.filter((l) => l.from === c.id);
      html = `<p class="kicker">Capability · ${c.parked ? 'parked' : esc2(c.word)}</p><h2>${esc2(c.title)}</h2>
        <p class="meta">${metaOf(c)} · ${c.files} files</p><p>${esc2(c.description)}</p>
        <h3>Contracts</h3>${contractList(c.contracts)}
        <h3>Gates on this chip (${inn.length})</h3><ul class="links">${inn.map(linkRow).join('') || '<li>None: nothing calls it.</li>'}</ul>
        <h3>Calls (${out.length})</h3><ul class="links">${out.map(linkRow).join('') || '<li>None.</li>'}</ul>`;
    } else if (sel.type === 'link') {
      const l = sel.l; light([l]);
      html = `<p class="kicker">Gate · one link</p><h2>${esc2(nameFrom(l))} <span class="arrow">→</span> ${esc2(nameTo(l))}</h2>
        <p class="meta">${l.kind === 'inc' ? `Arrives from ${esc2(l.story)} at the edge connector.` : l.kind === 'out' ? `Leaves for ${esc2(l.ext.story)} at the edge connector.` : 'Inside The library.'}</p>
        <h3>${esc2(nameTo(l))}'s contracts</h3>${contractList(contractsTo(l))}`;
    } else if (sel.type === 'finger') {
      const f = sel.f; light(f.links);
      html = `<p class="kicker">Edge connector · ${esc2(f.story)}</p><h2>${esc2(f.title)}</h2>
        <p class="meta">${f.links.length} link${f.links.length > 1 ? 's' : ''} into The library${f.links.length > 1 ? ', its trace splitting to each gate' : ''}.</p>
        <ul class="links">${f.links.map(linkRow).join('')}</ul>`;
    } else if (sel.type === 'wrench') {
      const { c, ws, pad } = sel; if (pad) light([pad]);
      document.querySelector(`.wrench[data-cap="${c.id}"]`).classList.add('on');
      const arcs = [...new Set(ws.map((w) => w.arc))].map((a) => ws.filter((w) => w.arc === a));
      html = `<p class="kicker">Work in flight · ${ws.length} increment${ws.length > 1 ? 's' : ''}</p><h2>${esc2(c.title)}</h2>
        <p class="meta">${pad ? `The wrench stands at the gate from ${esc2(nameFrom(pad))}.` : 'Nothing calls this capability, so the wrench stands on the chip’s gate edge.'}</p>
        ${arcs.map((g) => `<h3>${esc2(g[0].arcTitle)} <span class="id">${g[0].arc}</span></h3><ul class="work">${g.map((w) => `<li><span class="st">${esc2(w.status)}</span> ${esc2(w.title)} <span class="id">${w.increment}</span></li>`).join('')}</ul>`).join('')}`;
    }
    panel.innerHTML = `<button class="close" aria-label="Close">×</button>${html}`;
    panel.hidden = false;
    panel.querySelector('.close').addEventListener('click', () => { clear(); panel.hidden = true; });
    panel.querySelectorAll('a[data-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show({ type: 'link', l: links[+a.dataset.link] }); }));
  }
  let dragged = false;
  function clickOf(sel) { return (e) => { if (dragged) return; e.stopPropagation(); show(sel); }; }

  // ---- pan and zoom -------------------------------------------------------------------------------------------------
  const view = { x: 0, y: 0, k: 1 };
  const apply = () => world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  const fit = () => { const r = svg.getBoundingClientRect(); const k = Math.min(r.width / (W + 40), r.height / (H + 40)); view.k = k; view.x = (r.width - W * k) / 2; view.y = (r.height - H * k) / 2; apply(); };
  const zoomAt = (cx, cy, f) => { const k = Math.min(6, Math.max(0.15, view.k * f)); view.x = cx - (cx - view.x) * (k / view.k); view.y = cy - (cy - view.y) * (k / view.k); view.k = k; apply(); };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; dragged = false; });
  window.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { dragged = true; svg.classList.add('panning'); } if (dragged) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); } });
  window.addEventListener('pointerup', () => { drag = null; svg.classList.remove('panning'); setTimeout(() => { dragged = false; }, 0); });
  svg.addEventListener('click', () => { if (!dragged) { clear(); panel.hidden = true; } });
  document.getElementById('fit').addEventListener('click', fit);
  document.getElementById('zin').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.3); });
  document.getElementById('zout').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.3); });
  window.addEventListener('resize', fit);
  fit();

  // hooks for the stills script
  window.__board = {
    W, H, view, apply, fit, failed: failed.length, routeMs, exportRoutes, searched: searched && { score: searched.score, tried: searched.tried }, byKind: ['in','out','inc'].map((k) => links.filter((l) => l.kind === k).reduce((s, l) => s + (l.under?.length ?? 0), 0)), crossings: links.reduce((s, l) => s + (l.under?.length ?? 0), 0),
    select(kind, key) {
      if (kind === 'cap') show({ type: 'cap', c: caps.find((c) => c.title.startsWith(key)) });
      if (kind === 'link') show({ type: 'link', l: links.find((l) => nameFrom(l).startsWith(key[0]) && nameTo(l).startsWith(key[1])) });
      if (kind === 'finger') show({ type: 'finger', f: fingers.find((f) => f.title.startsWith(key)) });
      if (kind === 'wrench') { const c = caps.find((x) => x.title.startsWith(key)); const ws = work.get(c.id); const ps = c.pads; show({ type: 'wrench', c, ws, pad: ps.length ? ps.reduce((a, b) => (b.kind === 'in' && a.kind !== 'in' ? b : a)) : null }); }
    },
    centreOn(kind, key, k) {
      let x, y;
      if (kind === 'cap') { const c = caps.find((c) => c.title.startsWith(key)); x = (c.x + c.w / 2) * G; y = (c.y + c.h / 2) * G; }
      if (kind === 'finger') { const f = fingers.find((f) => f.title.startsWith(key)); x = (f.x - 20) * G; y = f.y * G; }
      if (kind === 'xy') [x, y] = key;
      const r = svg.getBoundingClientRect(); view.k = k; view.x = (panel.hidden ? r.width / 2 : (r.width - 440) / 2) - x * k; view.y = r.height / 2 - y * k; apply();
    },
  };
})();
