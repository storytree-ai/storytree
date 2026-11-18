// Capability 1 · Scene layout

import { hash, rand01 } from './rng.js';
import { tileUnits, type Pt } from './hex.js';

export interface BoundarySeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const COAST_OUTSET = 7;

export const COAST_OUTSET_ON_TILE = tileUnits(COAST_OUTSET);
export const COAST_SMOOTH_ITERS = 2;
const COAST_NOISE_AMP = 0.5;
const COAST_NOISE_WAVES = 3;

export function boundaryRingLoops(segs: BoundarySeg[]): Pt[][] {
  if (segs.length === 0) return [];
  const k = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(1)}`;
  const adj = new Map<string, BoundarySeg[]>();
  const push = (key: string, s: BoundarySeg): void => {
    const list = adj.get(key);
    if (list) list.push(s);
    else adj.set(key, [s]);
  };
  for (const s of segs) {
    push(k(s.x1, s.y1), s);
    push(k(s.x2, s.y2), s);
  }
  const used = new Set<BoundarySeg>();
  const loops: Pt[][] = [];
  for (const start of segs) {
    if (used.has(start)) continue;
    used.add(start);
    const startKey = k(start.x1, start.y1);
    const loop: Pt[] = [
      { x: start.x1, y: start.y1 },
      { x: start.x2, y: start.y2 },
    ];
    let endKey = k(start.x2, start.y2);
    for (let guard = 0; guard < segs.length && endKey !== startKey; guard++) {
      const next = (adj.get(endKey) ?? []).find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      const continues = k(next.x1, next.y1) === endKey;
      const nx = continues ? next.x2 : next.x1;
      const ny = continues ? next.y2 : next.y1;
      loop.push({ x: nx, y: ny });
      endKey = k(nx, ny);
    }
    const first = loop[0];
    const last = loop[loop.length - 1];
    if (first && last && Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5) {
      loop.pop();
    }
    loops.push(loop);
  }
  return loops;
}

export function loopSignedArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    if (p && q) a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function jitteredOutset(storyId: string, i: number, n: number, outset: number = COAST_OUTSET): number {
  const theta = (i / Math.max(n, 1)) * Math.PI * 2;
  const phase = rand01(hash(`${storyId}:coast:phase`)) * Math.PI * 2;
  const wave = Math.sin(theta * COAST_NOISE_WAVES + phase);
  const wobble = (rand01(hash(`${storyId}:coast:${i}`)) - 0.5) * 0.6;
  return outset * (1 + COAST_NOISE_AMP * (0.7 * wave + wobble));
}

export function outsetLoop(loop: Pt[], distOf: (i: number) => number): Pt[] {
  const n = loop.length;
  if (n < 3) return loop;
  const sign = loopSignedArea(loop) > 0 ? 1 : -1;
  const edgeNormal = (a: Pt, b: Pt): Pt => {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    return { x: (sign * ey) / len, y: (-sign * ex) / len };
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const nxt = loop[(i + 1) % n];
    if (!prev || !cur || !nxt) continue;
    const n1 = edgeNormal(prev, cur);
    const n2 = edgeNormal(cur, nxt);
    let mx = n1.x + n2.x;
    let my = n1.y + n2.y;
    const len = Math.hypot(mx, my) || 1;
    mx /= len;
    my /= len;
    const dist = distOf(i);
    out.push({ x: cur.x + mx * dist, y: cur.y + my * dist });
  }
  return out;
}

export function chaikinClosed(loop: Pt[], iterations: number): Pt[] {
  let cur = loop;
  for (let it = 0; it < iterations && cur.length >= 3; it++) {
    const n = cur.length;
    const next: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      if (!a || !b) continue;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

export interface SmoothedCoast {
  loops: Pt[][];
}

export function smoothCoast(segs: BoundarySeg[], storyId: string, outset: number = COAST_OUTSET): SmoothedCoast {
  const loops = boundaryRingLoops(segs).map((l) =>
    chaikinClosed(
      outsetLoop(l, (i) => jitteredOutset(storyId, i, l.length, outset)),
      COAST_SMOOTH_ITERS,
    ),
  );
  return { loops };
}
