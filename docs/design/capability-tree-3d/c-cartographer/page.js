// The library, charted: a cartographer's chart of one story, drawn from data.js (measured by tools/measure.mjs).
// Layout: each capability is an estate whose area is its lines of code; estates sit in rows by dependency depth (the
// called below their callers), so every road runs downhill through open land between rows, as in a layered diagram.
// Links from other stories come ashore at a harbour per story on the north coast and split; the road out leaves south.
(() => {
  const D = window.DATA;
  const SVG = 'http://www.w3.org/2000/svg';
  const STORY = D.story.id;
  const HEALTH = {
    healthy: { colour: '#97C459', label: 'healthy' },
    unhealthy: { colour: '#E24B4A', label: 'unhealthy' },
    untested: { colour: '#F2D16B', label: 'untested' },
    proposed: { colour: '#F2D16B', label: 'proposed' },
    parked: { colour: '#86939D', label: 'parked' },
  };
  const AREA_PER_LINE = 15;           // square pixels of estate per line of code (tests excluded)
  const ROW_GAP = 84;                  // open land between rows, where the roads run
  const MIN_GAP = 34;                  // open land between neighbours in a row
  const LANE = 16;                     // a road passing through a row takes this much width
  const LABEL_INSIDE_R = 40;           // estates at least this big carry their name inside

  const fill = (c) => HEALTH[c.parked ? 'parked' : c.word] ?? HEALTH.untested;
  const radiusOf = (lines) => Math.sqrt(Math.max(lines, 1) * AREA_PER_LINE / Math.PI);
  const fmt = (n) => n.toLocaleString('en-GB');
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const measure = (() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const serif = getComputedStyle(document.documentElement).getPropertyValue('--serif');
    return (text, size, italic) => { ctx.font = `${italic ? 'italic ' : ''}${size}px ${serif}`; return ctx.measureText(text).width; };
  })();
  // A small seeded random, so the hand-drawn wobble is the same every time the page opens.
  const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const hash = (str) => [...str].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

  // ---- The graph: estates, harbours, links ----
  const caps = new Map(D.capabilities.map((c) => [c.id, c]));
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    depth.set(id, 0);
    const own = caps.get(id).dependsOn.filter((d) => caps.has(d.id));
    const d = own.length === 0 ? 0 : 1 + Math.max(...own.map((x) => depthOf(x.id)));
    depth.set(id, d);
    return d;
  };
  D.capabilities.forEach((c) => depthOf(c.id));
  const maxDepth = Math.max(...depth.values());
  const TOP = maxDepth + 1, BOTTOM = -1;

  const nodes = new Map();
  for (const c of D.capabilities) {
    const r = radiusOf(c.lines);
    const nameW = measure(c.title, 15, false), linesW = measure(`${fmt(c.lines)} lines`, 12, true);
    const inside = r >= LABEL_INSIDE_R && nameW <= 1.7 * r;
    const labelW = inside ? 0 : Math.max(nameW, linesW) + 9;
    nodes.set(c.id, { id: c.id, kind: 'estate', cap: c, layer: depth.get(c.id), r, inside, labelW, left: r, right: r + labelW });
  }
  // One harbour per other story that calls in, and one per other story called out to.
  const links = [];
  for (const c of D.capabilities) for (const d of c.dependsOn) {
    if (caps.has(d.id)) links.push({ id: `${c.id}>${d.id}`, kind: 'within', from: c.id, to: d.id });
    else {
      const hid = `out:${d.storyId}`;
      if (!nodes.has(hid)) nodes.set(hid, { id: hid, kind: 'harbour-out', story: d.story, storyId: d.storyId, layer: BOTTOM, left: 6, right: 6 });
      links.push({ id: `${c.id}>${d.id}`, kind: 'out', from: c.id, to: hid, called: d });
    }
  }
  for (const a of D.arrivals) {
    const hid = `in:${a.storyId}`;
    if (!nodes.has(hid)) nodes.set(hid, { id: hid, kind: 'harbour-in', story: a.story, storyId: a.storyId, layer: TOP, left: 6, right: 6 });
    links.push({ id: `${a.from}>${a.to}`, kind: 'arrival', from: hid, to: a.to, caller: a });
  }
  for (const n of nodes.values()) if (n.kind !== 'estate') {
    const w = Math.max(measure(n.kind === 'harbour-in' ? `from ${n.story}` : `to ${n.story}`, 14, true), 60);
    n.left = w / 2 + 4; n.right = w / 2 + 4;
  }

  // Each link becomes a chain through every row it crosses, with a waypoint (a lane) in each.
  const chains = links.map((l) => {
    const chain = [l.from];
    for (let layer = nodes.get(l.from).layer - 1; layer > nodes.get(l.to).layer; layer--) {
      const id = `lane:${l.id}:${layer}`;
      nodes.set(id, { id, kind: 'lane', link: l.id, layer, left: LANE / 2, right: LANE / 2 });
      chain.push(id);
    }
    chain.push(l.to);
    l.chain = chain;
    return chain;
  });
  const up = new Map(), down = new Map();
  for (const n of nodes.keys()) { up.set(n, []); down.set(n, []); }
  for (const chain of chains) for (let i = 0; i + 1 < chain.length; i++) { down.get(chain[i]).push(chain[i + 1]); up.get(chain[i + 1]).push(chain[i]); }

  // ---- Order within rows: barycentre sweeps, keeping the order with the fewest crossings ----
  const layers = new Map();
  for (const n of nodes.values()) { if (!layers.has(n.layer)) layers.set(n.layer, []); layers.get(n.layer).push(n.id); }
  const layerKeys = [...layers.keys()].sort((a, b) => b - a); // top row first
  const pos = new Map();
  const index = () => { for (const k of layerKeys) layers.get(k).forEach((id, i) => pos.set(id, i)); };
  index();
  const crossings = () => {
    let count = 0;
    for (let i = 0; i + 1 < layerKeys.length; i++) {
      const segs = layers.get(layerKeys[i]).flatMap((a) => down.get(a).map((b) => [pos.get(a), pos.get(b)]));
      for (let p = 0; p < segs.length; p++) for (let q = p + 1; q < segs.length; q++) {
        if ((segs[p][0] - segs[q][0]) * (segs[p][1] - segs[q][1]) < 0) count++;
      }
    }
    return count;
  };
  const sweep = (keys, near) => {
    for (const k of keys) {
      const row = layers.get(k);
      const bary = new Map(row.map((id) => {
        const ns = near.get(id);
        return [id, ns.length ? ns.reduce((s, x) => s + pos.get(x), 0) / ns.length : pos.get(id)];
      }));
      row.sort((a, b) => bary.get(a) - bary.get(b));
      row.forEach((id, i) => pos.set(id, i));
    }
  };
  let best = { n: crossings(), order: new Map(layerKeys.map((k) => [k, [...layers.get(k)]])) };
  for (let i = 0; i < 40; i++) {
    sweep(layerKeys.slice(1), up);
    sweep([...layerKeys].reverse().slice(1), down);
    const n = crossings();
    if (n < best.n) best = { n, order: new Map(layerKeys.map((k) => [k, [...layers.get(k)]])) };
  }
  for (const k of layerKeys) layers.set(k, best.order.get(k));
  index();

  // ---- Shared roads: lanes side by side in a row that leave the same harbour or estate run as one road ----
  const sourceOf = (lane) => linkOfId.get(nodes.get(lane).link).from;
  const linkOfId = new Map(links.map((l) => [l.id, l]));
  let bundles = 0;
  for (const k of layerKeys) {
    const row = layers.get(k);
    for (let i = 0; i < row.length; i++) {
      const n = nodes.get(row[i]);
      if (n.kind !== 'lane') continue;
      const p = nodes.get(row[i - 1]);
      if (p && p.kind === 'lane' && sourceOf(p.id) === sourceOf(n.id)) n.bundle = p.bundle ?? (p.bundle = bundles++);
    }
  }
  const pinBundles = (row) => {
    let lead;
    for (const id of row) { const n = nodes.get(id); if (n.bundle === undefined) { lead = undefined; continue; } if (lead === undefined || lead.bundle !== n.bundle) lead = n; else n.x = lead.x; }
  };
  // ---- Place along rows: pull each node toward its neighbours, never closer than the gap ----
  const gapBetween = (a, b) => (a.bundle !== undefined && a.bundle === b.bundle ? -(a.right + b.left) : a.kind === 'lane' && b.kind === 'lane' ? 0 : a.kind === 'lane' || b.kind === 'lane' ? MIN_GAP * 0.55 : MIN_GAP);
  for (const k of layerKeys) {
    let x = 0, prev;
    for (const id of layers.get(k)) { const n = nodes.get(id); x += prev ? prev.right + gapBetween(prev, n) + n.left : 0; n.x = x; prev = n; }
  }
  const settle = (row) => {
    // Left to right, then right to left, keeping the gaps; the two results averaged keep the row centred on its wishes.
    const want = row.map((id) => nodes.get(id).want);
    const a = [], b = [];
    row.forEach((id, i) => { const n = nodes.get(id), p = nodes.get(row[i - 1]); a[i] = i === 0 ? want[i] : Math.max(want[i], a[i - 1] + p.right + gapBetween(p, n) + n.left); });
    for (let i = row.length - 1; i >= 0; i--) { const n = nodes.get(row[i]), q = nodes.get(row[i + 1]); b[i] = i === row.length - 1 ? want[i] : Math.min(want[i], b[i + 1] - q.left - gapBetween(n, q) - n.right); }
    const shiftA = want.reduce((s, w, i) => s + w - a[i], 0) / row.length, shiftB = want.reduce((s, w, i) => s + w - b[i], 0) / row.length;
    row.forEach((id, i) => { nodes.get(id).x = ((a[i] + shiftA) + (b[i] + shiftB)) / 2; });
    // Averaging can bring two neighbours too close again; one more left-to-right pass restores every gap.
    for (let i = 1; i < row.length; i++) {
      const n = nodes.get(row[i]), p = nodes.get(row[i - 1]);
      n.x = Math.max(n.x, p.x + p.right + gapBetween(p, n) + n.left);
    }
  };
  for (let it = 0; it < 60; it++) {
    const order = it % 2 ? [...layerKeys].reverse() : layerKeys;
    for (const k of order) {
      const row = layers.get(k);
      for (const id of row) {
        const n = nodes.get(id);
        const ns = [...up.get(id), ...down.get(id)];
        // A lane wants to be straight; an estate wants to sit among what it touches.
        const weight = n.kind === 'lane' ? 1 : 0.6;
        const mid = ns.length ? ns.reduce((s, x) => s + nodes.get(x).x, 0) / ns.length : n.x;
        n.want = n.x + (mid - n.x) * weight;
      }
      settle(row);
      pinBundles(row);
    }
  }
  // Rows stacked top to bottom: each as tall as its biggest estate.
  const rowHeight = (k) => Math.max(26, ...layers.get(k).map((id) => { const n = nodes.get(id); return n.kind === 'estate' ? 2 * n.r : 0; }));
  let y = 0;
  const rowBand = new Map();
  for (const k of layerKeys) {
    const h = k === TOP || k === BOTTOM ? 0 : rowHeight(k);
    rowBand.set(k, { top: y, bottom: y + h, mid: y + h / 2 });
    for (const id of layers.get(k)) nodes.get(id).y = y + h / 2;
    y += h + ROW_GAP;
  }

  // ---- Shapes: a hand-drawn estate outline around each centre ----
  const outline = (n) => {
    const rnd = seeded(hash(n.id));
    const waves = [[2, 0.05 * rnd(), rnd() * 6.3], [3, 0.06, rnd() * 6.3], [5, 0.025, rnd() * 6.3]];
    const radiusAt = (t) => n.r * (1 + waves.reduce((s, [f, a, p]) => s + a * Math.sin(f * t + p), 0));
    n.radiusAt = radiusAt;
    const pts = [];
    for (let i = 0; i < 72; i++) { const t = (i / 72) * Math.PI * 2; pts.push([n.x + radiusAt(t) * Math.cos(t), n.y + radiusAt(t) * Math.sin(t)]); }
    return pts;
  };
  const smooth = (pts) => {
    // Closed Catmull-Rom through the points, as cubic Béziers.
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[(i - 1 + pts.length) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length], p3 = pts[(i + 2) % pts.length];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d + 'Z';
  };
  const estates = [...nodes.values()].filter((n) => n.kind === 'estate');
  for (const n of estates) n.pts = outline(n);
  const pointAt = (n, t) => [n.x + n.radiusAt(t) * Math.cos(t), n.y + n.radiusAt(t) * Math.sin(t)];

  // Gates on the called estate's upper rim, ports on the caller's lower rim, each spread in the order its roads come.
  const spread = (count, mid, span) => Array.from({ length: count }, (_, i) => (count === 1 ? mid : mid - span / 2 + (span * i) / (count - 1)));
  for (const n of estates) {
    const incoming = links.filter((l) => l.to === n.id);
    const prevX = (l) => nodes.get(l.chain[l.chain.length - 2]).x;
    incoming.sort((a, b) => prevX(a) - prevX(b));
    const span = Math.min(Math.PI * 0.9, Math.max(Math.PI * 0.45, (incoming.length - 1) * (17 / n.r)));
    spread(incoming.length, -Math.PI / 2, span).forEach((t, i) => { incoming[i].gateT = t; });
    const outgoing = links.filter((l) => l.from === n.id);
    const nextX = (l) => nodes.get(l.chain[1]).x;
    outgoing.sort((a, b) => nextX(b) - nextX(a));
    const spanOut = Math.min(Math.PI * 0.8, Math.max(Math.PI * 0.35, (outgoing.length - 1) * (15 / n.r)));
    spread(outgoing.length, Math.PI / 2, spanOut).forEach((t, i) => { outgoing[i].portT = t; });
  }

  // ---- The coast: one island round every estate, harbours on it ----
  const xs = estates.flatMap((n) => [n.x - n.r, n.x + n.r + n.labelW]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const firstRow = rowBand.get(layerKeys[1]), lastRow = rowBand.get(layerKeys[layerKeys.length - 2]);
  const COAST_N = 4, HOLD = 2 ** (1 / COAST_N) * 0.94;
  const island = { cx: (minX + maxX) / 2, cy: (firstRow.top + lastRow.bottom) / 2, a: (maxX - minX) / 2 * HOLD + 24, b: (lastRow.bottom - firstRow.top) / 2 * HOLD + 30 };
  const coastRnd = seeded(91);
  const coastWaves = [[3, 0.012, coastRnd() * 6.3], [7, 0.008, coastRnd() * 6.3], [13, 0.004, coastRnd() * 6.3]];
  const coastPoint = (t, grow = 0) => {
    const c = Math.cos(t), s = Math.sin(t), n = COAST_N;
    const k = 1 + coastWaves.reduce((acc, [f, a, p]) => acc + a * Math.sin(f * t + p), 0);
    const ex = Math.sign(c) * Math.abs(c) ** (2 / n), ey = Math.sign(s) * Math.abs(s) ** (2 / n);
    return [island.cx + (island.a * k + grow) * ex, island.cy + (island.b * k + grow) * ey];
  };
  const coastAt = (x, top) => {
    // The coast's point above (or below) x: the nearest of a fine sampling of its upper (lower) half.
    let bestP = null;
    for (let i = 0; i <= 720; i++) {
      const t = (top ? -Math.PI : 0) + (i / 720) * Math.PI;
      const p = coastPoint(t);
      if (!bestP || Math.abs(p[0] - x) < Math.abs(bestP[0] - x)) bestP = p;
    }
    return bestP;
  };
  // Harbours keep the order the layout gave them, spread so no two names touch, centred on where they wanted to be.
  for (const kind of ['harbour-in', 'harbour-out']) {
    const hs = [...nodes.values()].filter((n) => n.kind === kind).sort((a, b) => a.x - b.x);
    for (let i = 1; i < hs.length; i++) hs[i].x = Math.max(hs[i].x, hs[i - 1].x + hs[i - 1].right + hs[i].left + 18);
    const wantMid = hs.reduce((s, n) => s + n.x, 0) / (hs.length || 1);
    const span = hs.length ? hs[hs.length - 1].x - hs[0].x : 0;
    const mid = Math.min(Math.max(wantMid, minX + span / 2), maxX - span / 2);
    const shift = mid - (hs.length ? (hs[0].x + hs[hs.length - 1].x) / 2 : 0);
    hs.forEach((n) => { n.x += shift; });
  }
  for (const n of nodes.values()) {
    if (n.kind === 'harbour-in') { [n.x, n.y] = coastAt(Math.min(Math.max(n.x, minX), maxX), true); n.split = [n.x, n.y + 40]; }
    if (n.kind === 'harbour-out') { [n.x, n.y] = coastAt(Math.min(Math.max(n.x, minX), maxX), false); }
  }

  // ---- Roads: down through each row's lane, entering the gate square to the rim ----
  const route = (l) => {
    const from = nodes.get(l.from), to = nodes.get(l.to);
    const pts = [];
    let startDir;
    if (from.kind === 'estate') { const p = pointAt(from, l.portT); pts.push(p); startDir = [Math.cos(l.portT), Math.sin(l.portT)]; }
    else { pts.push(from.split); startDir = [0, 1]; }
    for (const id of l.chain.slice(1, -1)) {
      const n = nodes.get(id), band = rowBand.get(n.layer);
      pts.push([n.x, band.top - 4], [n.x, band.bottom + 4]);
    }
    let endDir, end;
    if (to.kind === 'estate') { end = pointAt(to, l.gateT); endDir = [Math.cos(l.gateT), Math.sin(l.gateT)]; }
    else { end = [to.x, to.y - 2]; endDir = [0, -1]; }
    l.gate = end; l.gateDir = endDir;
    pts.push(end);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [p, q] = [pts[i], pts[i + 1]];
      const inLane = i % 2 === 1 && i + 1 < pts.length - 1; // the straight run through a row
      if (inLane) { d += `L${q[0].toFixed(1)},${q[1].toFixed(1)}`; continue; }
      const k = Math.max(24, (q[1] - p[1]) * 0.5);
      const a = i === 0 ? startDir : [0, 1], b = i + 1 === pts.length - 1 ? endDir : [0, -1];
      d += `C${(p[0] + a[0] * k).toFixed(1)},${(p[1] + a[1] * k).toFixed(1)} ${(q[0] + b[0] * k).toFixed(1)},${(q[1] + b[1] * k).toFixed(1)} ${q[0].toFixed(1)},${q[1].toFixed(1)}`;
    }
    return d;
  };

  // ---- Drawing ----
  const world = document.getElementById('world');
  const layer = (name) => el('g', { class: name }, world);
  const gSea = layer('sea'), gLand = layer('land'), gEstates = layer('estates'), gRoads = layer('roads'), gGates = layer('gates'), gNames = layer('names'), gMarks = layer('marks');
  const coastPath = (grow) => { const pts = []; for (let i = 0; i < 240; i++) pts.push(coastPoint((i / 240) * Math.PI * 2, grow)); return smooth(pts); };
  [44, 30, 19, 10].forEach((g, i) => el('path', { class: 'water', d: coastPath(g), opacity: (0.14 + i * 0.09).toFixed(2) }, gSea));
  el('path', { class: 'coast', d: coastPath(0) }, gLand);

  const marks = { estate: new Map(), road: new Map(), gate: new Map(), harbour: new Map(), wrench: new Map(), trunk: new Map() };
  const select = (what) => show(what);

  for (const n of estates) {
    const c = n.cap, colour = fill(c).colour;
    const g = el('g', { class: 'estate', 'data-id': c.id }, gEstates);
    const d = smooth(n.pts);
    const clipId = `clip-${c.id}`;
    el('path', { d }, el('clipPath', { id: clipId }, g));
    el('path', { class: 'estate-fill', d, fill: colour, 'fill-opacity': 0.42 }, g);
    // A band of deeper colour just inside the bounds, as a map tints a region's edge.
    el('path', { class: 'estate-band', d, stroke: colour, 'stroke-opacity': 0.75, 'clip-path': `url(#${clipId})`, 'stroke-width': Math.min(9, 3 + n.r / 10) }, g);
    el('path', { class: 'estate-edge', d }, g);
    const hit = el('path', { class: 'estate-hit', d }, g);
    hit.addEventListener('click', () => select({ type: 'estate', id: c.id }));
    marks.estate.set(c.id, g);
    // The name: inside a big estate, beside a small one.
    const [num, ...rest] = c.title.split(' · ');
    if (n.inside) {
      const t = el('text', { class: 'name inside', x: n.x, y: n.y - 2, 'text-anchor': 'middle' }, gNames);
      t.textContent = c.title;
      const l2 = el('text', { class: 'lines inside', x: n.x, y: n.y + 16, 'text-anchor': 'middle' }, gNames);
      l2.textContent = `${fmt(c.lines)} lines`;
    } else {
      const lx = n.x + n.r + 7;
      const t = el('text', { class: 'name', x: lx, y: n.y }, gNames);
      t.textContent = c.title;
      const l2 = el('text', { class: 'lines', x: lx, y: n.y + 15 }, gNames);
      l2.textContent = `${fmt(c.lines)} lines`;
    }
    void num; void rest;
  }

  for (const l of links) {
    const d = route(l);
    el('path', { class: 'road-halo', d }, gRoads);
    const road = el('path', { class: 'road', d }, gRoads);
    const hit = el('path', { class: 'road-hit', d }, gRoads);
    hit.addEventListener('click', () => select({ type: 'gate', id: l.id }));
    marks.road.set(l.id, road);
  }
  // A harbour's trunk: from the pier to where its roads part.
  for (const n of nodes.values()) if (n.kind === 'harbour-in') {
    const d = `M${n.x.toFixed(1)},${n.y.toFixed(1)}L${n.split[0].toFixed(1)},${n.split[1].toFixed(1)}`;
    el('path', { class: 'road-halo', d }, gRoads);
    marks.trunk.set(n.id, el('path', { class: 'road', d, 'stroke-width': 3 }, gRoads));
  }

  // Gates: the dashed bound opens where a road comes in, with a post either side; each is its link's own.
  for (const l of links) {
    const to = nodes.get(l.to);
    const g = el('g', { class: 'gate' }, gGates);
    const [gx, gy] = l.gate, [nx, ny] = l.gateDir, tx = -ny, ty = nx;
    if (to.kind === 'estate') {
      const half = 6;
      el('line', { class: 'gate-gap', x1: gx - tx * half, y1: gy - ty * half, x2: gx + tx * half, y2: gy + ty * half, stroke: fill(to.cap).colour }, g);
      // Paper over the dash on the outside half, the estate's colour on the inside.
      el('line', { class: 'gate-gap', x1: gx - tx * half + nx * 1.2, y1: gy - ty * half + ny * 1.2, x2: gx + tx * half + nx * 1.2, y2: gy + ty * half + ny * 1.2, stroke: '#f3efe4' }, g);
      for (const s of [-1, 1]) el('line', { class: 'gate-post', x1: gx + s * tx * half - nx * 3, y1: gy + s * ty * half - ny * 3, x2: gx + s * tx * half + nx * 4.5, y2: gy + s * ty * half + ny * 4.5 }, g);
    } else {
      for (const s of [-1, 1]) el('line', { class: 'gate-post', x1: gx + s * 5.2, y1: gy - 6, x2: gx + s * 5.2, y2: gy + 1 }, g);
    }
    const hit = el('circle', { class: 'gate-hit', cx: gx + nx * 2, cy: gy + ny * 2, r: 9 }, g);
    hit.addEventListener('click', () => select({ type: 'gate', id: l.id }));
    marks.gate.set(l.id, g);
  }

  // Harbours: a pier into the sea and the story's name in italic, as a chart names a port.
  for (const n of nodes.values()) if (n.kind === 'harbour-in' || n.kind === 'harbour-out') {
    const g = el('g', { class: 'harbour' }, gMarks);
    const outward = n.kind === 'harbour-in' ? -1 : 1;
    el('line', { class: 'pier', x1: n.x, y1: n.y, x2: n.x, y2: n.y + outward * 11 }, g);
    const count = links.filter((l) => l.from === n.id || l.to === n.id).length;
    const ty = n.y + outward * (n.kind === 'harbour-in' ? 34 : 28);
    const t = el('text', { class: 'harbour-name', x: n.x, y: ty, 'text-anchor': 'middle' }, g);
    t.textContent = n.kind === 'harbour-in' ? `from ${n.story}` : `to ${n.story}`;
    const t2 = el('text', { class: 'harbour-count', x: n.x, y: ty + 15, 'text-anchor': 'middle' }, g);
    t2.textContent = `${count} link${count === 1 ? '' : 's'} ${n.kind === 'harbour-in' ? 'in' : 'out'}`;
    const hit = el('rect', { class: 'harbour-hit', x: n.x - n.left, y: Math.min(n.y, ty - 14), width: n.left + n.right, height: Math.abs(ty - n.y) + 30 }, g);
    hit.addEventListener('click', () => select({ type: 'harbour', id: n.id }));
    marks.harbour.set(n.id, g);
  }

  // Wrenches: one per capability that open work names, at the gate that work changes. The increments name capabilities,
  // not links, so the chart takes the capability's busiest gate in; a capability nothing calls takes the gate of its own
  // road out, where its work meets the land.
  const wanted = new Map();
  for (const w of D.openWork) for (const id of w.capabilities) { if (!wanted.has(id)) wanted.set(id, []); wanted.get(id).push(w); }
  for (const [id] of wanted) {
    const incoming = links.filter((l) => l.to === id);
    const n = nodes.get(id);
    let at, dir, via;
    if (incoming.length) {
      via = incoming.reduce((a, b) => (Math.abs(b.gateT + Math.PI / 2) < Math.abs(a.gateT + Math.PI / 2) ? b : a));
      at = via.gate; dir = via.gateDir;
    } else {
      via = links.find((l) => l.from === id);
      at = pointAt(n, via.portT); dir = [Math.cos(via.portT), Math.sin(via.portT)];
    }
    const side = [-dir[1], dir[0]];
    const wx = at[0] + dir[0] * 13 + side[0] * 14, wy = at[1] + dir[1] * 13 + side[1] * 14;
    const g = el('g', { class: 'wrench', 'data-id': id, transform: `translate(${wx.toFixed(1)},${wy.toFixed(1)})` }, gMarks);
    el('circle', { class: 'plate', r: 10.5 }, g);
    el('use', { href: '#wrench', x: -7.5, y: -7.5, width: 15, height: 15 }, g);
    g.addEventListener('click', () => select({ type: 'wrench', id }));
    marks.wrench.set(id, { g, via: via.id });
  }

  // A scale of areas, bottom left of the island, as a chart carries its scale bar; it sits in the sea below the coast, clear of the land.
  {
    const sx = island.cx - island.a + 30, sy = island.cy + island.b + 96;
    const g = el('g', { class: 'scale' }, gMarks);
    let x = sx;
    for (const lines of [100, 500, 1000]) {
      const r = radiusOf(lines);
      el('circle', { class: 'scale-ring', cx: x + r, cy: sy - r, r }, g);
      const t = el('text', { class: 'scale-text', x: x + r, y: sy + 13, 'text-anchor': 'middle' }, g);
      t.textContent = fmt(lines);
      x += 2 * r + 14;
    }
    const t = el('text', { class: 'scale-text', x: sx, y: sy + 27 }, g);
    t.textContent = 'lines of code, by area (tests excluded)';
  }

  // ---- Selection: light the route and the marks; the panel says what is there ----
  const panel = document.getElementById('panel');
  const linkById = new Map(links.map((l) => [l.id, l]));
  const capTitle = (id) => caps.get(id)?.title ?? id;
  const describeLink = (l) => {
    if (l.kind === 'within') return { caller: capTitle(l.from), callerStory: D.story.title, called: capTitle(l.to), calledStory: D.story.title, contracts: caps.get(l.to).contracts };
    if (l.kind === 'arrival') return { caller: l.caller.fromTitle, callerStory: l.caller.story, called: capTitle(l.to), calledStory: D.story.title, contracts: caps.get(l.to).contracts };
    return { caller: capTitle(l.from), callerStory: D.story.title, called: l.called.title, calledStory: l.called.story, contracts: l.called.contracts };
  };
  const clearLit = () => world.querySelectorAll('.lit').forEach((e) => e.classList.remove('lit'));
  const lightLink = (l) => {
    marks.road.get(l.id).classList.add('lit');
    marks.gate.get(l.id).classList.add('lit');
    if (l.kind === 'arrival') { marks.trunk.get(l.from).classList.add('lit'); marks.harbour.get(l.from).classList.add('lit'); }
    if (l.kind === 'out') marks.harbour.get(l.to).classList.add('lit');
    // A lit road is drawn last, so it reads over the roads it crosses.
    const road = marks.road.get(l.id);
    road.parentNode.appendChild(road.previousSibling.cloneNode());
    road.parentNode.appendChild(road);
  };
  const h = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const linkButton = (l, label) => { const b = h('button', label, 'link'); b.type = 'button'; b.addEventListener('click', () => select({ type: 'gate', id: l.id })); return b; };
  const contractList = (list) => { const ol = h('ol'); for (const k of list) ol.appendChild(h('li', k.title, 'contract')); return ol; };
  const roadsOf = (id) => {
    const ul = h('ul');
    for (const l of links.filter((x) => x.from === id || x.to === id)) {
      const d = describeLink(l);
      const li = h('li');
      li.appendChild(linkButton(l, l.to === id ? `${d.caller} calls it` : `calls ${d.called}`));
      if (l.kind !== 'within') li.appendChild(h('span', ` (${l.to === id ? d.callerStory : d.calledStory})`, 'word'));
      ul.appendChild(li);
    }
    return ul;
  };

  const show = (what) => {
    clearLit();
    panel.replaceChildren();
    if (!what) return rest();
    if (what.type === 'estate') {
      const c = caps.get(what.id);
      marks.estate.get(c.id).classList.add('lit');
      for (const l of links.filter((x) => x.to === c.id)) marks.gate.get(l.id).classList.add('lit');
      panel.append(h('div', 'Capability', 'kind'), h('h2', c.title));
      panel.append(h('p', `${fill(c).label}${c.parked && c.word !== 'parked' ? ` (${c.word})` : ''} · ${fmt(c.lines)} lines in ${c.files} file${c.files === 1 ? '' : 's'} · ${c.contracts.length} contracts`, 'facts'));
      panel.append(h('p', c.description));
      if (wanted.has(c.id)) { const b = h('button', `Open work on it (${wanted.get(c.id).length})`, 'link'); b.type = 'button'; b.addEventListener('click', () => select({ type: 'wrench', id: c.id })); panel.append(b); }
      panel.append(h('h3', 'Contracts'), contractList(c.contracts));
      panel.append(h('h3', 'Roads'), roadsOf(c.id));
    }
    if (what.type === 'gate') {
      const l = linkById.get(what.id), d = describeLink(l);
      lightLink(l);
      panel.append(h('div', l.kind === 'arrival' ? 'Gate · a link from another story' : l.kind === 'out' ? 'Gate · a link to another story' : 'Gate', 'kind'));
      panel.append(h('h2', `${d.caller} → ${d.called}`));
      panel.append(h('p', `${d.caller}${d.callerStory !== D.story.title ? ` (${d.callerStory})` : ''} calls ${d.called}${d.calledStory !== D.story.title ? ` (${d.calledStory})` : ''}. This gate is this link's own; its road is lit.`, 'facts'));
      panel.append(h('h3', `What it calls: ${d.called}'s contracts`), contractList(d.contracts));
    }
    if (what.type === 'harbour') {
      const n = nodes.get(what.id);
      const ls = links.filter((l) => l.from === n.id || l.to === n.id);
      ls.forEach(lightLink);
      marks.harbour.get(n.id).classList.add('lit');
      panel.append(h('div', n.kind === 'harbour-in' ? 'Harbour · links arriving from another story' : 'Harbour · links leaving for another story', 'kind'));
      panel.append(h('h2', n.story));
      panel.append(h('p', `${ls.length} link${ls.length === 1 ? '' : 's'}; every road from this pier is lit, each to its own gate.`, 'facts'));
      const ul = h('ul');
      for (const l of ls) { const d = describeLink(l); const li = h('li'); li.appendChild(linkButton(l, `${d.caller} → ${d.called}`)); ul.appendChild(li); }
      panel.append(h('h3', 'Its links'), ul);
    }
    if (what.type === 'wrench') {
      const c = caps.get(what.id), w = marks.wrench.get(what.id);
      w.g.classList.add('lit');
      marks.estate.get(c.id).classList.add('lit');
      marks.gate.get(w.via).classList.add('lit');
      panel.append(h('div', 'Open work', 'kind'), h('h2', c.title));
      panel.append(h('p', 'Every arc with open increments whose capabilities list names this capability (measured).', 'facts'));
      const byArc = new Map();
      for (const x of wanted.get(c.id)) { if (!byArc.has(x.arc)) byArc.set(x.arc, { title: x.arcTitle, items: [] }); byArc.get(x.arc).items.push(x); }
      for (const [arc, { title, items }] of byArc) {
        panel.append(h('h3', title));
        panel.append(h('p', arc, 'facts'));
        const ul = h('ul');
        for (const x of items) ul.appendChild(h('li', `${x.title} (${x.status}; ${x.increment})`));
        panel.append(ul);
      }
      const b = h('button', `Open ${c.title}`, 'link'); b.type = 'button'; b.addEventListener('click', () => select({ type: 'estate', id: c.id }));
      panel.append(h('p', ''), b);
    }
    current = what;
  };
  let current = null;

  const rest = () => {
    current = null;
    panel.append(h('div', 'Story', 'kind'), h('h2', D.story.title));
    const within = links.filter((l) => l.kind === 'within').length, arrivals = links.filter((l) => l.kind === 'arrival').length, out = links.filter((l) => l.kind === 'out').length;
    panel.append(h('p', `${D.capabilities.length} capabilities · ${fmt(D.capabilities.reduce((s, c) => s + c.lines, 0))} lines · ${within} links within, ${arrivals} arriving from ${nodes.size && [...nodes.values()].filter((n) => n.kind === 'harbour-in').length} other stories, ${out} out · ${wanted.size} under open work`, 'facts'));
    panel.append(h('h3', 'Key'));
    const key = h('div', '', 'key');
    const sw = (colour, label) => { const s = h('span'); const i = h('i', '', 'swatch'); i.style.background = colour + '99'; s.append(i); key.append(s, h('span', label)); };
    sw(HEALTH.healthy.colour, 'healthy'); sw(HEALTH.unhealthy.colour, 'unhealthy'); sw(HEALTH.untested.colour, 'untested or proposed'); sw(HEALTH.parked.colour, 'parked');
    const glyph = (svg, label) => { const s = h('span'); s.innerHTML = svg; key.append(s, h('span', label)); };
    glyph('<svg width="30" height="14"><path d="M1 7H29" stroke="#2a2723" stroke-width="1.1" stroke-dasharray="5 3.2"/></svg>', "an estate's bounds: one capability, its area its lines of code");
    glyph('<svg width="30" height="14"><path d="M1 7H29" stroke="#8b5e34" stroke-width="2"/></svg>', 'a road: one link, from the caller (above) down to what it calls');
    glyph('<svg width="30" height="16"><path d="M1 12H11M19 12H29" stroke="#2a2723" stroke-width="1.1" stroke-dasharray="5 3.2"/><path d="M15 1V12" stroke="#8b5e34" stroke-width="2"/><path d="M10 9.5V15.5M20 9.5V15.5" stroke="#2a2723" stroke-width="1.7" stroke-linecap="round"/></svg>', "a gate: where one link's road enters what it calls; click it for that capability's contracts");
    glyph('<svg width="30" height="16"><path d="M15 3V14" stroke="#2a2723" stroke-width="3"/><path d="M4 14Q15 11 26 14" fill="none" stroke="#2a2723" stroke-width="1.1"/></svg>', "a harbour: another story's links come ashore, or leave");
    glyph('<svg width="30" height="22" viewBox="-15 -11 30 22"><circle r="10" fill="#f3efe4" stroke="#2a2723"/><use href="#wrench" x="-7" y="-7" width="14" height="14" fill="#2a2723"/></svg>', 'open work on the capability, at the gate it changes');
    panel.append(key);
    panel.append(h('h3', 'Measured'));
    panel.append(h('p', `From the library and the code survey at ${D.measuredAt.slice(0, 16).replace('T', ' ')} UTC: health, lines (tests excluded), links (capability.dependsOn), contracts and the open increments' capabilities lists. Nothing is invented.`, 'facts'));
  };

  // ---- Pan and zoom ----
  const svg = document.getElementById('chart');
  let view = { x: 0, y: 0, k: 1 };
  const apply = () => world.setAttribute('transform', `translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`);
  const bounds = { x0: island.cx - island.a - 50, x1: island.cx + island.a + 50, y0: Math.min(...[...nodes.values()].filter((n) => n.kind === 'harbour-in').map((n) => n.y)) - 64, y1: island.cy + island.b + 128 };
  const fit = () => {
    const r = svg.getBoundingClientRect();
    const padTop = 16, padLeft = 16;
    const k = Math.min((r.width - padLeft * 2) / (bounds.x1 - bounds.x0), (r.height - padTop * 2) / (bounds.y1 - bounds.y0));
    view = { k, x: (r.width - (bounds.x1 - bounds.x0) * k) / 2 - bounds.x0 * k, y: (r.height - (bounds.y1 - bounds.y0) * k) / 2 - bounds.y0 * k };
    apply();
  };
  const zoomAt = (px, py, factor) => {
    const k = Math.min(6, Math.max(0.2, view.k * factor));
    view.x = px - (px - view.x) * (k / view.k); view.y = py - (py - view.y) * (k / view.k); view.k = k; apply();
  };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; svg.classList.add('dragging'); }
    if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
  });
  window.addEventListener('pointerup', () => { if (drag?.moved) { const stop = (ev) => { ev.stopPropagation(); }; window.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0); } drag = null; svg.classList.remove('dragging'); });
  svg.addEventListener('click', (e) => { if (e.target === svg || e.target.closest('.sea, .land')) show(null); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(null); if (e.key === '0') fit(); });
  document.getElementById('fit').addEventListener('click', fit);
  window.addEventListener('resize', fit);

  document.getElementById('readout').textContent = `${D.capabilities.length} capabilities, each an estate sized by its lines of code and tinted by its health; every link a road to its own gate. Measured ${D.measuredAt.slice(0, 10)}.`;
  show(null);
  fit();

  // A handle for the stills script: select by kind and id, and frame a part of the chart.
  window.chart = {
    select: (what) => show(what), fit,
    frame: (x0, y0, x1, y1) => { const r = svg.getBoundingClientRect(); const k = Math.min(r.width / (x1 - x0), r.height / (y1 - y0)); view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k }; apply(); },
    place: (id) => { const n = nodes.get(id); return n && { x: n.x, y: n.y, r: n.r ?? 0 }; },
    gate: (id) => linkById.get(id)?.gate,
    links: () => links.map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to, ...describeLink(l) })),
    toScreen: ([x, y]) => { const r = svg.getBoundingClientRect(); return [r.left + view.x + x * view.k, r.top + view.y + y * view.k]; },
    current: () => current,
    crossings: best.n,
  };
})();
