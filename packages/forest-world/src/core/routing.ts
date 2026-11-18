// Capability 1 · Scene layout

import type { Pt } from './hex.js';
import { HEX_R } from './hex.js';
import { hash, rand01 } from './rng.js';
import { LAND_CAMERA_ELEVATION_DEG, projectGround } from './camera.js';

export interface TrailIsland {
  id: string;
  x: number;
  y: number;
  r: number;
  outline?: readonly (readonly Pt[])[];
}

function rimDistance(isl: TrailIsland, x: number, y: number): number {
  const disc = Math.hypot(x - isl.x, y - isl.y) - isl.r;
  if (!isl.outline) return disc;
  let d = Infinity;
  let inside = false;
  for (const ring of isl.outline) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      if ((b.y > y) !== (a.y > y) && x < ((a.x - b.x) * (y - b.y)) / (a.y - b.y) + b.x) inside = !inside;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      const e = Math.hypot(x - (a.x + u * dx), y - (a.y + u * dy));
      if (e < d) d = e;
    }
  }
  return inside ? -d : d;
}

function nearestOnSegment(a: Pt, b: Pt, x: number, y: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
  return { x: a.x + u * dx, y: a.y + u * dy };
}

function rimPoint(isl: TrailIsland, x: number, y: number, bx: number, by: number): Pt {
  if (!isl.outline) return { x: isl.x + bx * isl.r, y: isl.y + by * isl.r };
  let best: Pt = { x: isl.x, y: isl.y };
  let bd = Infinity;
  for (const ring of isl.outline) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const q = nearestOnSegment(ring[j]!, ring[i]!, x, y);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  return best;
}

function rimReach(isl: TrailIsland, bx: number, by: number): number {
  if (!isl.outline) return isl.r;
  let far = 0;
  for (const ring of isl.outline) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = bx * ey - by * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = a.x - isl.x;
      const ay = a.y - isl.y;
      const along = (ax * ey - ay * ex) / den;
      const u = (ax * by - ay * bx) / den;
      if (along > far && u >= 0 && u <= 1) far = along;
    }
  }
  return far;
}

export interface TrailEdgeIn {
  from: string;
  to: string;
  title?: string;
}

export interface TrailTuning {
  cellSize: number;
  clearance: number;
  falloff: number;
  falloffCost: number;
  noiseAmp: number;
  turnPenalty: number;
  reuseDiscount: number;
  discountFloor: number;
  reuseHaloRadius: number;
  reuseHaloInner: number;
  reuseHaloOuter: number;
  dockMergeGap: number;
  dockMergeSpan: number;
  reclusterOnApproach: boolean;
  approachProbe: number;
  interiorCost: number;
  meanderAmp: number;
  meanderWavelength: number;
  meanderTaper: number;
  meanderClearInner: number;
  meanderClearOuter: number;
  junctionWeld: number;
}

export interface TrailSegment {
  id: string;
  d: string;
  points: readonly { x: number; y: number }[];
  usage: number;
  hidden: boolean;
}

export interface TrailCave {
  islandId: string;
  x: number;
  y: number;
  bearing: number;
  width: number;
  edgeIds: string[];
}

export interface TrailEdgeOut {
  from: string;
  to: string;
  title?: string;
  segments: readonly { id: string; reversed: boolean }[];
}

export interface TrailNetwork {
  segments: TrailSegment[];
  edges: TrailEdgeOut[];
  caves: TrailCave[];
  dropped: { from: string; to: string }[];
}

export function trailFillWidth(usage: number): number {
  return 1.2 + 1.8 * Math.sqrt(Math.max(0, usage));
}

function resolveTuning(o?: Partial<TrailTuning>): TrailTuning {
  const clearance = o?.clearance ?? 0.6 * HEX_R;
  return {
    cellSize: o?.cellSize ?? HEX_R / 2,
    clearance,
    falloff: o?.falloff ?? 2.5 * HEX_R,
    falloffCost: o?.falloffCost ?? 6,
    noiseAmp: o?.noiseAmp ?? 0.15,
    turnPenalty: o?.turnPenalty ?? 0.5,
    reuseDiscount: o?.reuseDiscount ?? 0.22,
    discountFloor: o?.discountFloor ?? 0.05,
    reuseHaloRadius: o?.reuseHaloRadius ?? 2,
    reuseHaloInner: o?.reuseHaloInner ?? 1.2,
    reuseHaloOuter: o?.reuseHaloOuter ?? 1.0,
    dockMergeGap: o?.dockMergeGap ?? Math.PI / 3,
    dockMergeSpan: o?.dockMergeSpan ?? (5 * Math.PI) / 9,
    reclusterOnApproach: o?.reclusterOnApproach ?? true,
    approachProbe: o?.approachProbe ?? clearance + 4 * (o?.cellSize ?? HEX_R / 2),
    interiorCost: o?.interiorCost ?? 40,
    meanderAmp: Math.min(o?.meanderAmp ?? 0.22 * clearance, 0.95 * clearance),
    meanderWavelength: o?.meanderWavelength ?? 4 * HEX_R,
    meanderTaper: o?.meanderTaper ?? 4 * HEX_R,
    meanderClearInner: o?.meanderClearInner ?? clearance,
    meanderClearOuter: o?.meanderClearOuter ?? clearance + 2 * (o?.cellSize ?? HEX_R / 2),
    junctionWeld: o?.junctionWeld ?? 1.4 * (o?.cellSize ?? HEX_R / 2),
  };
}

interface Grid {
  ox: number;
  oy: number;
  cs: number;
  cols: number;
  rows: number;
  cost: Float64Array;
  blockA: Int32Array;
  blockB: Int32Array;
  blockC: Int32Array;
  interior: Int32Array;
}

function buildGrid(islands: readonly TrailIsland[], seed: string, t: TrailTuning): Grid {
  const margin = t.clearance + t.falloff + 2 * t.cellSize;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const isl of islands) {
    minX = Math.min(minX, isl.x - isl.r);
    minY = Math.min(minY, isl.y - isl.r);
    maxX = Math.max(maxX, isl.x + isl.r);
    maxY = Math.max(maxY, isl.y + isl.r);
  }
  const ox = minX - margin;
  const oy = minY - margin;
  const cols = Math.max(1, Math.ceil((maxX + margin - ox) / t.cellSize));
  const rows = Math.max(1, Math.ceil((maxY + margin - oy) / t.cellSize));
  const n = cols * rows;
  const cost = new Float64Array(n);
  const blockA = new Int32Array(n).fill(-1);
  const blockB = new Int32Array(n).fill(-1);
  const blockC = new Int32Array(n).fill(-1);
  const interior = new Int32Array(n).fill(-1);
  for (let iy = 0; iy < rows; iy++) {
    const cy = oy + (iy + 0.5) * t.cellSize;
    for (let ix = 0; ix < cols; ix++) {
      const idx = iy * cols + ix;
      const cx = ox + (ix + 0.5) * t.cellSize;
      let surplusMin = Infinity;
      let bA = -1;
      let bAd = Infinity;
      let bB = -1;
      let bBd = Infinity;
      let bC = -1;
      let bCd = Infinity;
      let intIdx = -1;
      let intD = Infinity;
      for (let k = 0; k < islands.length; k++) {
        const isl = islands[k];
        if (!isl) continue;
        let rim = Math.hypot(cx - isl.x, cy - isl.y) - isl.r;
        if (isl.outline && rim < t.clearance + t.falloff) rim = rimDistance(isl, cx, cy);
        surplusMin = Math.min(surplusMin, rim - t.clearance);
        if (rim <= t.clearance) {
          if (rim < bAd) {
            bC = bB;
            bCd = bBd;
            bB = bA;
            bBd = bAd;
            bA = k;
            bAd = rim;
          } else if (rim < bBd) {
            bC = bB;
            bCd = bBd;
            bB = k;
            bBd = rim;
          } else if (rim < bCd) {
            bC = k;
            bCd = rim;
          }
        }
        if (rim < 0 && rim < intD) {
          intIdx = k;
          intD = rim;
        }
      }
      let c = 1 + t.noiseAmp * rand01(hash(`${seed}:c:${idx}`));
      if (surplusMin < t.falloff) {
        const f = 1 - Math.max(0, surplusMin) / t.falloff;
        c += t.falloffCost * f * f;
      }
      cost[idx] = c;
      blockA[idx] = bA;
      blockB[idx] = bB;
      blockC[idx] = bC;
      interior[idx] = intIdx;
    }
  }
  return { ox, oy, cs: t.cellSize, cols, rows, cost, blockA, blockB, blockC, interior };
}

function blockedFor(grid: Grid, idx: number, fi: number, ti: number): boolean {
  const a = grid.blockA[idx] ?? -1;
  const b = grid.blockB[idx] ?? -1;
  const c = grid.blockC[idx] ?? -1;
  if (
    (a !== -1 && a !== fi && a !== ti) ||
    (b !== -1 && b !== fi && b !== ti) ||
    (c !== -1 && c !== fi && c !== ti)
  ) {
    return true;
  }
  const ii = grid.interior[idx] ?? -1;
  return ii !== -1 && (ii === fi || ii === ti);
}

const SQRT2 = Math.SQRT2;

const DIRS: readonly { dx: number; dy: number; len: number }[] = [
  { dx: 1, dy: 0, len: 1 },
  { dx: -1, dy: 0, len: 1 },
  { dx: 0, dy: 1, len: 1 },
  { dx: 0, dy: -1, len: 1 },
  { dx: 1, dy: 1, len: SQRT2 },
  { dx: 1, dy: -1, len: SQRT2 },
  { dx: -1, dy: 1, len: SQRT2 },
  { dx: -1, dy: -1, len: SQRT2 },
];

class OpenHeap {
  f = new Float64Array(1024);
  g = new Float64Array(1024);
  i = new Int32Array(1024);
  size = 0;

  private less(a: number, b: number): boolean {
    const { f, g, i } = this;
    if (f[a] !== f[b]) return f[a]! < f[b]!;
    if (g[a] !== g[b]) return g[a]! < g[b]!;
    return i[a]! < i[b]!;
  }

  private swap(a: number, b: number): void {
    const { f, g, i } = this;
    const tf = f[a]!, tg = g[a]!, ti = i[a]!;
    f[a] = f[b]!; g[a] = g[b]!; i[a] = i[b]!;
    f[b] = tf; g[b] = tg; i[b] = ti;
  }

  push(f: number, g: number, i: number): void {
    if (this.size === this.f.length) {
      const grow = <T extends Float64Array | Int32Array>(old: T, make: (n: number) => T): T => { const next = make(old.length * 2); next.set(old); return next; };
      this.f = grow(this.f, n => new Float64Array(n));
      this.g = grow(this.g, n => new Float64Array(n));
      this.i = grow(this.i, n => new Int32Array(n));
    }
    let at = this.size++;
    this.f[at] = f; this.g[at] = g; this.i[at] = i;
    while (at > 0) {
      const p = (at - 1) >> 1;
      if (!this.less(at, p)) break;
      this.swap(at, p);
      at = p;
    }
  }

  pop(top: { g: number; i: number }): boolean {
    if (this.size === 0) return false;
    top.g = this.g[0]!;
    top.i = this.i[0]!;
    const n = --this.size;
    if (n === 0) return true;
    this.f[0] = this.f[n]!; this.g[0] = this.g[n]!; this.i[0] = this.i[n]!;
    let at = 0;
    for (;;) {
      const l = 2 * at + 1;
      const r = l + 1;
      let m = at;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === at) break;
      this.swap(m, at);
      at = m;
    }
    return true;
  }
}

interface AstarState {
  g: Float64Array;
  parent: Int32Array;
  dirAt: Int8Array;
  seen: Int32Array;
  closed: Int32Array;
  gen: number;
}

function runAstar(
  grid: Grid,
  st: AstarState,
  t: TrailTuning,
  start: number,
  goal: number,
  fi: number,
  ti: number,
  cave: boolean,
): number[] | null {
  st.gen++;
  const gen = st.gen;
  const { cols, rows, cost } = grid;
  const cellCost = (idx: number): number => {
    if (!blockedFor(grid, idx, fi, ti)) return cost[idx] ?? 1;
    return cave ? t.interiorCost : Infinity;
  };
  if (cellCost(start) === Infinity || cellCost(goal) === Infinity) return null;
  if (start === goal) return [start];
  const gx = goal % cols;
  const gy = (goal / cols) | 0;
  const hScale = Math.min(1, t.discountFloor);
  const hOf = (ix: number, iy: number): number => {
    const dx = Math.abs(ix - gx);
    const dy = Math.abs(iy - gy);
    const mn = Math.min(dx, dy);
    return (Math.max(dx, dy) + (SQRT2 - 1) * mn) * hScale;
  };
  const open = new OpenHeap();
  const e = { g: 0, i: 0 };
  st.seen[start] = gen;
  st.closed[start] = 0;
  st.g[start] = 0;
  st.parent[start] = -1;
  st.dirAt[start] = -1;
  open.push(hOf(start % cols, (start / cols) | 0), 0, start);
  let found = false;
  while (open.pop(e)) {
    const cur = e.i;
    if (st.closed[cur] === gen) continue;
    if (e.g !== st.g[cur]) continue;
    st.closed[cur] = gen;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % cols;
    const cyi = (cur / cols) | 0;
    const cCur = cellCost(cur);
    const inDir = st.dirAt[cur] ?? -1;
    for (let di = 0; di < DIRS.length; di++) {
      const dd = DIRS[di]!;
      const nx = cx + dd.dx;
      const ny = cyi + dd.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (st.closed[ni] === gen) continue;
      const cNb = cellCost(ni);
      if (cNb === Infinity) continue;
      if (dd.dx !== 0 && dd.dy !== 0) {
        if (cellCost(cyi * cols + nx) === Infinity || cellCost(ny * cols + cx) === Infinity) continue;
      }
      const turn = inDir !== -1 && inDir !== di ? t.turnPenalty : 0;
      const ng = (st.g[cur] ?? 0) + dd.len * 0.5 * (cCur + cNb) + turn;
      if (st.seen[ni] === gen && ng >= (st.g[ni] ?? Infinity)) continue;
      st.seen[ni] = gen;
      st.g[ni] = ng;
      st.parent[ni] = cur;
      st.dirAt[ni] = di;
      open.push(ng + hOf(nx, ny), ng, ni);
    }
  }
  if (!found) return null;
  const path: number[] = [];
  for (let cur = goal; cur !== -1; cur = st.parent[cur] ?? -1) path.push(cur);
  path.reverse();
  return path;
}

function r2(v: number): string {
  const n = Math.round(v * 100) / 100;
  return (n === 0 ? 0 : n).toString();
}

export function crPathD(pts: readonly Pt[]): string {
  const first = pts[0];
  if (!first) return '';
  let d = `M ${r2(first.x)} ${r2(first.y)}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const d1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const d2 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const d3 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
    if (d2 < 1e-9) continue;
    let m1x: number;
    let m1y: number;
    let m2x: number;
    let m2y: number;
    if (d1 < 1e-6) {
      m1x = p2.x - p1.x;
      m1y = p2.y - p1.y;
    } else {
      m1x = d2 * ((p1.x - p0.x) / d1 - (p2.x - p0.x) / (d1 + d2) + (p2.x - p1.x) / d2);
      m1y = d2 * ((p1.y - p0.y) / d1 - (p2.y - p0.y) / (d1 + d2) + (p2.y - p1.y) / d2);
    }
    if (d3 < 1e-6) {
      m2x = p2.x - p1.x;
      m2y = p2.y - p1.y;
    } else {
      m2x = d2 * ((p2.x - p1.x) / d2 - (p3.x - p1.x) / (d2 + d3) + (p3.x - p2.x) / d3);
      m2y = d2 * ((p2.y - p1.y) / d2 - (p3.y - p1.y) / (d2 + d3) + (p3.y - p2.y) / d3);
    }
    const c1x = p1.x + m1x / 3;
    const c1y = p1.y + m1y / 3;
    const c2x = p2.x - m2x / 3;
    const c2y = p2.y - m2y / 3;
    d += ` C ${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

interface ResampledSeg {
  pts: Pt[];
  cum: number[];
  total: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function resampleSegment(rawPts: readonly Pt[], t: TrailTuning): ResampledSeg {
  const dedup: Pt[] = [];
  for (const p of rawPts) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-9) continue;
    dedup.push({ x: p.x, y: p.y });
  }
  const dec: Pt[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const p = dedup[i]!;
    if (i > 0 && i < dedup.length - 1) {
      const q = dec[dec.length - 1]!;
      const nxt = dedup[i + 1]!;
      const cross = (p.x - q.x) * (nxt.y - p.y) - (p.y - q.y) * (nxt.x - p.x);
      if (Math.abs(cross) < 1e-6) continue;
    }
    dec.push(p);
  }
  const step = Math.max(t.meanderWavelength / 3, t.cellSize);
  const pts: Pt[] = [{ x: dec[0]!.x, y: dec[0]!.y }];
  for (let i = 0; i + 1 < dec.length; i++) {
    const a = dec[i]!;
    const b = dec[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nSub = Math.max(1, Math.round(len / step));
    for (let k = 1; k < nSub; k++) {
      const f = k / nSub;
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    pts.push({ x: b.x, y: b.y });
  }
  const cum: number[] = [0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) cum.push((cum[i - 1] ?? 0) + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { pts, cum, total: cum[cum.length - 1] ?? 0, minX, minY, maxX, maxY };
}

function distSqPtSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let tt = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const cx = ax + tt * dx;
  const cy = ay + tt * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

function distToOtherTrails(px: number, py: number, others: readonly ResampledSeg[], within: number): number {
  const w2 = within * within;
  let best = Infinity;
  for (const o of others) {
    if (px < o.minX - within || px > o.maxX + within || py < o.minY - within || py > o.maxY + within) continue;
    for (let i = 0; i + 1 < o.pts.length; i++) {
      const a = o.pts[i]!;
      const b = o.pts[i + 1]!;
      const d2 = distSqPtSeg(px, py, a.x, a.y, b.x, b.y);
      if (d2 < best) best = d2;
      if (best <= w2) return Math.sqrt(best);
    }
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

interface MeanderedSegment {
  points: Pt[];
  d: string;
}

function meanderSpline(
  base: ResampledSeg,
  hidden: boolean,
  segId: string,
  islands: readonly TrailIsland[],
  others: readonly ResampledSeg[],
  seed: string,
  t: TrailTuning,
): MeanderedSegment {
  const pts: Pt[] = base.pts.map((p) => ({ x: p.x, y: p.y }));
  if (!hidden && pts.length > 2) {
    const s = base.cum;
    const total = base.total;
    const clearSpan = t.meanderClearOuter - t.meanderClearInner;
    for (let i = 1; i + 1 < pts.length; i++) {
      const bp = base.pts[i]!;
      let nearIsland = false;
      for (const isl of islands) {
        if (rimDistance(isl, bp.x, bp.y) < t.clearance) {
          nearIsland = true;
          break;
        }
      }
      if (nearIsland) continue;
      const distEnd = Math.min(s[i] ?? 0, total - (s[i] ?? 0));
      const fEnd = t.meanderTaper > 0 ? Math.min(1, distEnd / t.meanderTaper) : 1;
      let fOther = 1;
      if (clearSpan > 0) {
        const dOther = distToOtherTrails(bp.x, bp.y, others, t.meanderClearOuter);
        fOther = dOther >= t.meanderClearOuter ? 1 : Math.max(0, (dOther - t.meanderClearInner) / clearSpan);
      }
      const scale = Math.min(fEnd, fOther);
      if (scale < 1e-3) continue;
      const ph = (s[i] ?? 0) / t.meanderWavelength;
      const k0 = Math.floor(ph);
      const f = ph - k0;
      const u = f * f * (3 - 2 * f);
      const n0 = rand01(hash(`${seed}:w:${segId}:${k0}`)) * 2 - 1;
      const n1 = rand01(hash(`${seed}:w:${segId}:${k0 + 1}`)) * 2 - 1;
      const off = t.meanderAmp * scale * (n0 + (n1 - n0) * u);
      const pa = pts[i - 1]!;
      const pb = pts[i + 1]!;
      const tx = pb.x - pa.x;
      const ty = pb.y - pa.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-9) continue;
      const p = pts[i]!;
      p.x += (-ty / tl) * off;
      p.y += (tx / tl) * off;
    }
  }
  return { points: pts, d: crPathD(pts) };
}

interface NodeRec {
  key: string;
  x: number;
  y: number;
  underOf: number;
}

interface RoutedEdge {
  key: string;
  from: string;
  to: string;
  title: string | undefined;
  nodes: NodeRec[];
}

const SEP = '\u0000';
const HIDDEN_MARK = '\u0001';
const SIG_JOIN = '\u0002';

function linkKeyOf(a: NodeRec, b: NodeRec): string {
  return a.key < b.key ? `${a.key}${SEP}${b.key}` : `${b.key}${SEP}${a.key}`;
}

function circleCrossing(a: NodeRec, b: NodeRec, isl: TrailIsland): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - isl.x;
  const fy = a.y - isl.y;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - isl.r * isl.r;
  const disc = qb * qb - 4 * qa * qc;
  let tt = 0.5;
  if (qa > 1e-12 && disc >= 0) {
    const sq = Math.sqrt(disc);
    const t1 = (-qb - sq) / (2 * qa);
    const t2 = (-qb + sq) / (2 * qa);
    tt = t1 >= 0 && t1 <= 1 ? t1 : Math.min(1, Math.max(0, t2));
  }
  return { x: a.x + dx * tt, y: a.y + dy * tt };
}

function outlineCrossing(a: NodeRec, b: NodeRec, isl: TrailIsland): Pt {
  let lo = 0;
  let hi = 1;
  const inA = rimDistance(isl, a.x, a.y) < 0;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    const inMid = rimDistance(isl, a.x + (b.x - a.x) * mid, a.y + (b.y - a.y) * mid) < 0;
    if (inMid === inA) lo = mid;
    else hi = mid;
  }
  const tt = (lo + hi) / 2;
  return { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt };
}

export function routeTrails(
  islands: readonly TrailIsland[],
  edges: readonly TrailEdgeIn[],
  seed: string,
  tuning?: Partial<TrailTuning>,
): TrailNetwork {
  const t = resolveTuning(tuning);
  const byId = new Map<string, number>();
  islands.forEach((isl, i) => {
    if (!byId.has(isl.id)) byId.set(isl.id, i);
  });

  interface Cand {
    key: string;
    from: string;
    to: string;
    title: string | undefined;
    fi: number;
    ti: number;
    chord: number;
  }
  const cands: Cand[] = [];
  const dropped: { from: string; to: string }[] = [];
  const finishDropped = (): { from: string; to: string }[] => {
    const seen = new Set<string>();
    const out: { from: string; to: string }[] = [];
    for (const d of dropped) {
      const k = `${d.from}${SEP}${d.to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
    out.sort((p, q) =>
      p.from !== q.from ? (p.from < q.from ? -1 : 1) : p.to < q.to ? -1 : p.to > q.to ? 1 : 0,
    );
    return out;
  };
  for (const e of edges) {
    const fi = byId.get(e.from);
    const ti = byId.get(e.to);
    if (fi === undefined || ti === undefined) {
      dropped.push({ from: e.from, to: e.to });
      continue;
    }
    if (fi === ti) continue;
    const a = islands[fi]!;
    const b = islands[ti]!;
    cands.push({
      key: `${e.from}${SEP}${e.to}`,
      from: e.from,
      to: e.to,
      title: e.title,
      fi,
      ti,
      chord: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  cands.sort((p, q) => {
    if (p.chord !== q.chord) return q.chord - p.chord;
    if (p.key !== q.key) return p.key < q.key ? -1 : 1;
    const pt = p.title ?? '';
    const qt = q.title ?? '';
    return pt < qt ? -1 : pt > qt ? 1 : 0;
  });
  const canon: Cand[] = [];
  for (const c of cands) {
    const prev = canon[canon.length - 1];
    if (prev && prev.key === c.key) continue;
    canon.push(c);
  }
  if (islands.length === 0 || canon.length === 0) {
    return { segments: [], edges: [], caves: [], dropped: finishDropped() };
  }

  let grid = buildGrid(islands, seed, t);
  const freshCost = grid.cost.slice();
  const nCells = grid.cols * grid.rows;
  const st: AstarState = {
    g: new Float64Array(nCells),
    parent: new Int32Array(nCells),
    dirAt: new Int8Array(nCells),
    seen: new Int32Array(nCells),
    closed: new Int32Array(nCells),
    gen: 0,
  };
  const cellIndexAt = (x: number, y: number): number => {
    const ix = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.ox) / grid.cs)));
    const iy = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.oy) / grid.cs)));
    return iy * grid.cols + ix;
  };
  const centerOf = (idx: number): Pt => ({
    x: grid.ox + ((idx % grid.cols) + 0.5) * grid.cs,
    y: grid.oy + (((idx / grid.cols) | 0) + 0.5) * grid.cs,
  });
  const dockCellAt = (isl: TrailIsland, bx: number, by: number, fi: number, ti: number): number => {
    const rad = rimReach(isl, bx, by) + 0.75 * grid.cs;
    const idx0 = cellIndexAt(isl.x + bx * rad, isl.y + by * rad);
    if (!blockedFor(grid, idx0, fi, ti)) return idx0;
    const base = Math.atan2(by, bx);
    const steps = Math.max(16, Math.ceil((2 * Math.PI * rad) / grid.cs));
    for (let k = 1; k <= steps >> 1; k++) {
      for (const s of [1, -1] as const) {
        const ang = base + (s * k * 2 * Math.PI) / steps;
        const out = isl.outline ? rimReach(isl, Math.cos(ang), Math.sin(ang)) + 0.75 * grid.cs : rad;
        const idx = cellIndexAt(isl.x + Math.cos(ang) * out, isl.y + Math.sin(ang) * out);
        if (!blockedFor(grid, idx, fi, ti)) return idx;
      }
    }
    return idx0;
  };

  interface Approach {
    edgeKey: string;
    bx: number;
    by: number;
    ang: number;
  }
  const pushApproach = (
    incident: Map<number, Approach[]>,
    islIdx: number,
    edgeKey: string,
    tx: number,
    ty: number,
  ): void => {
    const L = Math.hypot(tx, ty);
    const bx = L < 1e-9 ? 1 : tx / L;
    const by = L < 1e-9 ? 0 : ty / L;
    const arr = incident.get(islIdx);
    const rec: Approach = { edgeKey, bx, by, ang: Math.atan2(by, bx) };
    if (arr) arr.push(rec);
    else incident.set(islIdx, [rec]);
  };
  const clusterDocks = (incident: Map<number, Approach[]>): Map<string, { bx: number; by: number }> => {
    const dockBearing = new Map<string, { bx: number; by: number }>();
    for (const [islIdx, appsRaw] of incident) {
      const apps = [...appsRaw].sort((p, q) =>
        p.ang !== q.ang ? p.ang - q.ang : p.edgeKey < q.edgeKey ? -1 : p.edgeKey > q.edgeKey ? 1 : 0,
      );
      const n = apps.length;
      const assign = (members: Approach[]): void => {
        let sx = 0;
        let sy = 0;
        for (const m of members) {
          sx += m.bx;
          sy += m.by;
        }
        const L = Math.hypot(sx, sy);
        const bx = L < 1e-9 ? members[0]!.bx : sx / L;
        const by = L < 1e-9 ? members[0]!.by : sy / L;
        for (const m of members) dockBearing.set(`${islIdx}${SEP}${m.edgeKey}`, { bx, by });
      };
      if (n === 1) {
        assign(apps);
        continue;
      }
      let cut = 0;
      let widest = -1;
      for (let i = 0; i < n; i++) {
        const a0 = apps[i]!.ang;
        const a1 = apps[(i + 1) % n]!.ang + (i + 1 === n ? 2 * Math.PI : 0);
        const gap = a1 - a0;
        if (gap > widest) {
          widest = gap;
          cut = (i + 1) % n;
        }
      }
      const order: Approach[] = [];
      for (let i = 0; i < n; i++) order.push(apps[(cut + i) % n]!);
      const base = order[0]!.ang;
      const un = order.map((a) => {
        let d = a.ang - base;
        while (d < 0) d += 2 * Math.PI;
        return d;
      });
      let start = 0;
      for (let i = 1; i < order.length; i++) {
        const gap = un[i]! - un[i - 1]!;
        const span = un[i]! - un[start]!;
        if (gap > t.dockMergeGap || span > t.dockMergeSpan) {
          assign(order.slice(start, i));
          start = i;
        }
      }
      assign(order.slice(start));
    }
    return dockBearing;
  };

  const chordIncident = new Map<number, Approach[]>();
  for (const c of canon) {
    const A = islands[c.fi]!;
    const B = islands[c.ti]!;
    pushApproach(chordIncident, c.fi, c.key, B.x - A.x, B.y - A.y);
    pushApproach(chordIncident, c.ti, c.key, A.x - B.x, A.y - B.y);
  }

  const routePass = (dockBearing: Map<string, { bx: number; by: number }>): RoutedEdge[] => {
    const routed: RoutedEdge[] = [];
    for (const c of canon) {
      const A = islands[c.fi]!;
      const B = islands[c.ti]!;
      let ux = B.x - A.x;
      let uy = B.y - A.y;
      const chordLen = Math.hypot(ux, uy);
      if (chordLen < 1e-9) {
        ux = 1;
        uy = 0;
      } else {
        ux /= chordLen;
        uy /= chordLen;
      }
      const dbA = dockBearing.get(`${c.fi}${SEP}${c.key}`) ?? { bx: ux, by: uy };
      const dbB = dockBearing.get(`${c.ti}${SEP}${c.key}`) ?? { bx: -ux, by: -uy };
      const start = dockCellAt(A, dbA.bx, dbA.by, c.fi, c.ti);
      const goal = dockCellAt(B, dbB.bx, dbB.by, c.fi, c.ti);
      let path = runAstar(grid, st, t, start, goal, c.fi, c.ti, false);
      if (!path) path = runAstar(grid, st, t, start, goal, c.fi, c.ti, true);
      if (!path) {
        dropped.push({ from: c.from, to: c.to });
        continue;
      }

      const R = Math.max(1, Math.round(t.reuseHaloRadius));
      const ringDisc = (c: number): number => {
        const frac = R <= 1 ? t.reuseHaloInner : t.reuseHaloInner + (t.reuseHaloOuter - t.reuseHaloInner) * ((c - 1) / (R - 1));
        return t.reuseDiscount + (1 - t.reuseDiscount) * frac;
      };
      const onPath = new Set<number>(path);
      const ringOf = new Map<number, number>();
      for (const ci of path) {
        const ix = ci % grid.cols;
        const iy = (ci / grid.cols) | 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const cheb = Math.max(Math.abs(dx), Math.abs(dy));
            if (cheb === 0) continue;
            const nx = ix + dx;
            const ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
            const ni = ny * grid.cols + nx;
            if (onPath.has(ni)) continue;
            const disc = ringDisc(cheb);
            const prev = ringOf.get(ni);
            if (prev === undefined || disc < prev) ringOf.set(ni, disc);
          }
        }
      }
      for (const ci of onPath) grid.cost[ci] = Math.max(t.discountFloor, (grid.cost[ci] ?? 1) * t.reuseDiscount);
      for (const [ni, disc] of ringOf) grid.cost[ni] = Math.max(t.discountFloor, (grid.cost[ni] ?? 1) * disc);

      const nodes: NodeRec[] = [];
      const firstCell = path[0]!;
      const lastCell = path[path.length - 1]!;
      const pF = centerOf(firstCell);
      let bfx = pF.x - A.x;
      let bfy = pF.y - A.y;
      const lf = Math.hypot(bfx, bfy);
      if (lf < 1e-9) {
        bfx = ux;
        bfy = uy;
      } else {
        bfx /= lf;
        bfy /= lf;
      }
      nodes.push({ key: `r:${A.id}:${firstCell}`, ...rimPoint(A, pF.x, pF.y, bfx, bfy), underOf: -1 });
      for (const ci of path) {
        const p = centerOf(ci);
        nodes.push({
          key: `c:${ci}`,
          x: p.x,
          y: p.y,
          underOf: grid.interior[ci] ?? -1,
        });
      }
      const pL = centerOf(lastCell);
      let btx = pL.x - B.x;
      let bty = pL.y - B.y;
      const lt = Math.hypot(btx, bty);
      if (lt < 1e-9) {
        btx = -ux;
        bty = -uy;
      } else {
        btx /= lt;
        bty /= lt;
      }
      nodes.push({ key: `r:${B.id}:${lastCell}`, ...rimPoint(B, pL.x, pL.y, btx, bty), underOf: -1 });
      routed.push({ key: c.key, from: c.from, to: c.to, title: c.title, nodes });
    }
    return routed;
  };

  let routed = routePass(clusterDocks(chordIncident));

  if (t.reclusterOnApproach) {
    const probe = t.approachProbe;
    const apprIncident = new Map<number, Approach[]>();
    for (const re of routed) {
      const fi = byId.get(re.from);
      const ti = byId.get(re.to);
      if (fi === undefined || ti === undefined) continue;
      const A = islands[fi]!;
      const B = islands[ti]!;
      const approachFrom = (isl: TrailIsland, fromStart: boolean): { x: number; y: number } => {
        const N = re.nodes.length;
        for (let k = 0; k < N; k++) {
          const nd = re.nodes[fromStart ? k : N - 1 - k]!;
          if (rimDistance(isl, nd.x, nd.y) > probe) return nd;
        }
        return re.nodes[fromStart ? N - 1 : 0]!;
      };
      const pa = approachFrom(A, true);
      const pb = approachFrom(B, false);
      pushApproach(apprIncident, fi, re.key, pa.x - A.x, pa.y - A.y);
      pushApproach(apprIncident, ti, re.key, pb.x - B.x, pb.y - B.y);
    }
    grid = { ...grid, cost: freshCost };
    routed = routePass(clusterDocks(apprIncident));
  }

  if (t.junctionWeld > 0) {
    const nbrs = new Map<string, Set<string>>();
    const posOf = new Map<string, Pt>();
    for (const re of routed) {
      for (let i = 0; i < re.nodes.length; i++) {
        const nd = re.nodes[i]!;
        if (!posOf.has(nd.key)) posOf.set(nd.key, { x: nd.x, y: nd.y });
        if (nd.underOf !== -1) continue;
        const set = nbrs.get(nd.key) ?? nbrs.set(nd.key, new Set()).get(nd.key)!;
        const prev = re.nodes[i - 1];
        const next = re.nodes[i + 1];
        if (prev) set.add(prev.key);
        if (next) set.add(next.key);
      }
    }
    const junctionKeys = [...nbrs.entries()].filter(([, s]) => s.size >= 3).map(([k]) => k).sort();
    if (junctionKeys.length > 1) {
      const parent = new Map<string, string>(junctionKeys.map((k) => [k, k]));
      const find = (k: string): string => {
        let root = k;
        while (parent.get(root) !== root) root = parent.get(root)!;
        while (parent.get(k) !== root) {
          const up = parent.get(k)!;
          parent.set(k, root);
          k = up;
        }
        return root;
      };
      const union = (a: string, b: string): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        if (ra < rb) parent.set(rb, ra);
        else parent.set(ra, rb);
      };
      const weld2 = t.junctionWeld * t.junctionWeld;
      for (let i = 0; i < junctionKeys.length; i++) {
        const a = posOf.get(junctionKeys[i]!)!;
        for (let j = i + 1; j < junctionKeys.length; j++) {
          const b = posOf.get(junctionKeys[j]!)!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy <= weld2) union(junctionKeys[i]!, junctionKeys[j]!);
        }
      }
      const members = new Map<string, string[]>();
      for (const k of junctionKeys) (members.get(find(k)) ?? members.set(find(k), []).get(find(k))!).push(k);
      const canonPos = new Map<string, Pt>();
      for (const [root, ms] of members) {
        let sx = 0;
        let sy = 0;
        for (const m of ms) {
          const p = posOf.get(m)!;
          sx += p.x;
          sy += p.y;
        }
        canonPos.set(root, { x: sx / ms.length, y: sy / ms.length });
      }
      for (const re of routed) {
        const mapped: NodeRec[] = re.nodes.map((nd) => {
          if (nd.underOf !== -1 || !parent.has(nd.key)) return nd;
          const root = find(nd.key);
          const cp = canonPos.get(root)!;
          return { key: root, x: cp.x, y: cp.y, underOf: -1 };
        });
        const out: NodeRec[] = [];
        for (const nd of mapped) {
          const prev = out[out.length - 1];
          if (prev && prev.key === nd.key) continue;
          if (out.length >= 2 && out[out.length - 2]!.key === nd.key) {
            out.pop();
            continue;
          }
          out.push(nd);
        }
        re.nodes = out;
      }
    }
  }

  const linkEntries = new Map<string, Set<string>>();
  for (const re of routed) {
    for (let i = 0; i + 1 < re.nodes.length; i++) {
      const a = re.nodes[i]!;
      const b = re.nodes[i + 1]!;
      const entry = re.key + (a.underOf !== -1 || b.underOf !== -1 ? HIDDEN_MARK : '');
      const lk = linkKeyOf(a, b);
      let set = linkEntries.get(lk);
      if (!set) {
        set = new Set();
        linkEntries.set(lk, set);
      }
      set.add(entry);
    }
  }
  const sigOf = new Map<string, string>();
  for (const [lk, set] of linkEntries) sigOf.set(lk, [...set].sort().join(SIG_JOIN));

  interface SegRec {
    id: string;
    pts: Pt[];
    hidden: boolean;
    usage: number;
  }
  const segByCanon = new Map<string, SegRec>();
  const segOrder: SegRec[] = [];
  const segIdCount = new Map<string, number>();
  const outEdges: TrailEdgeOut[] = [];
  for (const re of routed) {
    const linkCount = re.nodes.length - 1;
    const sigs: string[] = [];
    for (let l = 0; l < linkCount; l++) {
      sigs.push(sigOf.get(linkKeyOf(re.nodes[l]!, re.nodes[l + 1]!)) ?? '');
    }
    const chain: { id: string; reversed: boolean }[] = [];
    const emitRun = (from: number, to: number): void => {
      const run = re.nodes.slice(from, to + 1);
      const keys = run.map((nd) => nd.key);
      const fwd = keys.join(SEP);
      const rev = [...keys].reverse().join(SEP);
      const reversed = rev < fwd;
      const canonKey = reversed ? rev : fwd;
      let rec = segByCanon.get(canonKey);
      if (!rec) {
        const entries = (sigs[from] ?? '').split(SIG_JOIN).filter((x) => x.length > 0);
        const base = `t${hash(canonKey).toString(36)}`;
        const nth = segIdCount.get(base) ?? 0;
        segIdCount.set(base, nth + 1);
        rec = {
          id: nth === 0 ? base : `${base}-${nth + 1}`,
          pts: (reversed ? [...run].reverse() : run).map((nd) => ({ x: nd.x, y: nd.y })),
          hidden: entries.length > 0 && entries.every((x) => x.endsWith(HIDDEN_MARK)),
          usage: entries.length,
        };
        segByCanon.set(canonKey, rec);
        segOrder.push(rec);
      }
      chain.push({ id: rec.id, reversed });
    };
    let runStart = 0;
    for (let l = 1; l < linkCount; l++) {
      if (sigs[l] !== sigs[l - 1]) {
        emitRun(runStart, l);
        runStart = l;
      }
    }
    emitRun(runStart, linkCount);
    const outEdge: TrailEdgeOut = { from: re.from, to: re.to, segments: chain };
    if (re.title !== undefined) outEdge.title = re.title;
    outEdges.push(outEdge);
  }

  interface CaveAcc {
    islandId: string;
    x: number;
    y: number;
    bearing: number;
    edgeIds: Set<string>;
  }
  const caveMap = new Map<string, CaveAcc>();
  const addPortal = (isl: TrailIsland, a: NodeRec, b: NodeRec, edgeKey: string): void => {
    const key = `${isl.id}${SEP}${linkKeyOf(a, b)}`;
    let acc = caveMap.get(key);
    if (!acc) {
      const p = isl.outline ? outlineCrossing(a, b, isl) : circleCrossing(a, b, isl);
      acc = {
        islandId: isl.id,
        x: p.x,
        y: p.y,
        bearing: Math.atan2(p.y - isl.y, p.x - isl.x),
        edgeIds: new Set(),
      };
      caveMap.set(key, acc);
    }
    acc.edgeIds.add(edgeKey);
  };
  for (const re of routed) {
    const displayKey = `${re.from}->${re.to}`;
    for (let i = 0; i + 1 < re.nodes.length; i++) {
      const a = re.nodes[i]!;
      const b = re.nodes[i + 1]!;
      if (a.underOf === b.underOf) continue;
      if (a.underOf !== -1) addPortal(islands[a.underOf]!, a, b, displayKey);
      if (b.underOf !== -1) addPortal(islands[b.underOf]!, a, b, displayKey);
    }
  }
  const caves: TrailCave[] = [...caveMap.values()].map((acc) => ({
    islandId: acc.islandId,
    x: acc.x,
    y: acc.y,
    bearing: acc.bearing,
    width: trailFillWidth(acc.edgeIds.size),
    edgeIds: [...acc.edgeIds].sort(),
  }));

  const bases = segOrder.map((rec) => resampleSegment(rec.pts, t));
  const visibleBases = segOrder.map((rec, i) => (rec.hidden ? null : bases[i]!));
  const segments: TrailSegment[] = segOrder.map((rec, i) => {
    const others: ResampledSeg[] = [];
    for (let j = 0; j < visibleBases.length; j++) {
      const vb = visibleBases[j];
      if (j !== i && vb) others.push(vb);
    }
    const sm = meanderSpline(bases[i]!, rec.hidden, rec.id, islands, others, seed, t);
    return { id: rec.id, d: sm.d, points: sm.points, usage: rec.usage, hidden: rec.hidden };
  });
  return { segments, edges: outEdges, caves, dropped: finishDropped() };
}

export function projectTrailNetwork(
  network: TrailNetwork,
  islands: readonly TrailIsland[],
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): TrailNetwork {
  const centreOf = new Map<string, Pt>();
  for (const isl of islands) {
    if (!centreOf.has(isl.id)) centreOf.set(isl.id, projectGround({ x: isl.x, y: isl.y }, elevationDeg));
  }
  const segments: TrailSegment[] = network.segments.map((seg) => {
    const points = seg.points.map((p) => projectGround(p, elevationDeg));
    return { ...seg, points, d: crPathD(points) };
  });
  const caves: TrailCave[] = network.caves.map((cave) => {
    const p = projectGround({ x: cave.x, y: cave.y }, elevationDeg);
    const centre = centreOf.get(cave.islandId) ?? p;
    return { ...cave, x: p.x, y: p.y, bearing: Math.atan2(p.y - centre.y, p.x - centre.x) };
  });
  return { ...network, segments, caves };
}
